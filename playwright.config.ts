import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration.
 *
 * Critical flows this suite must cover: docs/critical-flows.md (POLICY.md R-8.8.3).
 * Coverage is currently partial (login-page smoke); see that file for the plan.
 *
 * Usage:
 *   pnpm test:e2e        # Run E2E tests headless
 *   pnpm test:e2e:ui     # Run with Playwright UI
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  // Flaky-test quarantine (POLICY.md R-8.8.4): tag a flaky test `@quarantine` to
  // exclude it from every automated run (blocking suites stay green) while it's
  // fixed. Each quarantined test needs an owner + ticket + deadline, fixed or
  // deleted within a sprint; max quarantine size is T-P5 (10). Run the quarantined
  // set manually to work on it: `pnpm test:e2e --grep @quarantine`.
  grepInvert: /@quarantine/,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // The three bands in DESIGN.md §15's breakpoint table. `Pixel 5` and
    // `iPhone 12` carry a coarse pointer, which is what actually gates the
    // `pointer-coarse:` styles that keep hover-reveal controls reachable.
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 12"] },
    },
    {
      name: "tablet",
      use: { ...devices["iPad Mini"] },
    },
  ],
  webServer: {
    // E2E_PROD_SERVER (set by the e2e-harness CI job) runs a prebuilt `next
    // start` instead of `next dev` — the harness's longer, heavier revenue-path
    // flow triggers far more Turbopack on-demand compilation than the plain
    // /login smoke suite, and that's what surfaced a known Next dev-server
    // crash class (uncaught ECONNRESET/aborted on a mid-compile request abort,
    // #725) under CI load. `next start` serves a static build with no
    // on-demand compilation, sidestepping the crash and matching what's
    // actually deployed.
    command: process.env.E2E_PROD_SERVER ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
