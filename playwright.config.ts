import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration.
 *
 * Currently a scaffold — no E2E tests written yet.
 * See TODOS.md for the E2E test expansion plan.
 *
 * Usage:
 *   npm run test:e2e        # Run E2E tests headless
 *   npm run test:e2e:ui     # Run with Playwright UI
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
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
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
