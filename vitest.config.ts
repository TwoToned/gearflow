import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "convex/**/*.test.ts"],
    exclude: [
      "node_modules",
      ".next",
      "src/generated/**",
      "e2e/**",
      // Integration tests run via vitest.integration.config.ts against a real
      // Postgres test DB. Keep the unit suite fast and Docker-free.
      "src/**/*.int.test.ts",
      "tests/**/*.int.test.ts",
    ],
    setupFiles: ["./tests/helpers/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/lib/validations/**/*.ts",
      ],
      exclude: [
        "src/lib/auth.ts",
        "src/lib/auth-client.ts",
        "src/lib/prisma.ts",
        "src/generated/**",
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
