import { describe, expect, it } from "vitest";
import {
  flaggedAssetEmail,
  overdueMaintenanceEmail,
  overdueReturnEmail,
  pendingInvitationEmail,
  pendingOffersEmail,
  pendingTimesheetsEmail,
  upcomingProjectEmail,
} from "@/lib/notification-emails";

const XSS_PAYLOAD = `'<img src=x onerror=alert(1)>'`;
const ESCAPED_PAYLOAD = "&#39;&lt;img src=x onerror=alert(1)&gt;&#39;";

const base = {
  recipientName: XSS_PAYLOAD,
  orgName: XSS_PAYLOAD,
  appBaseUrl: "https://app.example.com",
  href: "/x",
  notificationKey: "k",
};

describe("notification emails — XSS hardening (POLICY.md R-8.11.3)", () => {
  it("escapes recipientName, orgName, title, description in overdueMaintenanceEmail", () => {
    const email = overdueMaintenanceEmail({
      ...base,
      title: XSS_PAYLOAD,
      description: XSS_PAYLOAD,
      scheduledDate: null,
    });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes recipientName, orgName, projectNumber, projectName in overdueReturnEmail", () => {
    const email = overdueReturnEmail({
      ...base,
      projectNumber: XSS_PAYLOAD,
      projectName: XSS_PAYLOAD,
      rentalEndDate: null,
      itemsDeployed: 1,
    });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes recipientName, orgName, projectNumber, projectName in upcomingProjectEmail", () => {
    const email = upcomingProjectEmail({
      ...base,
      projectNumber: XSS_PAYLOAD,
      projectName: XSS_PAYLOAD,
      rentalStartDate: null,
    });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes invitingOrgName and role in pendingInvitationEmail", () => {
    const email = pendingInvitationEmail({
      ...base,
      invitingOrgName: XSS_PAYLOAD,
      role: XSS_PAYLOAD,
    });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes recipientName and orgName in pendingOffersEmail", () => {
    const email = pendingOffersEmail({ ...base, count: 3 });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes recipientName and orgName in pendingTimesheetsEmail", () => {
    const email = pendingTimesheetsEmail({ ...base, count: 2 });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes assetLabel, reason, projectNumber, projectName in flaggedAssetEmail", () => {
    const email = flaggedAssetEmail({
      ...base,
      assetLabel: XSS_PAYLOAD,
      reason: XSS_PAYLOAD,
      projectNumber: XSS_PAYLOAD,
      projectName: XSS_PAYLOAD,
    });
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });
});
