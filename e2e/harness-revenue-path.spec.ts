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

  // Quarantined (POLICY.md R-8.8.4): #1071 deleted the single-org auto-join
  // hook, which is what silently gave every OTHER harness spec file's fresh
  // registrant org membership for free. This file's "complete onboarding if
  // needed" step now correctly can't create a second org once another
  // harness spec has already bootstrapped one in the shared harness DB — an
  // E2E test-isolation gap, not a product bug.
  // Owner: Jayden (eng). Tracked: #1118. Deadline: 2026-08-15.
  test("project -> line item -> availability -> check-out -> return @quarantine", async ({ page }) => {
    // Playwright's default test timeout is 30s — a budget for the WHOLE test,
    // not per test.step. This flow chains register -> onboard -> model ->
    // asset -> project (4 wizard steps) -> line item + an async availability
    // check -> warehouse pipeline across several page loads, each hitting
    // Postgres + Convex; under this environment's demonstrated latency (100-
    // 300ms even for simple queries) that easily exceeds 30s in total even
    // though every individual step is fast enough on its own. 240s (not the
    // original 180s): the first GitHub-hosted-runner run (#725/#753) hit the
    // 180s ceiling on its first attempt running last in the harness job, after
    // ~6 prior tests had already been driving the same shared Postgres +
    // self-hosted Convex backend on a 2-core runner — this is genuinely
    // slower than the local dev machine this was first tuned against.
    test.setTimeout(240_000);

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
      const projectCodeInput = page.locator(
        "xpath=//input[@placeholder='e.g. Summer Festival 2026']/parent::div/following-sibling::div[1]//input",
      );
      await projectCodeInput.fill(`E2E-${unique}`);

      // Basics -> Schedule -> Site -> Review: every other field is optional, so
      // three plain "Continue" activations get through from here.
      //
      // .focus()+Enter, not .click(): a raw .click() on this exact 3x-Continue
      // sequence is prone to a Playwright locator-retry race against the
      // wizard's step-transition unmount (the just-clicked button detaches
      // mid-retry, so .click() times out waiting for a stable target even
      // though the underlying action — and the project creation itself —
      // already succeeded). Root-caused chasing #858/R-8.8.3; this sidesteps
      // it without masking the real (tracked separately, #894) step-transition
      // focus-loss bug.
      await page.getByRole("button", { name: "Continue" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Continue" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Continue" }).focus();
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
      // #1061 — a project now lands on the Overview tab (its home), not
      // Equipment. The "Add ▾" menu is portalled into the tab row BY the
      // Equipment tab, so it only exists once that tab is selected. Clicking
      // through is what a real operator does, and it keeps this step honest
      // about the extra hop rather than hiding it behind a `?tab=` deep link.
      await page.getByRole("tab", { name: "Equipment", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add item" }).click();
      // WS3 (#942) added a persistent "Overbookings" sidebar nav item, which
      // matches a page-wide /overbook/i locator used below — but the model
      // search ("Search models" button) opens a Radix Popover/Command portalled
      // to document.body as a SIBLING of the dialog, not a DOM descendant, so
      // it can't be reached through a dialog-scoped locator (that hung forever
      // waiting for a placeholder that's structurally outside the dialog root —
      // see CLAUDE.md's Radix-portal note). Keep the search flow unscoped on
      // `page`, and only scope the two assertions that actually collide with
      // the sidebar text (title "Add equipment" for the "Own stock" tab/kind).
      const addDialog = page.getByRole("dialog", { name: "Add equipment" });
      await page.getByRole("tab", { name: "Own stock" }).click();
      await page.getByRole("button", { name: "Search models" }).click();
      await page.getByPlaceholder(/Search by name/).fill(modelName);
      await page.getByRole("button", { name: modelName, exact: true }).click();

      // Availability check (flow 7) is inline and automatic here: with exactly
      // one asset created above and quantity defaulted to 1, it renders
      // "1 available out of 1 ..." with no overbook warning/checkbox to confirm.
      // The check itself is async (a Convex query) and can start from a 0/0
      // placeholder before the real count resolves — under CI load that can take
      // a while, so wait for the SPECIFIC "1 available" text (not just the
      // generic "available out of" phrase, which matches the placeholder too)
      // before asserting there's no overbook warning.
      await expect(addDialog.getByText(/1 available/i)).toBeVisible({ timeout: 40000 });
      await expect(addDialog.getByText(/overbook/i)).toHaveCount(0);

      await page.getByRole("button", { name: "Add to project" }).click();
      // The dialog closes on a successful add.
      await expect(page.getByRole("button", { name: "Add to project" })).toBeHidden();
    });

    await test.step("check the gear out through the warehouse pipeline (flow 8)", async () => {
      // getByRole("link", { name: "Warehouse" }) is ambiguous: the app sidebar's
      // global nav item (-> /warehouse) and the mobile nav both use the exact
      // same label, alongside this project page's own button (-> /warehouse/
      // [projectId]). Scope by href to target the project-specific one only.
      await page.locator(`a[href="/warehouse/${projectId}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/warehouse/${projectId}$`));

      // Every click here races the Assign-assets dialog, not just the ones
      // immediately after Prep/Deploy: its appearance is genuinely
      // unpredictable (looks tied to an async per-item check, not a specific
      // click), and a single unprotected click anywhere in this sequence is
      // enough to hang the whole test on a swallowed click if the dialog
      // reopens between the previous check and this click — exactly what
      // happened in CI (the "Prepped" tab click itself was unprotected).
      await clickRacingAssignDialog(page, page.getByRole("tab", { name: /^Pick/ }));
      await clickRacingAssignDialog(page, page.locator("table thead").getByRole("checkbox"));
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Prep/ }));
      await resolveAssignAssetsDialogIfPresent(page);

      await clickRacingAssignDialog(page, page.getByRole("tab", { name: /^Prepped/ }));
      await clickRacingAssignDialog(page, page.locator("table thead").getByRole("checkbox"));
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Deploy/ }));
      await resolveAssignAssetsDialogIfPresent(page);

      await expect(page.getByRole("tab", { name: /^Deployed \(1\)/ })).toBeVisible();
    });

    await test.step("return the gear (flow 9)", async () => {
      await clickRacingAssignDialog(page, page.getByRole("tab", { name: /^Deployed/ }));
      await clickRacingAssignDialog(page, page.locator("table thead").getByRole("checkbox"));
      // Condition defaults to "Good" — happy path needs no extra input.
      await clickRacingAssignDialog(page, page.getByRole("button", { name: /^Return/ }));

      await expect(page.getByRole("tab", { name: /^Returned \(1\)/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Deployed \(0\)/ })).toBeVisible();
    });
  });
});
