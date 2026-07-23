import { expect, test } from "@playwright/test";

/**
 * Create inventory (docs/critical-flows.md flow #10, POLICY.md R-8.8.3), as
 * its own standalone flow rather than only exercised implicitly as setup
 * inside e2e/harness-revenue-path.spec.ts. Proves a model + serialized asset
 * can be created and that the asset tag is server-generated (not user
 * input — there's no field for it anywhere in the create form). Runs ONLY
 * against the seeded verification harness (self-hosted Convex + a fresh
 * Better Auth DB) — start it with `bash scripts/e2e-harness-up.sh` and run
 * with `E2E_HARNESS=1`. See docs/e2e-harness.md.
 */
test.describe("harness: create inventory", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test("create a model -> create a serialized asset -> asset tag generated", async ({
    page,
  }) => {
    const unique = Date.now();
    const email = `e2e+inventory-${unique}@harness.local`;
    const modelName = `E2E Inventory Model ${unique}`;

    await test.step("register (first user bootstraps as admin)", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill("Inventory Test");
      await page.getByLabel(/email/i).first().fill(email);
      await page.getByLabel(/password/i).first().fill("harness-password-123");
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/(dashboard|onboarding)\b/, { timeout: 20000 });
    });

    await test.step("complete onboarding (create the org) if needed", async () => {
      if (new URL(page.url()).pathname === "/onboarding") {
        await page.getByLabel("Organization name").fill(`Inventory Org ${unique}`);
        await page.getByRole("button", { name: "Create organization" }).click();
        await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
      }
    });

    await test.step("create an equipment model", async () => {
      await page.goto("/assets/models/new");
      await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
      await page.getByRole("button", { name: "Create model" }).click();
      await expect(page).toHaveURL(/\/assets\/models\/(?!new$)[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a serialized asset for the model -> asset tag generated", async () => {
      await page.goto("/assets/registry/new");
      await page.getByRole("button", { name: "Select a model" }).click();
      await page.getByPlaceholder("Search models").fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();
      await page.getByRole("button", { name: "Create asset" }).click();
      await expect(page).toHaveURL(/\/assets\/registry\/(?!new$)[^/]+$/, { timeout: 20000 });

      // Asset tag is server-generated (no field for it in the create form
      // above) — a prefix + zero-padded counter (default "ASSET0001", see
      // src/server/settings.ts), rendered in the registry detail page's
      // "Asset tag" row.
      await expect(page.getByText(/^[A-Z]+-?\d{3,}$/).first()).toBeVisible({ timeout: 20000 });
    });
  });
});
