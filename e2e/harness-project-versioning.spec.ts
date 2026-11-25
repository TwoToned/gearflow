import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";
import { addModelViaAddBar } from "./harness-helpers";

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
type Page = import("@playwright/test").Page;

/** UX 7 (§6b, D92): the version pill is gone; the version lives in the job
 *  header's ⋯ as `Version ▸` (one submenu level). Opens that submenu. */
async function openVersionMenu(page: Page): Promise<void> {
  await page.locator("#job-header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Version/ }).click();
}

/** UX 7: the job page's Warehouse button moved into the header ⋯. The
 *  sidebar's "Warehouse" link is the floor, not this job. */
async function openJobWarehouse(page: Page): Promise<void> {
  await page.locator("#job-header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Warehouse page" }).click();
  await expect(page).toHaveURL(/\/warehouse\/[^/?]+/);
}

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
      await page.locator('input[name="projectNumber"]').fill(`E2E-${Date.now()}`);
      await page.getByRole("button", { name: "Next" }).focus();
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("button", { name: "Create job" }).click();
      await expect(page).toHaveURL(/\/projects\/(?!new$)[^/]+$/, { timeout: 20000 });
      projectUrl = page.url();
    });

    await test.step("add the model as a line item", async () => {
      // UX 2a: the AddBar replaced "Add ▾ > Add item" + the Add equipment dialog.
      await addModelViaAddBar(page, modelName);
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
      await openVersionMenu(page);
      await page.getByRole("menuitem", { name: /new version/i }).click();
      // Switching to the new version updates the header pill and the URL's
      // `?v=` param (design §3.1 — per-user, never a DB field).
      await expect(page).toHaveURL(/[?&]v=\d+/, { timeout: 20000 });
    });

    await test.step("the header's viewing strip announces a non-live, editable version", async () => {
      await expect(page.getByText(/a draft, editable on Equipment and Finance/i)).toBeVisible();
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
      await openJobWarehouse(page);
      // Stage strip (StageFilter toggles named "<word> <count>") + the section's "Select all in …" box.
      const stage = (word: RegExp) => page.getByRole("toolbar", { name: "Job stage" }).getByRole("button", { name: word });
      const tickAll = page.getByRole("checkbox", { name: /^Select all in/ }).first();
      await stage(/^To pick/).click();
      await tickAll.click();
      await page.getByRole("button", { name: /^Prep( \d+)?( \+ accessories)?$/ }).click();
      await stage(/^Prepped/).click();
      await tickAll.click();
      await page.getByRole("button", { name: /^Deploy \(\d+\)$/ }).click();
      await expect(stage(/^Out 1$/)).toBeVisible({ timeout: 20000 });
    });

    await test.step("create a new version that removes the checked-out line", async () => {
      await page.goBack();
      await page.getByRole("tab", { name: "Equipment", exact: true }).click();
      await openVersionMenu(page);
      await page.getByRole("menuitem", { name: /new version/i }).click();
      await expect(page).toHaveURL(/[?&]v=\d+/, { timeout: 20000 });

      await page.getByRole("button", { name: "Item actions" }).first().click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.locator("table tbody tr")).toHaveCount(0, { timeout: 20000 });
    });

    await test.step("make this version live — the conflict (checked-out unit) is listed", async () => {
      await openVersionMenu(page);
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
      await openJobWarehouse(page);
      await expect(page.getByRole("toolbar", { name: "Job stage" }).getByRole("button", { name: /^Out 1$/ })).toBeVisible({ timeout: 20000 });
    });
  });

  /**
   * Spec 3 — quote from a non-live version.
   *
   * #1233 (Phase 6) landed the BACKEND half this spec was originally blocked
   * on: `quotesWrites.sendNative({ versionId })` can target any real
   * `projectVersions` row (D19 — two versions can hold SENT quotes at once),
   * `buildQuoteSnapshot`/the react-pdf pipeline render THAT version's own
   * content, and `markAcceptedNative` composes make-live (D20). This is
   * proven at the Convex layer by `quotesWrites.test.ts`'s "#1233 Phase 6"
   * describe block (multi-version SENT, drift, re-send-reuses-row, accept =
   * make live) and `src/server/finance-documents.test.ts` (a non-live send
   * is frozen exactly like a live one).
   *
   * **The #1221 follow-up (post-Phase 6) closed the missing UI half** this
   * spec was ALSO blocked on: `project-quote-rail.tsx` (the Finance tab) now
   * takes an optional `versionContext` and offers "Send v{N}'s quote" while
   * viewing a non-live version, targeting `useQuoteWrites().send({
   * versionId })` — see FEATUREDOCS/78's Phase 6 section for the write-up.
   * jsdom-level coverage of that UI lives in
   * `src/components/projects/__tests__/project-quote-rail-versioning.smoke.test.tsx`
   * and `send-quote-dialog.smoke.test.tsx`'s own `targetVersion` block; THIS
   * spec is the end-to-end proof that the real page wires it together: a
   * client-assigned project, a real "New version", a real send, and the
   * live version's `pricingLocked` staying untouched (D55 — only a LIVE
   * send raises the lock).
   *
   * **Honesty note** (same standing instruction as specs 1-2 above): this
   * sandbox has no live Convex deployment and no way to run the seeded
   * harness — this spec is written and believed correct against the actual
   * app UI (every selector below is read from the real component source,
   * not guessed — `project-wizard.tsx`'s edit-mode step reachability,
   * `combobox-picker.tsx`'s "New client" affordance, `quick-create-client.tsx`'s
   * field labels, `project-quote-rail.tsx`/`send-quote-dialog.tsx`'s own
   * accessible names) but it has NOT been executed and confirmed green here.
   */
  test("quote from a non-live version — sends it, keeps the live version's pricing unlocked (#1233 UI follow-up)", async ({ page }) => {
    test.setTimeout(150_000);
    const unique = Date.now();
    const { projectUrl } = await setUpProjectWithOneLineItem(page, unique);

    // ProjectQuoteRail requires a client before it'll render the quote
    // workflow at all (ASSIGN_CLIENT_FOR_QUOTES_MESSAGE) — the creation
    // wizard's "Continue" x3 flow in `setUpProjectWithOneLineItem` never set
    // one, so assign it now via the edit page (same `ProjectWizard`, all
    // steps reachable directly in edit mode).
    await test.step("assign a client to the project (quick-create, then Save changes)", async () => {
      await page.goto(`${projectUrl}/edit`);
      await page.getByRole("button", { name: /select client/i }).click();
      await page.getByRole("button", { name: "New client" }).click();

      const quickCreate = page.getByRole("dialog", { name: "New client" });
      await quickCreate.getByLabel("Name").fill(`E2E Versioning Client ${unique}`);
      await quickCreate.getByRole("button", { name: "Create" }).click();
      await expect(quickCreate).toBeHidden();

      // Edit mode: every step is reachable directly (no need to click
      // through Schedule/Site) — jump straight to Review and save.
      await page.getByRole("button", { name: /review/i }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a new (non-live) version on the Finance tab", async () => {
      await page.getByRole("tab", { name: "Finance", exact: true }).click();
      await openVersionMenu(page);
      await page.getByRole("menuitem", { name: /new version/i }).click();
      await expect(page).toHaveURL(/[?&]v=\d+/, { timeout: 20000 });
      await expect(page.getByText(/a draft, editable on Equipment and Finance/i)).toBeVisible();
    });

    await test.step("send v2's quote — version-labelled, never the old quote-revision \"v1\"", async () => {
      const sendTrigger = page.getByRole("button", { name: /send v2.s quote/i });
      await expect(sendTrigger).toBeVisible();
      await sendTrigger.click();

      // The old live-only preview link must be ABSENT here (#987 — it always
      // renders the LIVE project, never a specific non-live version).
      await expect(page.getByRole("link", { name: /preview draft/i })).toHaveCount(0);

      await page.getByRole("button", { name: /^send v2.s quote$/i }).click();
      await expect(page.getByText(/v2.s quote sent/i)).toBeVisible({ timeout: 20000 });
      // D55 — a non-live send never claims pricing is locked.
      await expect(page.getByText(/pricing is now locked/i)).toHaveCount(0);
      await page.getByRole("button", { name: "Done" }).click();
    });

    await test.step("the sent quote shows SENT, tagged to project version 2 — nothing hidden (D19)", async () => {
      await expect(page.getByText("SENT")).toBeVisible();
      await expect(page.getByText("for job version 2")).toBeVisible();
    });

    await test.step("back to live: v1's pricing is untouched — no lock, no non-live Send verb", async () => {
      await page.getByRole("button", { name: /back to live/i }).click();
      await expect(page).not.toHaveURL(/[?&]v=\d+/, { timeout: 20000 });
      // State 1 (live, unlocked) renders NO strip at all — sending v2's
      // quote must never raise `pricingLocked` on the live version.
      await expect(page.locator("#version-strip")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /send v\d+.s quote/i })).toHaveCount(0);
      // v2's SENT quote still lists here (project-scoped, not version-
      // scoped, R-3.1) — it must not disappear just because live is viewed.
      await expect(page.getByText("SENT")).toBeVisible();
    });
  });
});
