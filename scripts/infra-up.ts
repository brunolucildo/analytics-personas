import { assertDocker, run, supabaseCommand } from "./lib/command";

assertDocker();

const supabaseCode = await run("supabase start (API local em 54321)", supabaseCommand("start"));

if (supabaseCode !== 0) {
  console.error("Supabase local nao subiu. Verifique Docker e o config.toml em supabase/.");
  process.exit(1);
}

const composeCode = await run("docker compose up (Grafana, Loki, Tempo, Mimir, OTel Collector)", [
  "docker",
  "compose",
  "up",
  "-d",
  "--build",
  "--wait",
  "--wait-timeout",
  "300",
]);

if (composeCode !== 0) {
  console.error(
    "Grafana LGTM falhou. O Supabase local continua rodando. " +
      "Inspecione com `docker compose ps` e `docker compose logs`; use `bun run infra:down` para parar tudo.",
  );
  process.exit(1);
}

console.log(
  [
    "",
    "Infra pronta:",
    "- Supabase API: http://127.0.0.1:54321",
    "- Grafana:      http://localhost:3000 (admin/admin)",
    "- OTLP HTTP:    http://localhost:4318",
    "",
    "Rode `bun run db:migrate` e depois `bun run dev`.",
  ].join("\n"),
);
