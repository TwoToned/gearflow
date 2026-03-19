import { describe, it, expect } from "vitest";
import { clientSchema } from "./client";

describe("clientSchema", () => {
  const validMinimal = { name: "Acme Corp" };

  const validComplete = {
    name: "Big Stage Productions",
    type: "PRODUCTION_COMPANY" as const,
    contactName: "Jane Doe",
    contactEmail: "jane@bigstage.com",
    contactPhone: "+1-555-0123",
    billingAddress: "100 Broadway, New York, NY 10001",
    billingLatitude: 40.7128,
    billingLongitude: -74.006,
    shippingAddress: "200 Sunset Blvd, Los Angeles, CA 90028",
    shippingLatitude: 34.0983,
    shippingLongitude: -118.3267,
    taxId: "12-3456789",
    paymentTerms: "Net 30",
    defaultDiscount: 10,
    notes: "VIP client — priority turnaround",
    tags: ["vip", "recurring"],
    isActive: true,
  };

  // --- valid data ---
  it("accepts valid minimal data and applies defaults", () => {
    const result = clientSchema.parse(validMinimal);
    expect(result.name).toBe("Acme Corp");
    expect(result.type).toBe("COMPANY");
    expect(result.tags).toEqual([]);
    expect(result.isActive).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = clientSchema.parse(validComplete);
    expect(result.type).toBe("PRODUCTION_COMPANY");
    expect(result.contactEmail).toBe("jane@bigstage.com");
    expect(result.billingLatitude).toBeCloseTo(40.7128);
    expect(result.defaultDiscount).toBe(10);
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const result = clientSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = clientSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 200 characters", () => {
    const result = clientSchema.safeParse({ name: "N".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts name exactly 200 characters", () => {
    const result = clientSchema.safeParse({ name: "N".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("rejects contactName over 200 characters", () => {
    const result = clientSchema.safeParse({ name: "C", contactName: "N".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects contactEmail over 200 characters", () => {
    const longEmail = "a".repeat(192) + "@test.com"; // 201 chars total
    const result = clientSchema.safeParse({ name: "C", contactEmail: longEmail });
    expect(result.success).toBe(false);
  });

  it("rejects contactPhone over 50 characters", () => {
    const result = clientSchema.safeParse({ name: "C", contactPhone: "1".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects billingAddress over 500 characters", () => {
    const result = clientSchema.safeParse({ name: "C", billingAddress: "A".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects shippingAddress over 500 characters", () => {
    const result = clientSchema.safeParse({ name: "C", shippingAddress: "A".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects taxId over 50 characters", () => {
    const result = clientSchema.safeParse({ name: "C", taxId: "T".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects paymentTerms over 100 characters", () => {
    const result = clientSchema.safeParse({ name: "C", paymentTerms: "P".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 2000 characters", () => {
    const result = clientSchema.safeParse({ name: "C", notes: "N".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid type", () => {
    const result = clientSchema.safeParse({ name: "C", type: "NONPROFIT" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid type values", () => {
    const types = ["COMPANY", "INDIVIDUAL", "VENUE", "PRODUCTION_COMPANY"];
    for (const type of types) {
      const result = clientSchema.safeParse({ name: "C", type });
      expect(result.success).toBe(true);
    }
  });

  // --- email validation ---
  it("rejects invalid email format", () => {
    const result = clientSchema.safeParse({ name: "C", contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts valid email", () => {
    const result = clientSchema.safeParse({ name: "C", contactEmail: "user@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts empty string as contactEmail (form reset)", () => {
    const result = clientSchema.safeParse({ name: "C", contactEmail: "" });
    expect(result.success).toBe(true);
  });

  // --- defaults ---
  it("defaults type to COMPANY", () => {
    const result = clientSchema.parse(validMinimal);
    expect(result.type).toBe("COMPANY");
  });

  it("defaults tags to empty array", () => {
    const result = clientSchema.parse(validMinimal);
    expect(result.tags).toEqual([]);
  });

  it("defaults isActive to true", () => {
    const result = clientSchema.parse(validMinimal);
    expect(result.isActive).toBe(true);
  });

  // --- defaultDiscount constraints ---
  it("accepts defaultDiscount of 0", () => {
    const result = clientSchema.parse({ name: "C", defaultDiscount: 0 });
    expect(result.defaultDiscount).toBe(0);
  });

  it("accepts defaultDiscount of 100", () => {
    const result = clientSchema.parse({ name: "C", defaultDiscount: 100 });
    expect(result.defaultDiscount).toBe(100);
  });

  it("rejects defaultDiscount over 100", () => {
    const result = clientSchema.safeParse({ name: "C", defaultDiscount: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects negative defaultDiscount", () => {
    const result = clientSchema.safeParse({ name: "C", defaultDiscount: -1 });
    expect(result.success).toBe(false);
  });

  it("coerces string defaultDiscount to number", () => {
    const result = clientSchema.parse({ name: "C", defaultDiscount: "15" });
    expect(result.defaultDiscount).toBe(15);
  });

  // --- refine: billing lat/lng must both be present or both absent ---
  it("accepts both billing lat/lng provided", () => {
    const result = clientSchema.safeParse({ name: "C", billingLatitude: 40.0, billingLongitude: -74.0 });
    expect(result.success).toBe(true);
  });

  it("accepts both billing lat/lng absent", () => {
    const result = clientSchema.safeParse({ name: "C" });
    expect(result.success).toBe(true);
  });

  it("rejects billingLatitude without billingLongitude", () => {
    const result = clientSchema.safeParse({ name: "C", billingLatitude: 40.0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Both billing latitude and longitude must be provided together");
    }
  });

  it("rejects billingLongitude without billingLatitude", () => {
    const result = clientSchema.safeParse({ name: "C", billingLongitude: -74.0 });
    expect(result.success).toBe(false);
  });

  it("accepts both billing lat/lng as null", () => {
    const result = clientSchema.safeParse({ name: "C", billingLatitude: null, billingLongitude: null });
    expect(result.success).toBe(true);
  });

  // --- refine: shipping lat/lng must both be present or both absent ---
  it("accepts both shipping lat/lng provided", () => {
    const result = clientSchema.safeParse({ name: "C", shippingLatitude: 34.0, shippingLongitude: -118.0 });
    expect(result.success).toBe(true);
  });

  it("accepts both shipping lat/lng absent", () => {
    const result = clientSchema.safeParse({ name: "C" });
    expect(result.success).toBe(true);
  });

  it("rejects shippingLatitude without shippingLongitude", () => {
    const result = clientSchema.safeParse({ name: "C", shippingLatitude: 34.0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Both shipping latitude and longitude must be provided together");
    }
  });

  it("rejects shippingLongitude without shippingLatitude", () => {
    const result = clientSchema.safeParse({ name: "C", shippingLongitude: -118.0 });
    expect(result.success).toBe(false);
  });

  it("accepts both shipping lat/lng as null", () => {
    const result = clientSchema.safeParse({ name: "C", shippingLatitude: null, shippingLongitude: null });
    expect(result.success).toBe(true);
  });

  // --- mixed refine: one pair valid, other invalid ---
  it("rejects when billing pair is valid but shipping pair is incomplete", () => {
    const result = clientSchema.safeParse({
      name: "C",
      billingLatitude: 40.0,
      billingLongitude: -74.0,
      shippingLatitude: 34.0,
      // shippingLongitude missing
    });
    expect(result.success).toBe(false);
  });

  // --- edge cases ---
  it("coerces string billing lat/lng to numbers", () => {
    const result = clientSchema.parse({
      name: "C",
      billingLatitude: "40.7",
      billingLongitude: "-74.0",
    });
    expect(result.billingLatitude).toBe(40.7);
    expect(result.billingLongitude).toBe(-74.0);
  });

  it("accepts omitted optional fields", () => {
    const result = clientSchema.parse(validMinimal);
    expect(result.contactName).toBeUndefined();
    expect(result.contactEmail).toBeUndefined();
    expect(result.taxId).toBeUndefined();
    expect(result.defaultDiscount).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });
});
