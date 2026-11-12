import { assertDocker, run } from "./lib/command";

assertDocker();

const composeCode = await run("docker compose down", [
  "docker",
  "compose",
  "down",
  "--remove-orphans",
]);

if (composeCode !== 0) {
  process.exit(1);
}

console.log("\nInfra parada. O volume do Postgres foi preservado.");
