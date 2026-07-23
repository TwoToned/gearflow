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

  describe("XSS hardening (POLICY.md R-8.11.3)", () => {
    const XSS_PAYLOAD = `'<img src=x onerror=alert(1)>'`;
    const ESCAPED_PAYLOAD = "&#39;&lt;img src=x onerror=alert(1)&gt;&#39;";

    it("escapes orgName, inviterName, and role in invitationEmail", () => {
      const email = invitationEmail({
        orgName: XSS_PAYLOAD,
        inviterName: XSS_PAYLOAD,
        role: XSS_PAYLOAD,
        acceptUrl: "https://x/accept",
      });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName and role in invitationRegisterEmail", () => {
      const email = invitationRegisterEmail({
        orgName: XSS_PAYLOAD,
        role: XSS_PAYLOAD,
        registerUrl: "https://x/r",
      });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName and newRole in roleChangedEmail", () => {
      const email = roleChangedEmail({ orgName: XSS_PAYLOAD, newRole: XSS_PAYLOAD });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName in removedFromOrgEmail", () => {
      const email = removedFromOrgEmail({ orgName: XSS_PAYLOAD });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName and role in ssoAccessApprovedEmail", () => {
      const email = ssoAccessApprovedEmail({
        orgName: XSS_PAYLOAD,
        role: XSS_PAYLOAD,
        dashboardUrl: "https://x/d",
      });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName and note in ssoAccessRejectedEmail", () => {
      const email = ssoAccessRejectedEmail({ orgName: XSS_PAYLOAD, note: XSS_PAYLOAD });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      expect(email.html).toContain(ESCAPED_PAYLOAD);
    });

    it("escapes orgName, testTagId, description, and location in testTagDigestEmail", () => {
      const email = testTagDigestEmail({
        orgName: XSS_PAYLOAD,
        overdueAssets: [
          {
            testTagId: XSS_PAYLOAD,
            description: XSS_PAYLOAD,
            location: XSS_PAYLOAD,
            nextDueDate: new Date("2026-01-01"),
          },
        ],
        dueSoonAssets: [],
      });
      expect(email.html).not.toContain(XSS_PAYLOAD);
      // orgName appears twice (heading subject + intro paragraph), plus testTagId,
      // description, and location once each — 5 escaped occurrences total.
      expect(email.html.split(ESCAPED_PAYLOAD).length - 1).toBe(5);
    });
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
