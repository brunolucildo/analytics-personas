import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { assertDocker } from "./lib/command";
import { databaseUrlFromEnv, isLocalHost, parseDatabaseUrl } from "./lib/database";

/**
 * Teste de carga com k6 contra uma API ISOLADA: este script sobe uma instancia propria (porta
 * LOAD_API_PORT, padrao 3013) apontada para o Postgres LOCAL, com e-mail capturado e
 * TRUST_PROXY=true, roda o k6 e apaga as contas de teste. Nunca usa a API de dev (porta 3002),
 * cujo `.env` pode apontar para um banco hospedado.
 *
 * Uso: bun run load [smoke|load|stress|capacity] [--no-prom]
 *        [--only=cenario,cenario] [--label=nome] [--api-env=NOME=valor ...]
 *
 * --only      roda so esses cenarios do k6 (ex.: --only=edges,invalidCredentials)
 * --label     rotulo da execucao (vai no nome dos arquivos e na tag `label` do k6)
 * --api-env   variavel de ambiente extra para a API (repetivel): serve para investigar gargalo,
 *             por exemplo --api-env=OTEL_SDK_DISABLED=true ou --api-env=UV_THREADPOOL_SIZE=16
 */

const PROFILES = ["smoke", "load", "stress", "capacity"] as const;
type Profile = (typeof PROFILES)[number];

const args = process.argv.slice(2);
const profile = (args.find((arg) => !arg.startsWith("--")) ?? "smoke") as Profile;
const pushMetrics = !args.includes("--no-prom");

const flag = (name: string) =>
  args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
const only = flag("only")[0];
const label = flag("label")[0];
const extraApiEnv: Record<string, string> = {};

for (const pair of flag("api-env")) {
  const at = pair.indexOf("=");

  if (at < 1) {
    console.error(`--api-env espera NOME=valor, recebi "${pair}".`);
    process.exit(1);
  }

  extraApiEnv[pair.slice(0, at)] = pair.slice(at + 1);
}

if (!PROFILES.includes(profile)) {
  console.error(`Perfil desconhecido: "${profile}". Use: ${PROFILES.join(", ")}.`);
  process.exit(1);
}

/** Raiz do repositorio (este arquivo fica em `scripts/`). */
const repo = (...parts: string[]) => join(import.meta.dir, "..", ...parts);

const PORT = Number(process.env.LOAD_API_PORT ?? 3013);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MIMIR_PUSH_URL = process.env.LOAD_PROM_RW_URL ?? "http://localhost:9009/api/v1/push";
const EMAIL_PREFIX = "k6-";
const runId = Date.now().toString(36);

function findK6(): string {
  const found = Bun.which("k6");

  if (found) {
    return found;
  }

  const windows = "C:\\Program Files\\k6\\k6.exe";

  if (existsSync(windows)) {
    return windows;
  }

  console.error(
    "k6 nao encontrado. Instale: `winget install GrafanaLabs.k6` (https://k6.io/docs/get-started/installation/).",
  );
  process.exit(1);
}

/** Resolve a `DATABASE_URL` (ou a credencial de desenvolvimento) e recusa qualquer host nao local. */
function localDatabase(): string {
  const connectionString = databaseUrlFromEnv();
  const target = parseDatabaseUrl(connectionString);

  if (!isLocalHost(target.host)) {
    console.error(
      `Recusado: o Postgres "${target.host}" nao e local. O teste de carga so roda contra o banco local.`,
    );
    process.exit(1);
  }

  return connectionString;
}

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });

    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;

  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/health`, {
        signal: AbortSignal.timeout(1500),
      });

      if (response.status === 200) {
        return true;
      }
    } catch {
      // ainda subindo
    }

    await Bun.sleep(500);
  }

  return false;
}

/** Apaga as contas de teste (e, por cascata, tokens e sessoes) so no Postgres local. */
async function cleanUsers(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "rondo-load-cleanup" });

  try {
    const result = await pool.query("delete from public.users where email like $1", [
      `${EMAIL_PREFIX}%`,
    ]);

    console.log(`Limpeza: ${result.rowCount ?? 0} conta(s) ${EMAIL_PREFIX}* removida(s) do banco local.`);
  } catch (error) {
    console.error(
      "Nao consegui limpar as contas de teste:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

assertDocker();

const k6 = findK6();
const databaseUrl = localDatabase();

if (await answers(`${BASE_URL}/api/v1/health`)) {
  console.error(
    `A porta ${PORT} ja esta em uso. Outro processo atenderia o teste (com outro codigo e talvez outro banco). ` +
      "Encerre-o ou use LOAD_API_PORT=<porta livre>.",
  );
  process.exit(1);
}

if (pushMetrics && !(await answers(MIMIR_PUSH_URL.replace("/api/v1/push", "/ready")))) {
  console.error(
    `Mimir inacessivel em ${MIMIR_PUSH_URL}: rode \`bun run infra:up\` ou use --no-prom.`,
  );
  process.exit(1);
}

console.log("\n> build da API");

const build = Bun.spawn([process.execPath, "run", "build"], {
  cwd: repo("apps", "api"),
  stdio: ["inherit", "inherit", "inherit"],
});

if ((await build.exited) !== 0) {
  console.error("FALHOU: build da API");
  process.exit(1);
}

const resultsDir = repo("load", "results");

mkdirSync(resultsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = label ? `${profile}-${label}` : profile;
const summaryPath = join(resultsDir, `${name}-${stamp}.json`);
const apiErrorLog = join(resultsDir, `api-${name}-${stamp}.err.log`);

console.log(
  `\n> API isolada em ${BASE_URL} (Postgres local, e-mail capturado, TRUST_PROXY=true)`,
);

if (Object.keys(extraApiEnv).length > 0) {
  console.log(
    `> env extra da API: ${Object.entries(extraApiEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
}

const api = Bun.spawn(["node", "dist/main.js"], {
  cwd: repo("apps", "api"),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    API_PORT: String(PORT),
    APP_URL: "http://localhost:5173",
    EMAIL_PROVIDER: "capture",
    EMAIL_FROM: "Rondo <no-reply@rondo.local>",
    TRUST_PROXY: "true",
    AUTH_JWT_SECRET: "load-test-only-secret-0123456789-abcdefghijklmnop",
    OTEL_SERVICE_NAME: "rondo-api",
    LOG_LEVEL: "info",
    ...extraApiEnv,
  },
  stdout: "ignore",
  stderr: Bun.file(apiErrorLog),
});

let exitCode = 1;

const shutdown = async () => {
  api.kill("SIGTERM");
  await Promise.race([api.exited, Bun.sleep(5000)]);

  await cleanUsers(databaseUrl);
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(130));
});

try {
  if (!(await waitForHealth(45_000))) {
    console.error(`A API nao respondeu em 45 s. Veja ${apiErrorLog}.`);
  } else {
    const k6Args = [
      "run",
      "--summary-export",
      summaryPath,
      "--tag",
      `testid=${runId}`,
      ...(label ? ["--tag", `label=${label}`] : []),
      ...(pushMetrics ? ["--out", "experimental-prometheus-rw"] : []),
      repo("load", "k6", "main.js"),
    ];

    console.log(
      `\n> k6 ${profile} (run ${runId})${pushMetrics ? ", metricas do k6 enviadas ao Mimir" : ""}\n`,
    );

    const child = Bun.spawn([k6, ...k6Args], {
      cwd: repo(),
      env: {
        ...process.env,
        BASE_URL,
        PROFILE: profile,
        RUN_ID: runId,
        ...(only ? { ONLY: only } : {}),
        K6_PROMETHEUS_RW_SERVER_URL: MIMIR_PUSH_URL,
        K6_PROMETHEUS_RW_TREND_STATS: "p(50),p(95),p(99),avg,max",
        K6_PROMETHEUS_RW_PUSH_INTERVAL: "5s",
      },
      stdio: ["inherit", "inherit", "inherit"],
    });

    exitCode = await child.exited;
  }
} finally {
  await shutdown();
}

console.log(`\nResumo em ${summaryPath}`);

if (exitCode === 99) {
  console.log(
    "k6 terminou com limites estourados (codigo 99): o resultado do teste, nao uma falha do runner.",
  );
}

process.exit(exitCode);
