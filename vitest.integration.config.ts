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
      // `server-only` is a Next.js build-time guard, not a runtime package (it's
      // not installed). The integration suite imports server modules directly, so
      // alias it to a no-op stub to avoid "Cannot find package 'server-only'".
      "server-only": path.resolve(__dirname, "./tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.int.test.ts", "tests/**/*.int.test.ts"],
    // Global setup (runs once): copy the dev Convex jwks keypair into the test DB
    // so minted service tokens are trusted by the shared dev Convex deployment.
    globalSetup: ["./tests/helpers/integration-globalsetup.ts"],
    // Per-worker setup: guarantee the Convex env (issuer + URL) before @/env loads.
    setupFiles: ["./tests/helpers/integration-setup.ts"],
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
    // Force fully-sequential tests within a file: no concurrent test bodies may
    // overlap a sibling's beforeEach TRUNCATE (which would leak/wipe rows now that
    // tests do slow Convex round-trips). Belt-and-suspenders with fileParallelism.
    maxConcurrency: 1,
    sequence: { concurrent: false },
    // Each fixture write now also round-trips to the shared dev Convex deployment
    // (auto-mirror), and tests that build many rows fan out many HTTP calls. The
    // old 15s cap was tuned for pure-Postgres tests; bump it so network latency to
    // dev Convex doesn't spuriously time out multi-row setups.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
