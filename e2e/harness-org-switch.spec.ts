import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";
import { createModel, createOrgSkipAll, harnessUser, inviteAndGetInvitationId } from "./harness-helpers";

/**
 * D5 (#1109) spec 4, the org switcher: a user who belongs to two
 * organisations switches between them, and the second org's dashboard shows
 * NONE of the first org's entities (also tracked under #1072 — it belongs
 * to both). The switcher itself is membership-derived (design doc §4.3.1,
 * A2, `src/components/layout/user-nav.tsx`), so this is as much a
 * cross-tenant isolation proof (POLICY.md R-8.4.3) as a UI test.
 *
 * Self-serve org creation is capped to the platform's very first org (D7 —
 * the self-serve door stays shut until Phase B/#1067); getting a SECOND real
 * org (with its own real Convex-mirrored data, not a seeded row bypassing
 * the app entirely) needs a site admin to flip `allowOrgCreation` first. No
 * explicit self-promotion needed for that: `src/lib/auth.ts`'s
 * `databaseHooks.user.create.after` already auto-promotes the very first
 * user in the (Postgres) `user` table to `role: "admin"` — and thanks to
 * `resetHarnessDb()` truncating that table before this test, user A here
 * always IS that first user.
 */
test.describe("harness: org switcher (cross-tenant isolation)", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  test("a user in two orgs switches -> the other org's data never leaks across", async ({ browser, page }) => {
    test.setTimeout(150_000);

    const userA = harnessUser("switch-a");
    const userB = harnessUser("switch-b");
    const unique = Date.now();
    const org1Name = `Switch Org One ${unique}`;
    const org2Name = `Switch Org Two ${unique}`;
    const model1 = `E2E Switch Model One ${unique}`;
    const model2 = `E2E Switch Model Two ${unique}`;

    await test.step("user A registers (auto-promoted to site admin as the first user) -> creates org 1 -> creates its own model", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill(userA.name);
      await page.getByLabel(/email/i).first().fill(userA.email);
      await page.getByLabel(/password/i).first().fill(userA.password);
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/welcome\b/, { timeout: 20000 });
      await createOrgSkipAll(page, org1Name);
      await createModel(page, model1);
    });

    await test.step("as site admin, ensure org creation is allowed (explicit, not relying on the default)", async () => {
      await page.goto("/admin/settings");
      await expect(page).toHaveURL(/\/admin\/settings\b/, { timeout: 20000 });
      const allowToggle = page.getByRole("switch").first();
      if ((await allowToggle.getAttribute("aria-checked")) !== "true") {
        await allowToggle.click();
      }
      await page.getByRole("button", { name: /save settings/i }).click();
    });

    const org2 = await test.step("user B registers in a separate browser context -> creates org 2 -> creates its own model", async () => {
      const context = await browser.newContext();
      const bPage = await context.newPage();
      await bPage.goto("/register");
      await bPage.getByLabel(/name/i).first().fill(userB.name);
      await bPage.getByLabel(/email/i).first().fill(userB.email);
      await bPage.getByLabel(/password/i).first().fill(userB.password);
      await bPage
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      // Org creation is now allowed platform-wide, so user B also lands on
      // the create-vs-join fork, exactly like user A did.
      await expect(bPage).toHaveURL(/\/welcome\b/, { timeout: 20000 });
      await createOrgSkipAll(bPage, org2Name);
      await createModel(bPage, model2);
      const invitationId = await inviteAndGetInvitationId(bPage, userA.email);
      await context.close();
      return { invitationId };
    });

    await test.step("user A accepts the invite into org 2 -> now a member of both orgs", async () => {
      await page.goto(`/invite/${org2.invitationId}`);
      await page.getByRole("button", { name: "Accept Invitation" }).click();
      await expect(page.getByText("Invitation Accepted")).toBeVisible({ timeout: 20000 });
      await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
    });

    await test.step("switched into org 2 (post-accept active org) -> models list shows ONLY org 2's model", async () => {
      await page.goto("/assets/models");
      await expect(page.getByText(model2)).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(model1)).toHaveCount(0);
    });

    await test.step("switch back to org 1 via the Account menu -> models list shows ONLY org 1's model", async () => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menuitem", { name: org1Name }).click();
      await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 20000 });

      await page.goto("/assets/models");
      await expect(page.getByText(model1)).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(model2)).toHaveCount(0);
    });
  });
});
