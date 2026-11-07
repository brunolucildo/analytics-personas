export interface Environment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  apiPort: number;
  otelEndpoint: string;
  otelServiceName: string;
}

const REQUIRED_VARIABLES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function validateEnvironment(env: Record<string, string | undefined>): Environment {
  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(", ")}. ` +
        "Copie .env.example para .env na raiz e preencha com os valores de `bunx supabase status`.",
    );
  }

  const apiPort = Number(env.API_PORT ?? 3002);

  if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
    throw new Error("API_PORT deve ser um número inteiro entre 1 e 65535.");
  }

  return {
    supabaseUrl: env.SUPABASE_URL as string,
    supabaseAnonKey: env.SUPABASE_ANON_KEY as string,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    apiPort,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
    otelServiceName: env.OTEL_SERVICE_NAME ?? "analytics-personas-api",
  };
}
