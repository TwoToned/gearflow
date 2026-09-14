import { expect, test } from "@playwright/test";
import { resetHarnessDb } from "./harness-db-reset";
import { createOrgSkipAll, harnessUser, inviteAndGetInvitationId } from "./harness-helpers";

/**
 * D5 (#1109) spec 2, the join path: an existing org invites a new email,
 * the invitee accepts, and lands directly in that org — the wizard
 * (`/setup`) is never shown to them, unlike the org-creator's own path.
 * Membership only ever comes from invite-accept (or SSO/site-admin), never
 * a silent auto-join (#1071, D1 §4.2), so this is the ONLY path a second
 * person into an existing org can take.
 *
 * There's no copyable invite link in the UI (invitations are delivered by
 * email only) and no seed-data API reachable from Playwright, so the
 * invitation id is read straight out of Postgres after a real invite is
 * sent through Settings > Team — see `inviteAndGetInvitationId`.
 */
test.describe("harness: invite / join path", () => {
  test.skip(!process.env.E2E_HARNESS, "requires the seeded Convex harness (E2E_HARNESS=1)");

  test.beforeEach(async () => {
    await resetHarnessDb();
  });

  test("invited email -> accept -> lands in the org, /setup never shown", async ({ browser, page }) => {
    test.setTimeout(90_000);

    const owner = harnessUser("invite-owner");
    const invitee = harnessUser("invite-invitee");
    const orgName = `Invite Join Org ${Date.now()}`;
    const visitedUrls: string[] = [];

    await test.step("owner registers -> creates the org (skip everything, not the point of this test)", async () => {
      await page.goto("/register");
      await page.getByLabel(/name/i).first().fill(owner.name);
      await page.getByLabel(/email/i).first().fill(owner.email);
      await page.getByLabel(/password/i).first().fill(owner.password);
      await page
        .getByRole("button", { name: /create|register|sign up/i })
        .first()
        .click();
      await expect(page).toHaveURL(/\/welcome\b/, { timeout: 20000 });
      await createOrgSkipAll(page, orgName);
    });

    const invitationId = await test.step("owner invites the second user", async () => {
      return inviteAndGetInvitationId(page, invitee.email);
    });

    // A fresh browser context — a completely separate cookie jar — so the
    // invitee's registration/accept flow is genuinely unauthenticated at the
    // start, exactly like a real person opening the invite email on their
    // own device, not a second tab riding the owner's session.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    inviteePage.on("framenavigated", (frame) => {
      if (frame === inviteePage.mainFrame()) visitedUrls.push(new URL(frame.url()).pathname);
    });

    try {
      await test.step("invitee registers via the invite link (email pre-locked) -> auto-redirects to /invite/[id]", async () => {
        await inviteePage.goto(`/register?invite=${invitationId}`);
        const emailInput = inviteePage.getByLabel(/email/i).first();
        await expect(emailInput).toHaveValue(invitee.email, { timeout: 20000 });
        await expect(emailInput).toBeDisabled();
        await inviteePage.getByLabel(/name/i).first().fill(invitee.name);
        await inviteePage.getByLabel(/password/i).first().fill(invitee.password);
        await inviteePage
          .getByRole("button", { name: /create|register|sign up/i })
          .first()
          .click();
        await expect(inviteePage).toHaveURL(new RegExp(`/invite/${invitationId}$`), { timeout: 20000 });
      });

      await test.step("accept -> lands in the org's dashboard", async () => {
        await inviteePage.getByRole("button", { name: "Accept Invitation" }).click();
        // A role locator, not getByText: sonner's own toast ("Invitation
        // accepted!") is a case-insensitive substring match of the heading
        // text too, and getByText's default matching is case-insensitive.
        await expect(inviteePage.getByRole("heading", { name: "Invitation Accepted" })).toBeVisible({
          timeout: 20000,
        });
        await expect(inviteePage).toHaveURL(/\/dashboard\b/, { timeout: 20000 });
        // The org this member landed in is the one they were invited to, not
        // a bare authenticated shell with no org context.
        await expect(inviteePage.getByText(orgName)).toBeVisible({ timeout: 20000 });
      });

      await test.step("the wizard (/setup) was never shown at any point in this member's path", async () => {
        expect(visitedUrls).not.toContain("/setup");
      });
    } finally {
      await inviteeContext.close();
    }
  });
});
