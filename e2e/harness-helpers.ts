import { Pool } from "pg";
import { expect, type Page } from "@playwright/test";

/**
 * Shared steps every `harness-*.spec.ts` file otherwise duplicated verbatim
 * (register → land on /welcome or /dashboard; create-org → all five wizard
 * screens, skipped or filled). Extracted while adding D5 (#1109)'s new
 * specs, which needed the same steps again — a fifth copy was the last straw.
 */

export interface HarnessUser {
  name: string;
  email: string;
  password: string;
}

/** A fresh, unique harness identity — every spec calls this once per actor
 *  (a join-path/org-switch spec needs more than one). */
export function harnessUser(label: string): HarnessUser {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: `${label} Test`,
    email: `e2e+${label}-${unique}@harness.local`,
    password: "harness-password-123",
  };
}

/** Registers a brand-new user and waits for the post-register landing (the
 *  create-vs-join fork at /welcome for the very first identity in an org, or
 *  straight to /dashboard for an invite-locked email — see registerInvitee). */
export async function registerNewUser(page: Page, user: HarnessUser): Promise<void> {
  await page.goto("/register");
  await page.getByLabel(/name/i).first().fill(user.name);
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page
    .getByRole("button", { name: /create|register|sign up/i })
    .first()
    .click();
  await page.waitForURL(/\/(dashboard|welcome|invite)\b/, { timeout: 20000 });
}

/** From /welcome (or already at /setup), create a fresh org and skip every
 *  optional wizard screen — the D3 "skip everything" path. Only the company
 *  name is required. No-ops if onboarding is already done (URL isn't
 *  /welcome or /setup) since the app never re-shows either once an org
 *  exists for the session. */
export async function createOrgSkipAll(page: Page, orgName: string): Promise<void> {
  if (new URL(page.url()).pathname === "/welcome") {
    await page.getByRole("button", { name: "Set up a new company" }).click();
    await page.waitForURL(/\/setup\b/, { timeout: 20000 });
  }
  if (new URL(page.url()).pathname !== "/setup") return;
  await page.getByLabel("Company name").fill(orgName);
  await page.getByRole("button", { name: "Create company" }).click();
  // Step 1's success lands on step 2 ("where you operate", C2 #1099), step 3
  // ("your brand", C3 #1101), step 4 ("how you work", C4 #1102), then step 5
  // ("your team & your gear", C5 #1103), all still at /setup.
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL(/\/dashboard\b/, { timeout: 20000 });
}

/** Create a model via the equipment registry (not the wizard's inline
 *  add-by-hand form) — the standalone path D5's specs use outside step 5. */
export async function createModel(page: Page, modelName: string): Promise<void> {
  await page.goto("/assets/models/new");
  await page.getByPlaceholder("e.g. Shure SM58").fill(modelName);
  await page.getByRole("button", { name: "Create model" }).click();
  await page.waitForURL(/\/assets\/models\/(?!new$)[^/]+$/, { timeout: 20000 });
}

/** Create a serialized asset for an already-created model — the asset tag
 *  is server-generated, never a form field. */
export async function createAssetForModel(page: Page, modelName: string): Promise<void> {
  await page.goto("/assets/registry/new");
  await page.getByRole("button", { name: "Select a model" }).click();
  await page.getByPlaceholder("Search models").fill(modelName);
  await page.getByRole("button", { name: modelName, exact: true }).click();
  await page.getByRole("button", { name: "Create asset" }).click();
  await page.waitForURL(/\/assets\/registry\/(?!new$)[^/]+$/, { timeout: 20000 });
}

/** Create a project with every optional field left at its default —
 *  Who and when -> What -> Review, two plain "Next" activations then "Create job".
 *  Returns the new project's id. */
export async function createProject(page: Page, projectName: string, code: string): Promise<string> {
  await page.goto("/projects/new");
  await page.getByPlaceholder("e.g. Summer Festival 2026").fill(projectName);
  // Project code normally auto-fills asynchronously (peekNextProjectNumber) —
  // type one directly rather than wait on it. Neither getByLabel (the
  // <Label> in project-wizard.tsx's Field helper has no htmlFor/id — plain
  // sibling markup, no programmatic association) nor getByPlaceholder (the
  // placeholder mutates from "e.g. PROJ-2026-0001" to "Auto: <n>" once the
  // async query resolves) works here — target the react-hook-form field
  // name directly instead, which is what the form itself is keyed on.
  await page.locator('input[name="projectNumber"]').fill(code);
  // .focus()+Enter, not .click() — sidesteps a Playwright locator-retry race
  // against the wizard's step-transition unmount (see harness-revenue-path's
  // identical comment; the underlying action always succeeds either way).
  // Who and when -> What -> Review: two "Next" activations (the draft is written at the first).
  // `exact`: the calendar's "Next month" button also contains the word.
  await page.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  // The first Next writes the draft job (async), so wait for the What step before pressing Next
  // again: a second press while the first is still in flight is the same step, not the next one.
  await expect(page.getByRole("button", { name: /^What/ })).toHaveAttribute("aria-current", "step", { timeout: 30000 });
  await page.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Create job" }).focus();
  await page.keyboard.press("Enter");
  // NOT /\/projects\/[^/]+$/ — trivially matches the literal "/projects/new"
  // creation page itself (see harness-revenue-path's identical comment).
  await page.waitForURL(/\/projects\/(?!new$)[^/]+$/, { timeout: 20000 });
  return new URL(page.url()).pathname.split("/")[2]!;
}

/** Add a model as a line item to an already-created project (the model must
 *  already have at least one asset for the availability check to clear). */
export async function addModelLineItem(page: Page, projectId: string, modelName: string): Promise<void> {
  await page.goto(`/projects/${projectId}`);
  await addModelViaAddBar(page, modelName);
}

/**
 * Add a model line from the Equipment tab's AddBar (UX 2a: it REPLACED the old "Add ▾" menu +
 * "Add equipment" dialog for the plain gear add; the dialog now opens only on a second Enter or
 * for sub-hire/custom/sale). Enter adds the line with a blank price (the server auto-prices) and
 * the server enforces availability: with exactly one asset and quantity 1 the add must succeed
 * without an overbook step, and the row must not be flagged short. The dialog's old "1
 * available" preview assertion became this: the line lands, and nothing says Short.
 */
export async function addModelViaAddBar(page: Page, modelName: string): Promise<void> {
  await page.getByRole("tab", { name: "Equipment", exact: true }).click();
  const bar = page.getByRole("combobox", { name: "Add to list" });
  await bar.fill(modelName);
  await page.getByRole("option", { name: new RegExp(modelName) }).first().waitFor({ timeout: 40000 });
  await bar.press("Enter");
  // The line lands in the table (a model row, not an error toast / overbook dialog).
  await expect(page.getByRole("button", { name: `${modelName} actions` })).toBeVisible({ timeout: 40000 });
  await expect(page.getByRole("dialog", { name: "Add equipment" })).toHaveCount(0);
  await expect(page.getByText(/Short \d/)).toHaveCount(0);
}

/** Send an invitation via Settings > Team, then read the invitation's id
 *  straight out of Postgres — there's no seed-data API reachable from
 *  Playwright and no copyable invite link in the UI (invitations are
 *  delivered by email only, src/lib/auth.ts's `sendInvitationEmail`), so
 *  this is the only way an E2E test can reach /invite/[id] without a real
 *  mailbox. Read-only: it doesn't touch anything `resetHarnessDb` wouldn't
 *  already have reset for a later file. */
export async function inviteAndGetInvitationId(page: Page, email: string): Promise<string> {
  await page.goto("/settings/team");
  // The Team page's primary opens the invite dialog (UX Phase 17); the role defaults to Member.
  await page.getByRole("button", { name: "Invite member" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  await dialog.getByLabel("Email address").fill(email);
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible({ timeout: 20000 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM "invitation" WHERE email = $1 AND status = 'pending' ORDER BY "createdAt" DESC LIMIT 1`,
      [email],
    );
    if (!rows[0]) throw new Error(`no pending invitation found for ${email}`);
    return rows[0].id;
  } finally {
    await pool.end();
  }
}
