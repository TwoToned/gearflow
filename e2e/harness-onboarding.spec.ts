import { expect, test } from "@playwright/test";

/**
 * Register / onboarding (docs/critical-flows.md flow #4, POLICY.md R-8.8.3).
 * Distinct from flow #2 (e2e/harness-auth.spec.ts, which only proves
 * registration reaches an authenticated state): this proves the *onboarding*
 * step itself — creating an org — actually completes and unblocks the app,
 * not just that the form submits. Runs ONLY against the seeded verification
 * harness (self-hosted Convex + a fresh Better Auth DB) — start it with
 * `bash scripts/e2e-harness-up.sh` and run with `E2E_HARNESS=1`. See
 * docs/e2e-harness.md.
 */
test.describe("harness: register / onboarding", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test("new account -> create org -> onboarding completes", async ({ page }) => {
    const unique = Date.now();
    const email = `e2e+onboarding-${unique}@harness.local`;
    const orgName = `Onboarding Test Org ${unique}`;

    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("Onboarding Test");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page
      .getByRole("button", { name: /create|register|sign up/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });

    // The first user on a fresh harness has no org yet, so the (app) layout
    // redirects every protected route to /onboarding (src/app/(app)/layout.tsx)
    // until one is created.
    if (new URL(page.url()).pathname === "/onboarding") {
      await page.getByLabel("Organization name").fill(orgName);
      await page.getByRole("button", { name: "Create organization" }).click();
      await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
    }

    // Onboarding actually completed (not just a client-side navigation): the
    // (app) layout's org check now passes, and revisiting /onboarding itself
    // redirects away rather than re-showing the create-org form.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
  });
});
