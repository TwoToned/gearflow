import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";
import {
  addModelLineItem,
  createAssetForModel,
  createProject,
  harnessUser,
} from "./harness-helpers";

/**
 * D5 (#1109) spec 1, the happy path: register -> the create-vs-join fork
 * (/welcome, #1092) -> create an org -> all FIVE wizard screens actually
 * filled in (not skipped, unlike harness-onboarding.spec.ts's
 * "skip-everything" test) -> the four D1 (#1105) activation milestones
 * ticked from real rows, not a stored flag.
 *
 * Step 5 ("your team & your gear", C5 #1103) creates the milestone's first
 * model inline via its own add-by-hand form — that's the SAME
 * `useModelWrites().create()` mutation `/assets/models/new` uses (D1's
 * milestone derivation doesn't care which UI created the row), so the rest
 * of this test builds on that model rather than creating a second one.
 */
test.describe("harness: onboarding happy path (all five wizard screens, four milestones)", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  test("register -> fork -> create org -> fill all 5 wizard screens -> 4 milestones ticked", async ({
    page,
  }) => {
    // Chains register -> 5 wizard screens -> model -> asset -> project ->
    // line item across many page loads, each hitting Postgres + Convex — see
    // the identical timeout rationale on harness-revenue-path.spec.ts.
    test.setTimeout(180_000);

    const user = harnessUser("happy-path");
    const unique = Date.now();
    const orgName = `Happy Path Org ${unique}`;
    const modelName = `E2E Happy Path Model ${unique}`;
    const projectName = `E2E Happy Path Project ${unique}`;

    await test.step("register -> the create-vs-join fork", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill(user.name);
      await page.getByLabel(/email/i).first().fill(user.email);
      await page.getByLabel(/password/i).first().fill(user.password);
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/welcome\b/, { timeout: 20000 });
      await page.getByRole("button", { name: "Set up a new company" }).click();
      await expect(page).toHaveURL(/\/setup\b/, { timeout: 20000 });
    });

    await test.step("step 1: company name", async () => {
      await page.getByLabel("Company name").fill(orgName);
      await page.getByRole("button", { name: "Create company" }).click();
    });

    await test.step("step 2: where you operate (country -> currency/tax auto-fill, ABN)", async () => {
      await page.getByLabel("Country").click();
      await page.getByRole("option", { name: "Australia" }).click();
      await expect(page.getByLabel("ABN")).toBeVisible({ timeout: 20000 });
      await page.getByLabel("ABN").fill("61 224 983 011");
      await page.getByRole("button", { name: "Save and continue" }).click();
    });

    await test.step("step 3: your brand (document colour)", async () => {
      const hexInput = page.getByLabel("Document hex value");
      await hexInput.clear();
      await hexInput.fill("#2563eb");
      await page.getByRole("button", { name: "Save and continue" }).click();
    });

    await test.step("step 4: how you work (defaults are fine, still a real Save)", async () => {
      await page.getByRole("button", { name: "Save and continue" }).click();
    });

    await test.step("step 5: your team & your gear -> add the first model, then finish", async () => {
      await page.getByLabel("Model name").fill(modelName);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      // exact: true — a non-exact match also resolves the toast ("<model>
      // added"), which contains the model name as a substring.
      await expect(page.getByText(modelName, { exact: true })).toBeVisible({ timeout: 20000 });
      await page.getByRole("button", { name: "Finish setup" }).click();
      await expect(page).toHaveURL(/\/today\b/, { timeout: 20000 });
    });

    await test.step("Get started checklist shows 1/4 done (the model from step 5)", async () => {
      await expect(page.getByText("Get started")).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("1 / 4")).toBeVisible();
    });

    await test.step("milestone 2: asset on the first model", async () => {
      await createAssetForModel(page, modelName);
    });

    const projectId = await test.step("milestone 3: first non-template project", async () => {
      return createProject(page, projectName, `E2E-HAPPY-${unique}`);
    });

    await test.step("milestone 4: the model as a line item on that project", async () => {
      await addModelLineItem(page, projectId, modelName);
    });

    await test.step("all four milestones done -> Get started checklist disappears", async () => {
      await page.goto("/dashboard");
      await expect(page.getByText("Get started")).toHaveCount(0);
    });
  });
});
