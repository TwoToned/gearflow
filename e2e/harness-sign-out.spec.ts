import { expect, test } from "@playwright/test";

/**
 * Sign out (docs/critical-flows.md flow #3, POLICY.md R-8.8.3). Runs ONLY
 * against the seeded verification harness (self-hosted Convex + a fresh
 * Better Auth DB) — start it with `bash scripts/e2e-harness-up.sh` and run
 * with `E2E_HARNESS=1`. See docs/e2e-harness.md.
 *
 * Proves the session is actually invalidated, not just that the UI navigates
 * away: after sign-out, a direct visit to a protected route bounces back to
 * /login instead of rendering the authenticated page.
 */
test.describe("harness: sign out", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test("authenticated -> sign out -> session invalidated", async ({ page }) => {
    const email = `e2e+signout-${Date.now()}@harness.local`;
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("Sign Out Test");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page
      .getByRole("button", { name: /create|register|sign up/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\b/, { timeout: 20000 });

    // The session cookie is gone, so a protected route must bounce back to
    // /login rather than render — proves the server actually invalidated the
    // session (POLICY.md R-9.3), not just that the client redirected once.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\b/, { timeout: 20000 });
  });
});
