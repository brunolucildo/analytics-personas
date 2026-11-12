import { assertDocker, run } from "./lib/command";

assertDocker();

console.warn(
  "\nATENCAO: `infra:reset` apaga o volume do Postgres local (contas, sessoes e tokens). " +
    "Nenhum dado de um Postgres hospedado e tocado.\n",
);

const downCode = await run("docker compose down -v (apaga o volume do Postgres)", [
  "docker",
  "compose",
  "down",
  "-v",
  "--remove-orphans",
]);

if (downCode !== 0) {
  process.exit(1);
}

const upCode = await run("docker compose up (recriando o Postgres do zero)", [
  process.execPath,
  "run",
  "scripts/infra-up.ts",
]);

if (upCode !== 0) {
  process.exit(1);
}

console.log(
  "\nBanco local recriado e vazio. Rode `bun run db:migrate` para aplicar o schema.",
);
