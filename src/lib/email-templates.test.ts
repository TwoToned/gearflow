import { describe, expect, it } from "vitest";
import {
  invitationEmail,
  invitationRegisterEmail,
  passwordResetEmail,
  removedFromOrgEmail,
  roleChangedEmail,
  siteAdminInvitationEmail,
  ssoAccessApprovedEmail,
  ssoAccessRejectedEmail,
  testTagDigestEmail,
  verificationEmail,
} from "@/lib/email-templates";

const WRAPPER = 'style="font-family: sans-serif; max-width: 600px; margin: 0 auto;"';

describe("email templates", () => {
  it("all templates render the shared wrapper exactly once", () => {
    const rendered = [
      invitationEmail({ orgName: "Acme", role: "admin", acceptUrl: "https://x/accept" }),
      invitationRegisterEmail({ orgName: "Acme", role: "member", registerUrl: "https://x/r" }),
      siteAdminInvitationEmail({ registerUrl: "https://x/r" }),
      passwordResetEmail({ resetUrl: "https://x/reset" }),
      verificationEmail({ verifyUrl: "https://x/verify" }),
      roleChangedEmail({ orgName: "Acme", newRole: "manager" }),
      removedFromOrgEmail({ orgName: "Acme" }),
      ssoAccessApprovedEmail({ orgName: "Acme", role: "member", dashboardUrl: "https://x/d" }),
      ssoAccessRejectedEmail({ orgName: "Acme" }),
    ];
    for (const email of rendered) {
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html.split(WRAPPER)).toHaveLength(2); // wrapper appears once
    }
  });

  it("invitationEmail includes inviter, role, and CTA href", () => {
    const email = invitationEmail({
      orgName: "Acme",
      inviterName: "Dana",
      role: "admin",
      acceptUrl: "https://app/accept/123",
    });
    expect(email.subject).toContain("Acme");
    expect(email.html).toContain("Dana");
    expect(email.html).toContain("<strong>admin</strong>");
    expect(email.html).toContain('href="https://app/accept/123"');
    expect(email.html).toContain("Accept Invitation");
  });

  it("invitationEmail omits inviter phrasing when none is supplied", () => {
    const email = invitationEmail({ orgName: "Acme", role: "member", acceptUrl: "https://app/a" });
    expect(email.html).toContain("You've been invited to join <strong>Acme</strong>");
  });

  it("passwordResetEmail honours a custom platform name", () => {
    const email = passwordResetEmail({ resetUrl: "https://app/r", platformName: "Widgets" });
    expect(email.subject).toBe("Reset your Widgets password");
    expect(email.html).toContain('href="https://app/r"');
  });

  it("ssoAccessRejectedEmail includes the reason only when provided", () => {
    expect(ssoAccessRejectedEmail({ orgName: "Acme", note: "no seats" }).html).toContain(
      "Reason: no seats",
    );
    expect(ssoAccessRejectedEmail({ orgName: "Acme" }).html).not.toContain("Reason:");
  });

  describe("testTagDigestEmail", () => {
    const overdueAsset = {
      testTagId: "TT-001",
      description: "Extension lead",
      nextDueDate: new Date("2026-01-01"),
      location: "Warehouse A",
    };
    const dueSoonAsset = {
      testTagId: "TT-002",
      description: "Power board",
      nextDueDate: new Date("2026-02-01"),
      location: null,
    };

    it("leads with the overdue count when there are overdue items", () => {
      const email = testTagDigestEmail({
        orgName: "Acme",
        overdueAssets: [overdueAsset],
        dueSoonAssets: [dueSoonAsset],
      });
      expect(email.subject).toContain("1 overdue item — Acme");
      expect(email.html).toContain("TT-001");
      expect(email.html).toContain("Warehouse A");
      expect(email.html).toContain("TT-002");
      expect(email.html).toContain("Overdue (1)");
      expect(email.html).toContain("Due Soon (1)");
    });

    it("falls back to the due-soon count when nothing is overdue", () => {
      const email = testTagDigestEmail({
        orgName: "Acme",
        overdueAssets: [],
        dueSoonAssets: [dueSoonAsset],
      });
      expect(email.subject).toContain("1 item due soon — Acme");
      expect(email.html).not.toContain("Overdue (");
      expect(email.html).toContain("Due Soon (1)");
      // No location on this asset — renders the "-" placeholder, not "null".
      expect(email.html).not.toContain(">null<");
    });
  });
});
