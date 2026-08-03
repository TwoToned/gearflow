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

  // Quarantined (POLICY.md R-8.8.4): #1071 deleted the single-org auto-join
  // hook, which is what silently gave every OTHER harness spec file's fresh
  // registrant org membership for free. This file's setup now correctly
  // can't create a second org once another harness spec has already
  // bootstrapped one in the shared harness DB, so it never reaches an
  // authenticated app page — an E2E test-isolation gap, not a product bug.
  // Owner: Jayden (eng). Tracked: #1118. Deadline: 2026-08-15.
  test("authenticated -> sign out -> session invalidated @quarantine", async ({ page }) => {
    // Playwright's default test timeout is 30s for the WHOLE test — this can
    // chain register -> create org -> sign-out -> a revisit-check across up to
    // 4 page loads when run standalone against a fresh harness (see the
    // identical comment/timeout on harness-revenue-path.spec.ts).
    test.setTimeout(90_000);

    const unique = Date.now();
    const email = `e2e+signout-${unique}@harness.local`;
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("Sign Out Test");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill("harness-password-123");
    await page
      .getByRole("button", { name: /create|register|sign up/i })
      .first()
      .click();
    // A fresh registration with no org lands on the create-vs-join fork
    // (/welcome, #1092) rather than an authenticated dashboard directly.
    await expect(page).toHaveURL(/\/(dashboard|welcome)\b/, { timeout: 20000 });

    // Run standalone against a fresh harness, this is the first-ever user, so
    // the (app) layout redirects to /welcome (no org yet) — which has no
    // UserNav, so "Account menu" below wouldn't exist without completing it.
    // "Set up a new company" leads to /onboarding, the actual create-org form.
    if (new URL(page.url()).pathname === "/welcome") {
      await page.getByRole("button", { name: "Set up a new company" }).click();
      await expect(page).toHaveURL(/\/onboarding\b/, { timeout: 20000 });
    }
    if (new URL(page.url()).pathname === "/onboarding") {
      await page.getByLabel("Organization name").fill(`Sign Out Org ${unique}`);
      await page.getByRole("button", { name: "Create organization" }).click();
      await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
    }

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
