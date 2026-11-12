import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { hasSqlMigrations, rootPath } from "./lib/command";
import { parseDatabaseUrl } from "./lib/database";

/**
 * Runner de migrations do Rondo: SQL puro, sem CLI externa.
 *
 * - conecta com `DATABASE_MIGRATOR_URL` (dono do schema, DDL);
 * - cria `schema_migrations(nome, checksum, applied_at)` se nao existir;
 * - serializa execucoes com `pg_advisory_lock`;
 * - aplica cada arquivo de `db/migrations` em ordem lexicografica, em uma transacao;
 * - recusa um arquivo ja aplicado cujo checksum mudou, sem executar nada.
 */

const MIGRATIONS_DIRECTORY = rootPath("db", "migrations");
const MIGRATION_LOCK_KEY = 7483901;
const MIGRATION_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;

function fail(message: string): never {
  console.error(`\nFALHOU: ${message}\n`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_MIGRATOR_URL?.trim();

if (!connectionString) {
  fail(
    "DATABASE_MIGRATOR_URL nao esta definida. Copie o .env.example para .env e rode " +
      "`bun run infra:up` antes de `bun run db:migrate`.",
  );
}

try {
  parseDatabaseUrl(connectionString, "DATABASE_MIGRATOR_URL");
} catch (error) {
  fail(error instanceof Error ? error.message : "DATABASE_MIGRATOR_URL invalida.");
}

if (!hasSqlMigrations()) {
  console.log("Nenhuma migration pendente: db/migrations nao contem arquivos .sql.");
  process.exit(0);
}

const files = readdirSync(MIGRATIONS_DIRECTORY)
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

for (const file of files) {
  if (!MIGRATION_FILE.test(file)) {
    fail(
      `Nome de migration invalido: "${file}". Use aaaaMMddHHmmss_descricao.sql em db/migrations.`,
    );
  }
}

// Line endings are normalized so a checkout with CRLF (autocrlf on Windows) and one with LF
// produce the same checksum for the same migration.
function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: "rondo-migrator",
  connectionTimeoutMillis: 5000,
});

let lockAcquired = false;

async function applyMigrations(): Promise<void> {
  await pool.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  await pool.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  lockAcquired = true;

  const applied = await pool.query<{ name: string; checksum: string }>(
    "select name, checksum from public.schema_migrations",
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8");
    const checksum = checksumOf(sql);
    const previous = appliedByName.get(file);

    if (previous !== undefined && previous !== checksum) {
      fail(
        `A migration "${file}" ja foi aplicada com outro checksum. ` +
          "Restaure o arquivo original ou recrie o banco local com `bun run infra:reset`.",
      );
    }
  }

  const pending = files.filter((file) => !appliedByName.has(file));

  if (pending.length === 0) {
    console.log(`Nada a aplicar: ${files.length} migration(s) ja registrada(s) em schema_migrations.`);
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8");
    const checksum = checksumOf(sql);
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (name, checksum) values ($1, $2)",
        [file, checksum],
      );
      await client.query("commit");
      console.log(`OK: ${file}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);

      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "desconhecido";
      const message = error instanceof Error ? error.message : String(error);

      fail(
        `A migration "${file}" falhou (SQLSTATE ${code}): ${message}. ` +
          "Nenhuma alteracao desse arquivo foi registrada; corrija e rode de novo.",
      );
    } finally {
      client.release();
    }
  }

  console.log(`\n${pending.length} migration(s) aplicada(s).`);
}

try {
  await applyMigrations();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  fail(
    `Nao consegui conectar/aplicar as migrations: ${message}. ` +
      "Verifique `bun run infra:up` e a DATABASE_MIGRATOR_URL.",
  );
} finally {
  if (lockAcquired) {
    await pool.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }

  await pool.end().catch(() => undefined);
}
