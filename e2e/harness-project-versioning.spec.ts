import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the three E2E specs
 * the issue calls for (I-20). Runs ONLY against the seeded verification
 * harness (self-hosted Convex + a fresh Better Auth DB) — start it with
 * `bash scripts/e2e-harness-up.sh` and run with `E2E_HARNESS=1`. See
 * docs/e2e-harness.md.
 *
 * Honesty note (per this phase's own instructions): this sandbox has no live
 * Convex deployment and no way to run the seeded harness end-to-end, so
 * these specs are written and believed correct against the actual app UI
 * (mirroring e2e/harness-revenue-path.spec.ts's/harness-create-inventory.spec.ts's
 * proven register -> onboard -> model -> asset -> project -> equipment
 * chain), but have NOT been executed and confirmed green in this session.
 * They are ready to run in CI/a real environment, not verified passing here.
 */
test.describe("harness: project versioning v2", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  /** Shared register -> onboard -> model -> asset -> project setup, factored
   *  out so both real tests below don't repeat the ~40-line boilerplate
   *  `harness-revenue-path.spec.ts` already proves works. */
  async function setUpProjectWithOneLineItem(
    page: import("@playwright/test").Page,
    unique: number,
  ): Promise<{ projectUrl: string }> {
    const email = `e2e+versioning-${unique}@harness.local`;
    const modelName = `E2E Versioning Model ${unique}`;
    const projectName = `E2E Versioning Project ${unique}`;

    await test.step("register (first user bootstraps as admin)", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill("Versioning Test");
      await page.getByLabel(/email/i).first().fill(email);
      await page.getByLabel(/password/i).first().fill("harness-password-123");
      await page.getByRole("button", { name: /create|register|sign up/i }).first().click();
      await expect(page).toHaveURL(/\/(dashboard|welcome)\b/, { timeout: 20000 });
    });

    await test.step("complete onboarding (create the org) if needed", async () => {
      if (new URL(page.url()).pathname === "/welcome") {
        await page.getByRole("button", { name: "Set up a new company" }).click();
        await expect(page).toHaveURL(/\/setup\b/, { timeout: 20000 });
      }
      if (new URL(page.url()).pathname === "/setup") {
        await page.getByLabel("Company name").fill(`Versioning Org ${unique}`);
        await page.getByRole("button", { name: "Create company" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
      }
    });

    await test.step("create an equipment model + serialized asset", async () => {
      await page.goto("/assets/models/new");
      await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
      await page.getByRole("button", { name: "Create model" }).click();
      await expect(page).toHaveURL(/\/assets\/models\/(?!new$)[^/]+$/, { timeout: 20000 });

      await page.goto("/assets/registry/new");
      await page.getByRole("button", { name: "Select a model" }).click();
      await page.getByPlaceholder("Search models").fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();
      await page.getByRole("button", { name: "Create asset" }).click();
      await expect(page).toHaveURL(/\/assets\/registry\/(?!new$)[^/]+$/, { timeout: 20000 });
    });

    let projectUrl = "";
    await test.step("create a project", async () => {
      await page.goto("/projects/new");
      await page.getByPlaceholder("e.g. Summer Festival 2026").fill(projectName);
      await page.getByRole("button", { name: "Continue" }).focus();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page).toHaveURL(/\/projects\/(?!new$)[^/]+$/, { timeout: 20000 });
      projectUrl = page.url();
    });

    await test.step("add the model as a line item", async () => {
      await page.getByRole("tab", { name: "Equipment", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add item" }).click();
      const addDialog = page.getByRole("dialog", { name: "Add equipment" });
      await page.getByRole("tab", { name: "Own stock" }).click();
      await page.getByRole("button", { name: "Search models" }).click();
      await page.getByPlaceholder(/Search by name/).fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();
      await page.getByRole("button", { name: "Add to project" }).click();
      await expect(addDialog).toBeHidden();
    });

    return { projectUrl };
  }

  /**
   * Spec 1 — switch to a non-live version, edit a line, switch back: the
   * edit is on the version, the live page is untouched.
   *
   * Edits an EXISTING line item's unit price (not a brand-new add) — every
   * inline edit/delete on an already-created line operates on that row's
   * own `id`, which already carries its own `versionId` regardless of which
   * version is live (`convex/lineItemWrites.ts`'s `updateNative`). Adding a
   * brand-new line while viewing a non-live version is a SEPARATE, currently
   * unwired backend gap (every `*Writes.addNative` call still stamps the
   * project's LIVE version unconditionally — see `EquipmentTab`'s
   * `addDisabledReason` prop, which greys that action out precisely because
   * of this) — deliberately not exercised here.
   */
  test("switch to a non-live version, edit a line, switch back", async ({ page }) => {
    test.setTimeout(150_000);
    const unique = Date.now();
    const { projectUrl } = await setUpProjectWithOneLineItem(page, unique);

    let liveUnitPrice = "";
    await test.step("note the live version's current unit price", async () => {
      const priceCell = page.locator("table tbody tr").first().locator("td").nth(4);
      liveUnitPrice = (await priceCell.textContent())?.trim() ?? "";
    });

    await test.step("open the version menu and create a new version", async () => {
      await page.getByRole("button", { name: "Project versions" }).click();
      await page.getByRole("menuitem", { name: /new version/i }).click();
      // Switching to the new version updates the header pill and the URL's
      // `?v=` param (design §3.1 — per-user, never a DB field).
      await expect(page).toHaveURL(/[?&]v=\d+/, { timeout: 20000 });
    });

    await test.step("the VersionStrip announces a non-live, fully editable version", async () => {
      await expect(page.getByText(/a draft version, fully editable/i)).toBeVisible();
    });

    await test.step("edit the line item's price on this non-live version", async () => {
      const priceCell = page.locator("table tbody tr").first().locator("td").nth(4);
      await priceCell.click();
      const priceInput = page.locator("table tbody tr").first().getByRole("spinbutton").first();
      await priceInput.fill("999");
      await priceInput.blur();
      await expect(page.locator("table tbody tr").first().locator("td").nth(4)).toContainText("999");
    });

    await test.step("back to live: the live version's price is untouched", async () => {
      await page.getByRole("button", { name: /back to live/i }).click();
      await expect(page).not.toHaveURL(/[?&]v=\d+/, { timeout: 20000 });
      const priceCell = page.locator("table tbody tr").first().locator("td").nth(4);
      await expect(priceCell).not.toContainText("999");
      if (liveUnitPrice) await expect(priceCell).toContainText(liveUnitPrice.replace(/[^0-9.]/g, ""));
    });

    void projectUrl;
  });

  /**
   * Spec 2 — make live with a warehouse conflict: the dialog lists it, the
   * flip still succeeds, checked-out gear stays on the job (design §4.4/D6
   * — `makeLiveNative` LISTS conflicts, never blocks on them).
   */
  test("make live with a warehouse conflict lists it, flips anyway, keeps checked-out gear on the job", async ({ page }) => {
    test.setTimeout(150_000);
    const unique = Date.now();
    await setUpProjectWithOneLineItem(page, unique);

    await test.step("check the line item's unit out through the warehouse pipeline", async () => {
      await page.getByRole("link", { name: "Warehouse" }).click();
      await page.getByRole("tab", { name: /^Pick/ }).click();
      await page.locator("table thead").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Prep/ }).click();
      await page.getByRole("tab", { name: /^Prepped/ }).click();
      await page.locator("table thead").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Deploy/ }).click();
      await expect(page.getByRole("tab", { name: /^Deployed \(1\)/ })).toBeVisible({ timeout: 20000 });
    });

    await test.step("create a new version that removes the checked-out line", async () => {
      await page.goBack();
      await page.getByRole("tab", { name: "Equipment", exact: true }).click();
      await page.getByRole("button", { name: "Project versions" }).click();
      await page.getByRole("menuitem", { name: /new version/i }).click();
      await expect(page).toHaveURL(/[?&]v=\d+/, { timeout: 20000 });

      await page.getByRole("button", { name: "Item actions" }).first().click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.locator("table tbody tr")).toHaveCount(0, { timeout: 20000 });
    });

    await test.step("make this version live — the conflict (checked-out unit) is listed", async () => {
      await page.getByRole("button", { name: "Project versions" }).click();
      await page.getByRole("menuitem", { name: "Manage versions…" }).click();
      const panel = page.getByRole("dialog", { name: "Versions" });
      const nonLiveRow = panel.locator("div").filter({ hasText: /^v2/ }).first();
      await nonLiveRow.getByRole("button", { name: /actions/i }).click();
      await page.getByRole("menuitem", { name: /make v2 live/i }).click();

      const makeLiveDialog = page.getByRole("dialog", { name: /make v2 live/i });
      await makeLiveDialog.getByRole("button", { name: /^make v2 live$/i }).click();
      await expect(makeLiveDialog.getByText(/needs? a look/i)).toBeVisible({ timeout: 20000 });
      await makeLiveDialog.getByRole("button", { name: /done/i }).click();
    });

    await test.step("the checked-out gear stays on the job (still shown as deployed in the warehouse)", async () => {
      await page.getByRole("link", { name: "Warehouse" }).click();
      await expect(page.getByRole("tab", { name: /^Deployed \(1\)/ })).toBeVisible({ timeout: 20000 });
    });
  });

  /**
   * Spec 3 — quote from a non-live version. BLOCKED on Phase 6 (#1233,
   * "quoting a non-live version"), which doesn't exist yet — the quote/send
   * workflow (`project-quote-rail.tsx`, the older FEATUREDOCS/70 program)
   * is still keyed off `projects.revision`/live totals, with no way to
   * target an arbitrary `projectVersions` row. Written as a stub per this
   * phase's own instructions ("don't fake it") rather than skipped silently
   * with no explanation.
   */
  test.skip("quote from a non-live version (blocked on Phase 6 / #1233)", async () => {
    // Intentionally not implemented — depends on Phase 6 wiring the quote/
    // send workflow onto the real `projectVersions` table. Remove this
    // `.skip()` and write the real steps once #1233 lands.
  });
});
