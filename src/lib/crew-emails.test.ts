import { describe, expect, it } from "vitest";
import {
  crewBulkMessageEmail,
  crewCancellationEmail,
  crewConfirmationEmail,
  crewOfferEmail,
  crewUpdateEmail,
} from "@/lib/crew-emails";

const XSS_PAYLOAD = `'<img src=x onerror=alert(1)>'`;
const ESCAPED_PAYLOAD = "&#39;&lt;img src=x onerror=alert(1)&gt;&#39;";

const baseAssignment = {
  crewFirstName: XSS_PAYLOAD,
  projectName: XSS_PAYLOAD,
  projectNumber: XSS_PAYLOAD,
  roleName: XSS_PAYLOAD,
  phase: null,
  startDate: "2026-08-01",
  endDate: null,
  startTime: null,
  endTime: null,
  locationName: XSS_PAYLOAD,
  locationAddress: null,
  siteContactName: XSS_PAYLOAD,
  siteContactPhone: null,
  notes: XSS_PAYLOAD,
  orgName: XSS_PAYLOAD,
};

describe("crew emails — XSS hardening (POLICY.md R-8.11.3)", () => {
  it("escapes every user-controlled field in crewOfferEmail", () => {
    const email = crewOfferEmail(baseAssignment, "https://x/accept", "https://x/decline");
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes every user-controlled field in crewConfirmationEmail", () => {
    const email = crewConfirmationEmail(baseAssignment);
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes every user-controlled field in crewCancellationEmail", () => {
    const email = crewCancellationEmail(baseAssignment);
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes every user-controlled field in crewUpdateEmail", () => {
    const email = crewUpdateEmail(baseAssignment);
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });

  it("escapes the free-text message in crewBulkMessageEmail", () => {
    const email = crewBulkMessageEmail(
      XSS_PAYLOAD,
      XSS_PAYLOAD,
      XSS_PAYLOAD,
      XSS_PAYLOAD,
      XSS_PAYLOAD,
      XSS_PAYLOAD,
    );
    expect(email.html).not.toContain(XSS_PAYLOAD);
    expect(email.html).toContain(ESCAPED_PAYLOAD);
  });
});
