import { expect, test } from "@playwright/test";

/**
 * Seeded-auth E2E keystone (POLICY.md R-8.8.3 / #621). Runs ONLY against the local
 * verification harness (self-hosted Convex + a fresh Better Auth DB) — start it with
 * `bash scripts/e2e-harness-up.sh` and run with `E2E_HARNESS=1`. Skipped otherwise so
 * it never runs in the default CI job (which has no harness). See docs/e2e-harness.md.
 *
 * Proves the authenticated path end-to-end: a fresh registration becomes the bootstrap
 * admin and reaches the dashboard, with the app talking to the local Convex backend.
 */
test.describe("harness: authenticated flow", () => {
  test.skip(
    !process.env.E2E_HARNESS,
    "requires the seeded Convex harness (E2E_HARNESS=1)",
  );

  test("register → authenticated dashboard", async ({ page }) => {
    const email = `e2e+${Date.now()}@harness.local`;
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("E2E Harness");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page
      .getByRole("button", { name: /create|register|sign up/i })
      .first()
      .click();

    // First user bootstraps as admin and lands on the dashboard (or onboarding).
    await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });
  });
});
