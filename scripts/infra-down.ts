import { assertDocker, run, supabaseCommand } from "./lib/command";

assertDocker();

const supabaseCode = await run("supabase stop", supabaseCommand("stop", "--no-backup"));

if (supabaseCode !== 0) {
  console.warn("Supabase nao estava rodando (ou ja foi parado); seguindo para os containers.");
}

const composeCode = await run("docker compose down --remove-orphans", [
  "docker",
  "compose",
  "down",
  "--remove-orphans",
]);

if (composeCode !== 0) {
  process.exit(1);
}

console.log("\nInfra parada.");
