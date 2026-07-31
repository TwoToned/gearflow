import { describe, it, expect } from "vitest";
import { orgDocumentSettingsSchema } from "./org-settings";

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
