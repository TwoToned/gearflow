import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";
import { addModelViaAddBar } from "./harness-helpers";

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

  /**
   * Root cause of the R-8.8.3 "stuck dialog after Prep" bug (docs/e2e-harness.md):
   * clicking Prep/Deploy can open an "Assign assets" dialog (pick the specific
   * serial via a combobox) even when there's only one candidate asset — its own
   * action button stays disabled until a selection is made. This test never
   * filled it, so the dialog sat open forever, swallowing every click behind it.
   * Its appearance is timing-sensitive (looks tied to an async per-item
   * availability check, not the click itself), so callers race it against the
   * next interaction rather than checking once right after the triggering click.
   */
  async function resolveAssignAssetsDialogIfPresent(page: import("@playwright/test").Page) {
    const assignDialog = page.getByRole("dialog", { name: "Assign assets" });
    if (!(await assignDialog.isVisible({ timeout: 2000 }).catch(() => false))) return false;
    const combobox = assignDialog.getByRole("combobox").first();
    await combobox.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const actionBtn = assignDialog.getByRole("button", { name: /^(Prep|Deploy)$/ });
    await expect(actionBtn).toBeEnabled({ timeout: 5000 });
    await actionBtn.click();
    await expect(assignDialog).toBeHidden({ timeout: 10000 });
    return true;
  }

  async function clickRacingAssignDialog(
    page: import("@playwright/test").Page,
    locator: ReturnType<import("@playwright/test").Page["locator"]>,
  ) {
    for (let i = 0; i < 10; i++) {
      if (await resolveAssignAssetsDialogIfPresent(page)) continue;
      try {
        await locator.click({ timeout: 2000 });
        return;
      } catch {
        // keep racing the dialog
      }
    }
    await locator.click({ timeout: 5000 });
  }

  // #1118 fix: restore this file's own "fresh Better Auth DB" (every harness
  // file's docstring already assumes one) rather than sharing whatever state
  // an earlier file in the same CI job left behind — see harness-db-reset.ts.
  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  test("project -> line item -> availability -> check-out -> return", async ({ page }) => {
    // Playwright's default test timeout is 30s — a budget for the WHOLE test,
    // not per test.step. This flow chains register -> onboard -> model ->
    // asset -> project (4 wizard steps) -> line item + an async availability
    // check -> warehouse pipeline across several page loads, each hitting
    // Postgres + Convex; under this environment's demonstrated latency (100-
    // 300ms even for simple queries) that easily exceeds 30s in total even
    // though every individual step is fast enough on its own. 300s (not the
    // original 180s, then 240s): the first GitHub-hosted-runner run
    // (#725/#753) hit the 180s ceiling on its first attempt running last in
    // the harness job, after ~6 prior tests had already been driving the
    // same shared Postgres + self-hosted Convex backend on a 2-core runner —
    // 240s absorbed that, but D5 (#1109) added 3 more full-flow specs to the
    // same job, raising the shared load again and hitting the 240s ceiling
    // on the "create a project" step specifically (#1210's first CI run).
    test.setTimeout(300_000);

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
      // A fresh registration with no org lands on the create-vs-join fork
      // (/welcome, #1092) rather than an authenticated dashboard directly.
      await expect(page).toHaveURL(/\/(dashboard|welcome)\b/, { timeout: 20000 });
    });

    await test.step("complete onboarding (create the org) if needed", async () => {
      // The (app) layout redirects every route to /welcome until an org
      // exists (src/app/(app)/layout.tsx) — a fresh registration on this harness
      // has no org yet, so this step is required before any protected page
      // (the model/asset/project forms below) will render at all. "Set up a
      // new company" leads to /setup, the actual create-org form.
      if (new URL(page.url()).pathname === "/welcome") {
        await page.getByRole("button", { name: "Set up a new company" }).click();
        await expect(page).toHaveURL(/\/setup\b/, { timeout: 20000 });
      }
      if (new URL(page.url()).pathname === "/setup") {
        await page.getByLabel("Company name").fill(`Revenue Path Org ${unique}`);
        await page.getByRole("button", { name: "Create company" }).click();
        // Step 1's success lands on step 2 ("where you operate", C2 #1099),
        // step 3 ("your brand", C3 #1101), step 4 ("how you work", C4
        // #1102), then step 5 ("your team & your gear", C5 #1103), all
        // still at /setup — skip all four, only the name is required (D3).
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.getByRole("button", { name: "Skip for now" }).click();
        await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
      }
    });

    await test.step("create an equipment model (flow 10: create inventory)", async () => {
      await page.goto("/assets/models/new");
      await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
      await page.getByRole("button", { name: "Create model" }).click();
      // Exclude the literal "new" segment (the create page itself) — see the
      // comment on the project-creation assertion below for why this matters.
      await expect(page).toHaveURL(/\/assets\/models\/(?!new$)[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a serialized asset for the model (asset tag auto-generated)", async () => {
      await page.goto("/assets/registry/new");
      await page.getByRole("button", { name: "Select a model" }).click();
      await page.getByPlaceholder("Search models").fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();
      await page.getByRole("button", { name: "Create asset" }).click();
      await expect(page).toHaveURL(/\/assets\/registry\/(?!new$)[^/]+$/, { timeout: 20000 });
    });

    await test.step("create a project (flow 5)", async () => {
      await page.goto("/projects/new");
      await page.getByPlaceholder("e.g. Summer Festival 2026").fill(projectName);

      // Project code normally auto-fills asynchronously (peekNextProjectNumber,
      // a server query) shortly after mount, and project-wizard.tsx's next()
      // step-0 guard blocks advancing while it's still empty — re-showing the
      // SAME "Continue" button rather than erroring loudly, which reads as a
      // hang rather than a validation failure. Under CI load that fetch can be
      // slow enough to matter, so type a code directly instead of waiting on
      // it — a real user hitting the same lag would do exactly this.
      //
      // Target the react-hook-form field name, not a structural xpath off the
      // Name field's placeholder: D2 (#1106, same day as this fix) wrapped
      // the Name field in a new data-tour-anchor div for coaching-tip
      // targeting, which silently broke the old parent/following-sibling
      // xpath (it no longer has a sibling div to land on). Neither
      // getByLabel (the Field helper's <Label> has no htmlFor/id) nor
      // getByPlaceholder (this field's placeholder mutates once the async
      // query resolves) works here either.
      await page.locator('input[name="projectNumber"]').fill(`E2E-${unique}`);

      // Who and when -> What -> Review (UX Phase 9): every other field is optional, so
      // two "Next" activations then "Create job" get through from here (the first Next
      // writes the draft).
      //
      // .focus()+Enter, not .click(): a raw .click() on this exact Next
      // sequence is prone to a Playwright locator-retry race against the
      // wizard's step-transition unmount (the just-clicked button detaches
      // mid-retry, so .click() times out waiting for a stable target even
      // though the underlying action — and the project creation itself —
      // already succeeded). Root-caused chasing #858/R-8.8.3; this sidesteps
      // it without masking the real (tracked separately, #894) step-transition
      // focus-loss bug.
      await page.getByRole("button", { name: "Next" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Next" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Create job" }).focus();
      await page.keyboard.press("Enter");
      // NOT /\/projects\/[^/]+$/ — that trivially matches the literal
      // "/projects/new" creation page itself (the segment "new" satisfies
      // "one or more non-slash characters" just as well as a real id), so the
      // assertion resolved instantly without ever waiting for the real
      // navigation, and every downstream use of `projectId` (extracted from
      // the URL right after) silently captured the string "new" instead of
      // an id. Exclude it explicitly so this actually waits for creation.
      await expect(page).toHaveURL(/\/projects\/(?!new$)[^/]+$/, { timeout: 20000 });
    });

    const projectId = new URL(page.url()).pathname.split("/")[2]!;

    await test.step("add the model as a line item + pricing (flow 6)", async () => {
      // #1061 — a project lands on the Overview tab; the helper clicks through to Equipment like
      // an operator. UX 2a: the AddBar REPLACED "Add ▾ > Add item" + the "Add equipment" dialog
      // for a plain gear add (spec reason: the control was deliberately removed). Availability
      // (flow 7) is now enforced by the server on add: with one asset and quantity 1 the line
      // lands with no overbook step and no "Short" flag (see addModelViaAddBar).
      await addModelViaAddBar(page, modelName);
    });

    await test.step("check the gear out through the warehouse pipeline (flow 8)", async () => {
      // UX 7: the job page's own Warehouse button moved into the job header's ⋯
      // (§6b, "Warehouse page"). The sidebar's global "Warehouse" link goes to
      // the floor (/warehouse), not this job, so open the header menu and pick
      // the job-scoped item; the URL assertion pins it to THIS job's page.
      await page.locator("#job-header").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Warehouse page" }).click();
      await expect(page).toHaveURL(new RegExp(`/warehouse/${projectId}$`));

      // Every click here races the Assign-assets dialog, not just the ones
      // immediately after Prep/Deploy: its appearance is genuinely
      // unpredictable (looks tied to an async per-item check, not a specific
      // click), and a single unprotected click anywhere in this sequence is
      // enough to hang the whole test on a swallowed click if the dialog
      // reopens between the previous check and this click — exactly what
      // happened in CI (the "Prepped" tab click itself was unprotected).
      // The job page's stage strip (StageFilter) replaced the tab row: each stage is a toggle button
      // named "<word> <count>"; rows are ticked through the section's "Select all in …" box.
      const stage = (word: RegExp) => page.getByRole("toolbar", { name: "Job stage" }).getByRole("button", { name: word });
      const tickAll = page.getByRole("checkbox", { name: /^Select all in/ }).first();

      await clickRacingAssignDialog(page, stage(/^To pick/));
      await clickRacingAssignDialog(page, tickAll);
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Prep( \d+)?( \+ accessories)?$/ }));
      await resolveAssignAssetsDialogIfPresent(page);

      await clickRacingAssignDialog(page, stage(/^Prepped/));
      await clickRacingAssignDialog(page, tickAll);
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Deploy \(\d+\)$/ }));
      await resolveAssignAssetsDialogIfPresent(page);

      await expect(stage(/^Out 1$/)).toBeVisible();
    });

    await test.step("return the gear (flow 9)", async () => {
      const stage = (word: RegExp) => page.getByRole("toolbar", { name: "Job stage" }).getByRole("button", { name: word });
      await clickRacingAssignDialog(page, stage(/^Out/));
      await clickRacingAssignDialog(page, page.getByRole("checkbox", { name: /^Select all in/ }).first());
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Return \(\d+\)$/ }));
      // The return check (spec §9.5) opens first: condition defaults to "Good", so the happy path just confirms it.
      const returnCheck = page.getByRole("dialog");
      await expect(returnCheck.getByRole("radio", { name: "Good" })).toBeChecked();
      await returnCheck.getByRole("button", { name: "Return", exact: true }).click();

      await expect(stage(/^Returned 1$/)).toBeVisible();
      await expect(stage(/^Out 0$/)).toBeVisible();
    });
  });
});
