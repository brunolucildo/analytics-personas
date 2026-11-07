import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["./test/setup-env.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "../../coverage/api",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/observability/**"],
    },
  },
});
