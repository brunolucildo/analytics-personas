import { defineConfig, devices } from "@playwright/test";
import { ensureLocalSupabaseEnv } from "./scripts/lib/supabase-env";

// The sign-up flow needs the API and the local database: take the keys from
// `supabase status` unless they are already in the environment. Workers inherit them.
ensureLocalSupabaseEnv();

// Defaults match the dev setup (5173 and 3002). Override the ports when another
// process already holds them: `E2E_APP_PORT=5183 E2E_API_PORT=3012 bun run test:e2e`.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 5173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3002);
const APP_URL = `http://localhost:${APP_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

// Read by the specs (workers inherit process.env).
process.env.E2E_APP_URL = APP_URL;
process.env.E2E_API_URL = API_URL;

// Secret the API under test signs session tokens with; the specs sign matching tokens for seeded users.
// A fixed test-only value (never a real secret), unless the environment already provides one.
process.env.AUTH_JWT_SECRET ??= "e2e-only-jwt-secret-0123456789-abcdefghijk";

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/support/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `bun x vite --port ${APP_PORT} --strictPort`,
      cwd: "apps/app",
      url: APP_URL,
      // Not reused: a dev server started elsewhere may point at another API (VITE_API_URL).
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: API_URL },
    },
    {
      // Always a fresh API: the tests need EMAIL_PROVIDER=capture and a clean
      // in-memory rate limit, which an API already running for development lacks.
      command: "bun run dev",
      cwd: "apps/api",
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PORT: String(API_PORT),
        APP_URL,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET as string,
        EMAIL_PROVIDER: "capture",
        EMAIL_FROM: "Rondo <no-reply@rondo.local>",
        TRUST_PROXY: "false",
        OTEL_SDK_DISABLED: "true",
        LOG_LEVEL: "warn",
      },
    },
  ],
});
