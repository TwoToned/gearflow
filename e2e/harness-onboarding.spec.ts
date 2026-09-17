import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";

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

  // #1118 fix: restore this file's own "fresh Better Auth DB" (every harness
  // file's docstring already assumes one) rather than sharing whatever state
  // an earlier file in the same CI job left behind — see harness-db-reset.ts.
  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  test("new account -> create org -> onboarding completes", async ({ page }) => {
    // Playwright's default test timeout is 30s for the WHOLE test — this
    // chains register -> create org -> a revisit-check across 3 page loads,
    // each with its own 20s expect; under CI's observed latency the total can
    // exceed 30s even though each step alone fits (see the identical
    // comment/timeout on harness-revenue-path.spec.ts).
    test.setTimeout(90_000);

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
    // A fresh registration with no org lands on the create-vs-join fork
    // (/welcome, #1092) rather than an authenticated dashboard directly.
    await expect(page).toHaveURL(/\/(today|welcome)\b/, { timeout: 20000 });

    // The first user on a fresh harness has no org yet, so the (app) layout
    // redirects every protected route to /welcome (src/app/(app)/layout.tsx)
    // until one is created. "Set up a new company" leads to /setup, the
    // actual create-org form (C1, #1098 — formerly /onboarding).
    if (new URL(page.url()).pathname === "/welcome") {
      await page.getByRole("button", { name: "Set up a new company" }).click();
      await expect(page).toHaveURL(/\/setup\b/, { timeout: 20000 });
    }
    if (new URL(page.url()).pathname === "/setup") {
      await page.getByLabel("Company name").fill(orgName);
      await page.getByRole("button", { name: "Create company" }).click();
      // Step 1's success lands on step 2 ("where you operate", C2 #1099),
      // step 3 ("your brand", C3 #1101), step 4 ("how you work", C4
      // #1102), then step 5 ("your team & your gear", C5 #1103), all still
      // at /setup — skip all four, only the name is required (D3).
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await expect(page).toHaveURL(/\/today\b/, { timeout: 20000 });
    }

    // Onboarding actually completed (not just a client-side navigation): the
    // (app) layout's org check now passes, and revisiting /setup itself
    // redirects away rather than re-showing the create-org form.
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/today\b/, { timeout: 20000 });
  });

  /**
   * D5 (#1109) spec 3, the "skip-everything path" — what makes D3's
   * "skip everything" claim real rather than aspirational: register, create
   * an org with a name and nothing else, skip all four optional wizard
   * screens (the flow the test above already drives), then prove two things
   * a fresh operator actually needs:
   *
   * 1. **The app is fully usable** — creating a model works with zero setup,
   *    same as it would for an operator who filled in every wizard field.
   * 2. **The "Finish setup" checklist (C6, #1104) reflects exactly what's
   *    unset** — not a generic "welcome" banner. Two of its four items are
   *    already done despite every wizard screen being skipped:
   *    "Set your currency & tax details" (org creation seeds a default
   *    currency/tax rate regardless of the wizard, C1 #1098's
   *    `seedOrgDefaults`) and "Add a location" (skipping step 4 still
   *    creates a "Main warehouse" default, `ensureLocationOnSkip`). The
   *    other two — "Add your logo", "Invite your team" — are genuinely
   *    unset, since nothing else in this flow sets them.
   */
  test("skip-everything path -> app fully usable -> checklist reflects exactly what's unset", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const unique = Date.now();
    const email = `e2e+skipall-${unique}@harness.local`;
    const orgName = `Skip Everything Org ${unique}`;
    const modelName = `E2E Skip-Everything Model ${unique}`;

    await test.step("register -> create org -> skip all four wizard screens", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill("Skip Everything Test");
      await page.getByLabel(/email/i).first().fill(email);
      await page.getByLabel(/password/i).first().fill("harness-password-123");
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/(today|welcome)\b/, { timeout: 20000 });

      if (new URL(page.url()).pathname === "/welcome") {
        await page.getByRole("button", { name: "Set up a new company" }).click();
        await expect(page).toHaveURL(/\/setup\b/, { timeout: 20000 });
      }
      await page.getByLabel("Company name").fill(orgName);
      await page.getByRole("button", { name: "Create company" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await expect(page).toHaveURL(/\/today\b/, { timeout: 20000 });
    });

    await test.step("Finish setup checklist reflects exactly what's unset -> 2 of 4 done", async () => {
      // FinishSetupChecklist stayed on /dashboard (#1242, D10A) — /today is
      // only the post-onboarding landing page, not where this widget lives.
      await page.goto("/dashboard");
      await expect(page.getByText("Finish setup")).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("2 of 4 done")).toBeVisible();

      const doneRow = (label: string) => page.getByText(label, { exact: true });
      // Done despite skipping every wizard screen (seeded at org creation /
      // by the step-4 skip's own default-location fallback).
      await expect(doneRow("Set your currency & tax details")).toHaveClass(/line-through/);
      await expect(doneRow("Add a location")).toHaveClass(/line-through/);
      // Genuinely unset — nothing in this flow ever touches either.
      await expect(doneRow("Add your logo")).not.toHaveClass(/line-through/);
      await expect(doneRow("Invite your team")).not.toHaveClass(/line-through/);
    });

    await test.step("the app is fully usable despite skipping everything -> create a model", async () => {
      await page.goto("/assets/models/new");
      await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
      await page.getByRole("button", { name: "Create model" }).click();
      await expect(page).toHaveURL(/\/assets\/models\/(?!new$)[^/]+$/, { timeout: 20000 });
    });
  });
});
