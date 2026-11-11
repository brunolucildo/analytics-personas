// Capacidade do argon2id e efeito de limitar a concorrencia dos hashes, medidos fora da API.
//   1. teto de hashes por segundo e CPU por hash, com os parametros atuais e alternativos;
//   2. um limite de hashes simultaneos abaixo do tamanho do pool protege o resto (JWT, randomBytes)?
// So medicao: escolher parametros de hash e uma decisao de seguranca do Owner.
// Uso (da raiz): node load/diagnostics/hash-capacity.mjs
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const argon2 = require("argon2");
const { SignJWT, jwtVerify } = await import(pathToFileURL(require.resolve("jose")).href);

const key = new TextEncoder().encode("probe-secret-0123456789-abcdefghijklmnop");
const token = await new SignJWT({ sid: "x" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("u")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(key);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];

function semaphore(limit) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active < limit && waiting.length) {
      active += 1;
      waiting.shift()();
    }
  };

  return async (task) => {
    await new Promise((resolve) => {
      waiting.push(resolve);
      next();
    });

    try {
      return await task();
    } finally {
      active -= 1;
      next();
    }
  };
}

async function underLoad(label, cap) {
  const gate = cap ? semaphore(cap) : (task) => task();
  let stop = false;
  let hashes = 0;
  const hashers = Array.from({ length: 48 }, async (_, i) => {
    while (!stop) {
      await gate(() => argon2.hash(`sat-${i}`, { type: argon2.argon2id }));
      hashes += 1;
    }
  });

  await new Promise((r) => setTimeout(r, 1500));

  const jwt = [];
  const rnd = [];
  const started = performance.now();
  const startHashes = hashes;

  for (let i = 0; i < 14; i++) {
    let t0 = performance.now();

    await jwtVerify(token, key, { algorithms: ["HS256"] });
    jwt.push(performance.now() - t0);

    t0 = performance.now();
    await new Promise((resolve, reject) => randomBytes(32, (e, b) => (e ? reject(e) : resolve(b))));
    rnd.push(performance.now() - t0);

    await new Promise((r) => setTimeout(r, 100));
  }

  const rate = (hashes - startHashes) / ((performance.now() - started) / 1000);

  stop = true;
  await Promise.all(hashers);

  console.log(
    `${label.padEnd(34)} jwtVerify ${median(jwt).toFixed(1)} / ${p95(jwt).toFixed(1)} ms | randomBytes ${median(rnd).toFixed(1)} / ${p95(rnd).toFixed(1)} ms | hashes/s ${rate.toFixed(1)}`,
  );
}

console.log(
  `threadpool: ${process.env.UV_THREADPOOL_SIZE ?? "4 (padrao)"} | latencia mediana / p95 com 48 hashes na fila\n`,
);
await underLoad("sem limite (como hoje)", 0);
await underLoad("limite de 3 hashes simultaneos", 3);
await underLoad("limite de 2 hashes simultaneos", 2);
await underLoad("limite de 1 hash por vez", 1);

console.log("\ncusto dos parametros do argon2id (1 por vez e 4 em paralelo):");

async function cost(label, options) {
  const run = async (concurrency, total) => {
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    let started = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (started < total) {
          started += 1;
          await argon2.hash(`bench-${started}`, { type: argon2.argon2id, ...options });
        }
      }),
    );

    const wall = (performance.now() - t0) / 1000;
    const cpu = process.cpuUsage(cpu0);

    return {
      perSecond: total / wall,
      cpuMs: (cpu.user + cpu.system) / 1000 / total,
      wallMs: (wall / total) * 1000,
    };
  };
  const one = await run(1, 10);
  const four = await run(4, 40);

  console.log(
    `${label.padEnd(44)} 1 por vez: ${one.wallMs.toFixed(0)} ms, ${one.cpuMs.toFixed(0)} ms CPU | 4 em paralelo: ${four.perSecond.toFixed(0)} hashes/s, ${four.cpuMs.toFixed(0)} ms CPU por hash`,
  );
}

await cost("atual: 64 MiB, t=3, p=4 (padrao da lib)", {});
await cost("64 MiB, t=3, p=1", { parallelism: 1 });
await cost("OWASP: 46 MiB, t=1, p=1", { memoryCost: 47104, timeCost: 1, parallelism: 1 });
await cost("OWASP: 19 MiB, t=2, p=1", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
