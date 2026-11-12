/**
 * Leitura da `DATABASE_URL` pelos scripts de infraestrutura e de carga.
 * Nenhuma senha e impressa: o que sai na tela e o host, a porta e o banco.
 */

export const LOCAL_DATABASE_URL = "postgres://rondo_app:rondo@localhost:5432/rondo";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface DatabaseTarget {
  readonly host: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
  readonly database: string;
}

function isPostgresProtocol(protocol: string): boolean {
  return protocol === "postgres:" || protocol === "postgresql:";
}

/** Valida a URL e devolve as partes que o Compose e o Collector precisam. */
export function parseDatabaseUrl(value: string, variable = "DATABASE_URL"): DatabaseTarget {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} nao e uma URL valida. Veja o .env.example.`);
  }

  if (!isPostgresProtocol(url.protocol)) {
    throw new Error(`${variable} precisa comecar com postgres:// ou postgresql://.`);
  }

  if (!url.hostname) {
    throw new Error(`${variable} nao tem host. Veja o .env.example.`);
  }

  const database = url.pathname.replace(/^\//, "");

  if (!database) {
    throw new Error(`${variable} nao tem nome de banco no caminho da URL.`);
  }

  return {
    host: url.hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

/**
 * Usa a `DATABASE_URL` do ambiente ou a credencial de desenvolvimento do
 * `.env.example`, para `infra:up` funcionar antes de a pessoa copiar o arquivo.
 */
export function databaseUrlFromEnv(variable = "DATABASE_URL"): string {
  return process.env[variable]?.trim() || LOCAL_DATABASE_URL;
}
