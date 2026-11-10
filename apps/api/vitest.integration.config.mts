import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.int-spec.ts"],
    globalSetup: ["./test/support/global-setup.ts"],
    setupFiles: ["./test/setup-env.ts"],
    fileParallelism: false,
  },
});
