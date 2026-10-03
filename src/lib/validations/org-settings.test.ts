import { describe, it, expect } from "vitest";
import { orgDocumentSettingsSchema, orgOperatingDetailsSchema, crewTimeSettingsSchema } from "./org-settings";

describe("orgDocumentSettingsSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(orgDocumentSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid values", () => {
    const result = orgDocumentSettingsSchema.safeParse({
      footerText: "RVLT Flow | hello@rvlt.app | 0400 000 000",
      footerSecondLine: "ABN 12 345 678 901",
      termsAndConditions: "All sales final.",
      showTermsAndConditionsOnInvoice: true,
      paymentDetails: "Bank: Test Bank\nBSB: 000-000\nAccount: 12345678",
      quoteValidityDays: 14,
    });
    expect(result.success).toBe(true);
  });

  it("accepts showTermsAndConditionsOnInvoice as a boolean, rejects a non-boolean", () => {
    expect(orgDocumentSettingsSchema.safeParse({ showTermsAndConditionsOnInvoice: false }).success).toBe(true);
    expect(orgDocumentSettingsSchema.safeParse({ showTermsAndConditionsOnInvoice: "yes" }).success).toBe(false);
  });

  it("rejects paymentDetails over its length cap, accepts right at it", () => {
    expect(orgDocumentSettingsSchema.safeParse({ paymentDetails: "a".repeat(2001) }).success).toBe(false);
    expect(orgDocumentSettingsSchema.safeParse({ paymentDetails: "a".repeat(2000) }).success).toBe(true);
  });

  it("rejects quoteValidityDays outside 1-365", () => {
    expect(orgDocumentSettingsSchema.safeParse({ quoteValidityDays: 0 }).success).toBe(false);
    expect(orgDocumentSettingsSchema.safeParse({ quoteValidityDays: 366 }).success).toBe(false);
    expect(orgDocumentSettingsSchema.safeParse({ quoteValidityDays: 1 }).success).toBe(true);
    expect(orgDocumentSettingsSchema.safeParse({ quoteValidityDays: 365 }).success).toBe(true);
  });

  it("rejects non-integer quoteValidityDays", () => {
    expect(orgDocumentSettingsSchema.safeParse({ quoteValidityDays: 30.5 }).success).toBe(false);
  });

  it("rejects footer/T&Cs text over the length caps", () => {
    expect(orgDocumentSettingsSchema.safeParse({ footerText: "a".repeat(201) }).success).toBe(false);
    expect(orgDocumentSettingsSchema.safeParse({ footerSecondLine: "a".repeat(201) }).success).toBe(false);
    expect(orgDocumentSettingsSchema.safeParse({ termsAndConditions: "a".repeat(4001) }).success).toBe(false);
  });

  it("accepts text right at the length caps", () => {
    expect(orgDocumentSettingsSchema.safeParse({ footerText: "a".repeat(200) }).success).toBe(true);
    expect(orgDocumentSettingsSchema.safeParse({ termsAndConditions: "a".repeat(4000) }).success).toBe(true);
  });
});

describe("orgOperatingDetailsSchema — the wizard's 'where you operate' screen (C2, #1099)", () => {
  it("accepts a minimal payload with just an enabled country", () => {
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU" }).success).toBe(true);
  });

  it("rejects a missing country", () => {
    expect(orgOperatingDetailsSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown or M7-disabled country code", () => {
    expect(orgOperatingDetailsSchema.safeParse({ country: "XX" }).success).toBe(false);
    expect(orgOperatingDetailsSchema.safeParse({ country: "NL" }).success).toBe(false);
    expect(orgOperatingDetailsSchema.safeParse({ country: "DE" }).success).toBe(false);
  });

  it("accepts every enabled launch market", () => {
    for (const code of ["AU", "NZ", "GB", "US", "IE"]) {
      expect(orgOperatingDetailsSchema.safeParse({ country: code }).success).toBe(true);
    }
  });

  it("accepts an unset taxRate — the US has no default (#1088)", () => {
    const result = orgOperatingDetailsSchema.safeParse({ country: "US" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.taxRate).toBeUndefined();
  });

  it("rejects a taxRate outside 0-100", () => {
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", taxRate: -1 }).success).toBe(false);
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", taxRate: 101 }).success).toBe(false);
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", taxRate: 0 }).success).toBe(true);
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", taxRate: 100 }).success).toBe(true);
  });

  it("accepts a full payload", () => {
    const result = orgOperatingDetailsSchema.safeParse({
      country: "AU",
      currency: "AUD",
      timezone: "Australia/Sydney",
      taxLabel: "GST",
      taxRate: 10,
      businessNumber: "61 224 983 011",
      phone: "(02) 9130 4488",
      email: "hire@northlight.com.au",
      address: "14 Bourke Road, Alexandria NSW 2015",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email but accepts an empty one", () => {
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", email: "not-an-email" }).success).toBe(false);
    expect(orgOperatingDetailsSchema.safeParse({ country: "AU", email: "" }).success).toBe(true);
  });

  it("does not pin the four derived fields to the country's own table row — they're user-editable after auto-fill", () => {
    // AU's real tax label is "GST" — a hand-edited value must still validate.
    expect(
      orgOperatingDetailsSchema.safeParse({ country: "AU", taxLabel: "Consumption Tax" }).success,
    ).toBe(true);
  });
});

describe("crewTimeSettingsSchema (work-layer Phase 4, #1246)", () => {
  it("accepts an empty object (both fields optional)", () => {
    expect(crewTimeSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid values", () => {
    expect(crewTimeSettingsSchema.safeParse({ unansweredOfferHours: 24, callReminderEnabled: true }).success).toBe(true);
  });

  it("rejects unansweredOfferHours outside 1-336 (2 weeks), accepts right at the bounds", () => {
    expect(crewTimeSettingsSchema.safeParse({ unansweredOfferHours: 0 }).success).toBe(false);
    expect(crewTimeSettingsSchema.safeParse({ unansweredOfferHours: 337 }).success).toBe(false);
    expect(crewTimeSettingsSchema.safeParse({ unansweredOfferHours: 1 }).success).toBe(true);
    expect(crewTimeSettingsSchema.safeParse({ unansweredOfferHours: 336 }).success).toBe(true);
  });

  it("rejects a non-boolean callReminderEnabled", () => {
    expect(crewTimeSettingsSchema.safeParse({ callReminderEnabled: "yes" }).success).toBe(false);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(crewTimeSettingsSchema.safeParse({ somethingElse: true }).success).toBe(false);
  });
});
