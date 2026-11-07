import { hasSqlMigrations, run, supabaseCommand } from "./lib/command";

const exitCode = await run(
  "supabase migration up --local",
  supabaseCommand("migration", "up", "--local"),
);

if (exitCode === 0 && !hasSqlMigrations()) {
  console.log("Nenhuma migration pendente: supabase/migrations nao contem arquivos .sql.");
}

process.exit(exitCode);
