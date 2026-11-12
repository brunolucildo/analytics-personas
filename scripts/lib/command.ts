import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function rootPath(...parts: string[]) {
  // This file lives in scripts/lib, so the repository root is two levels up.
  return join(import.meta.dir, "..", "..", ...parts);
}

export function hasSqlMigrations() {
  const directory = rootPath("db", "migrations");

  if (!existsSync(directory)) {
    return false;
  }

  return readdirSync(directory).some((file) => file.endsWith(".sql"));
}

export function assertDocker() {
  const result = Bun.spawnSync(["docker", "info"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  if (result.exitCode !== 0) {
    console.error("Docker nao esta disponivel. Inicie o Docker Desktop e rode novamente.");
    process.exit(1);
  }
}

export async function run(label: string, command: string[], env?: Record<string, string>) {
  console.log(`\n> ${label}`);

  const child = Bun.spawn(command, {
    cwd: rootPath(),
    env: { ...process.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await child.exited;

  if (exitCode === 0) {
    console.log(`OK: ${label}`);
  } else {
    console.error(`FALHOU: ${label} (codigo ${exitCode})`);
  }

  return exitCode;
}
