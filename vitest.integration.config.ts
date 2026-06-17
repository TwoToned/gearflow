import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration test config — runs *.int.test.ts files against a real
 * Postgres instance. Separate from the unit config so the unit suite
 * stays fast and doesn't need Docker.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.int.test.ts", "tests/**/*.int.test.ts"],
    // Forks pool: each test file gets its own Node process, so the shared
    // testPrisma client is properly isolated per file. Avoids the test
    // pollution that happens when a shared connection sees state from
    // concurrent test files.
    pool: "forks",
    // poolOptions removed in vitest 4 — with fileParallelism: false,
    // singleFork behavior is no longer needed.
    // Integration tests need a sequential run within each file to avoid
    // racing on TRUNCATE.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
