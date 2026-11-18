import { describe, expect, test } from "vitest";
import { redactArgs } from "./request-log-redact";

const R = "[redacted]";

describe("redactArgs: client handover contact (UX 5b)", () => {
  test("the three client pick up / drop off fields are redacted", () => {
    const out = redactArgs({ clientContactName: "Priya", clientContactPhone: "0412", clientVehicle: "Van CXQ 412", id: "s1" });
    expect(out).toEqual({ clientContactName: R, clientContactPhone: R, clientVehicle: R, id: "s1" });
  });

  test("fails closed on the shape: contact name/phone/email and phone/email suffixes, any case", () => {
    const out = redactArgs({
      siteContactName: "a", SITECONTACTPHONE: "b", billingContactEmail: "c", mobilePhone: "d", supplierEmail: "e",
    });
    expect(Object.values(out).every((v) => v === R)).toBe(true);
  });

  test("ordinary non-PII fields are untouched (no bare name match)", () => {
    const args = { title: "Bump in", description: "x", vehicleDescription: "3t truck", crewRoleId: "r1", type: "CLIENT_PICKUP", scheduledTime: "10:00" };
    expect(redactArgs(args)).toEqual(args);
  });

  test("nested patches are scrubbed too", () => {
    expect(redactArgs({ fields: { clientContactPhone: "0412", title: "t" } })).toEqual({ fields: { clientContactPhone: R, title: "t" } });
  });
});
