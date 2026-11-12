import { assertDocker, run } from "./lib/command";
import { databaseUrlFromEnv, isLocalHost, parseDatabaseUrl } from "./lib/database";

assertDocker();

const target = parseDatabaseUrl(databaseUrlFromEnv());

const endpoint = `${isLocalHost(target.host) ? "postgres" : target.host}:${target.port}`;

const composeCode = await run(
  "docker compose up (Postgres, Grafana, Loki, Tempo, Mimir, OTel Collector)",
  ["docker", "compose", "up", "-d", "--build", "--wait", "--wait-timeout", "300"],
  {
    POSTGRES_ENDPOINT: endpoint,
    POSTGRES_USER: target.username,
    POSTGRES_PASSWORD: target.password,
  },
);

if (composeCode !== 0) {
  console.error(
    "Infra incompleta. Os containers que subiram continuam rodando. " +
      "Inspecione com `docker compose ps` e `docker compose logs`; use `bun run infra:down` para parar tudo. " +
      "Se a porta 5432 estiver ocupada por outro Postgres, pare o servico ou ajuste a porta e a DATABASE_URL.",
  );
  process.exit(1);
}

console.log(
  [
    "",
    "Infra pronta:",
    `- Postgres:     postgres://${target.username}@localhost:${target.port}/${target.database}`,
    "- Grafana:      http://localhost:3000 (admin/admin)",
    "- OTLP HTTP:    http://localhost:4318",
    "",
    "Rode `bun run db:migrate` e depois `bun run dev`.",
  ].join("\n"),
);
