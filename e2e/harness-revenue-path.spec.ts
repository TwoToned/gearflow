import { expect, test } from "@playwright/test";

/**
 * Primary revenue path (POLICY.md R-8.8.3 / #621, docs/critical-flows.md flows
 * 5-9): create a project, add a line item, see availability render, check the
 * gear out through the warehouse pipeline, then return it. Runs ONLY against
 * the seeded verification harness (self-hosted Convex + a fresh Better Auth
 * DB) — start it with `bash scripts/e2e-harness-up.sh` and run with
 * `E2E_HARNESS=1`. See docs/e2e-harness.md.
 *
 * There's no seed-data API reachable from Playwright, only the real UI, so
 * this test creates its own model + serialized asset before creating the
 * project — that's what makes the line item deployable/returnable through the
 * warehouse (a line item added as a bare "Custom" item has no model/asset and
 * can't be checked out).
 */
test.describe("harness: primary revenue path", () => {
  test.skip(
    !process.env.E2E_HARNESS,
    "requires the seeded Convex harness (E2E_HARNESS=1)",
  );

  test("project -> line item -> availability -> check-out -> return", async ({ page }) => {
    const unique = Date.now();
    const email = `e2e+revenue-${unique}@harness.local`;
    const modelName = `E2E Revenue Model ${unique}`;
    const projectName = `E2E Revenue Path ${unique}`;

    await test.step("register (first user bootstraps as admin)", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill("Revenue Path Test");
      await page.getByLabel(/email/i).first().fill(email);
      await page.getByLabel(/password/i).first().fill("harness-password-123");
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });
    });

    await test.step("complete onboarding (create the org) if needed", async () => {
      // The (app) layout redirects every route to /onboarding until an org
      // exists (src/app/(app)/layout.tsx) — a fresh registration on this harness
      // has no org yet, so this step is required before any protected page
      // (the model/asset/project forms below) will render at all.
      if (new URL(page.url()).pathname === "/onboarding") {
        await page.getByLabel("Organization name").fill(`Revenue Path Org ${unique}`);
        await page.getByRole("button", { name: "Create organization" }).click();
        await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
      }
    });

    await test.step("create an equipment model (flow 10: create inventory)", async () => {
      await page.goto("/assets/models/new");
      await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
      await page.getByRole("button", { name: "Create model" }).click();
      await expect(page).toHaveURL(/\/assets\/models\/[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a serialized asset for the model (asset tag auto-generated)", async () => {
      await page.goto("/assets/registry/new");
      await page.getByRole("button", { name: "Select a model" }).click();
      await page.getByPlaceholder("Search models").fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();
      await page.getByRole("button", { name: "Create asset" }).click();
      await expect(page).toHaveURL(/\/assets\/registry\/[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a project (flow 5)", async () => {
      await page.goto("/projects/new");
      await page.getByPlaceholder("e.g. Summer Festival 2026").fill(projectName);
      // Basics -> Schedule -> Site -> Review: every field but Name/Project code
      // (auto-filled) is optional, so three plain "Continue" clicks get through.
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 20000 });
    });

    const projectId = new URL(page.url()).pathname.split("/")[2]!;

    await test.step("add the model as a line item + pricing (flow 6)", async () => {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add item" }).click();
      await page.getByRole("tab", { name: "Own stock" }).click();
      await page.getByRole("button", { name: "Search models" }).click();
      await page.getByPlaceholder(/Search by name/).fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();

      // Availability check (flow 7) is inline and automatic here: with exactly
      // one asset created above and quantity defaulted to 1, it renders
      // "1 available out of 1 ..." with no overbook warning/checkbox to confirm.
      await expect(page.getByText(/available out of/i)).toBeVisible();
      await expect(page.getByText(/overbook/i)).toHaveCount(0);

      await page.getByRole("button", { name: "Add to project" }).click();
      // The dialog closes on a successful add.
      await expect(page.getByRole("button", { name: "Add to project" })).toBeHidden();
    });

    await test.step("check the gear out through the warehouse pipeline (flow 8)", async () => {
      await page.getByRole("link", { name: "Warehouse" }).click();
      await expect(page).toHaveURL(new RegExp(`/warehouse/${projectId}$`));

      await page.getByRole("tab", { name: /^Pick/ }).click();
      await page.locator("table thead").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Prep/ }).click();

      await page.getByRole("tab", { name: /^Prepped/ }).click();
      await page.locator("table thead").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Deploy/ }).click();

      await expect(page.getByRole("tab", { name: /^Deployed \(1\)/ })).toBeVisible();
    });

    await test.step("return the gear (flow 9)", async () => {
      await page.getByRole("tab", { name: /^Deployed/ }).click();
      await page.locator("table thead").getByRole("checkbox").click();
      // Condition defaults to "Good" — happy path needs no extra input.
      await page.getByRole("button", { name: /^Return/ }).click();

      await expect(page.getByRole("tab", { name: /^Returned \(1\)/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Deployed \(0\)/ })).toBeVisible();
    });
  });
});
