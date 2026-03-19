import { describe, it, expect } from "vitest";
import { supplierSchema } from "./supplier";

describe("supplierSchema", () => {
  const minimal = { name: "Acme AV Supplies" };

  const complete = {
    name: "Acme AV Supplies",
    contactName: "John Smith",
    email: "john@acme.com",
    phone: "+61299998888",
    website: "https://acme.com",
    address: "456 Industrial Ave, Melbourne",
    latitude: -37.8136,
    longitude: 144.9631,
    notes: "Preferred supplier for lighting equipment",
    accountNumber: "ACC-12345",
    paymentTerms: "Net 30",
    defaultLeadTime: "5 business days",
    tags: ["lighting", "preferred"],
    isActive: false,
  };

  // Valid data
  it("accepts valid minimal data", () => {
    const result = supplierSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Acme AV Supplies");
    }
  });

  it("accepts valid complete data", () => {
    const result = supplierSchema.safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("john@acme.com");
      expect(result.data.latitude).toBe(-37.8136);
      expect(result.data.longitude).toBe(144.9631);
      expect(result.data.tags).toEqual(["lighting", "preferred"]);
      expect(result.data.isActive).toBe(false);
    }
  });

  // Defaults
  it("applies default values", () => {
    const result = supplierSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
      expect(result.data.isActive).toBe(true);
    }
  });

  // Required fields
  it("rejects missing name", () => {
    const result = supplierSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = supplierSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  // Max length enforcement
  it("rejects name exceeding 200 characters", () => {
    const result = supplierSchema.safeParse({ name: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("accepts name at exactly 200 characters", () => {
    const result = supplierSchema.safeParse({ name: "x".repeat(200) });
    expect(result.success).toBe(true);
  });

  it("rejects contactName exceeding 200 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, contactName: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects email exceeding 200 characters", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      email: "a".repeat(190) + "@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects phone exceeding 50 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, phone: "1".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects website exceeding 500 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, website: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects address exceeding 500 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, address: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects notes exceeding 2000 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects accountNumber exceeding 100 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, accountNumber: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects paymentTerms exceeding 100 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, paymentTerms: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects defaultLeadTime exceeding 100 characters", () => {
    const result = supplierSchema.safeParse({ ...minimal, defaultLeadTime: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  // Email validation
  it("rejects invalid email format", () => {
    const result = supplierSchema.safeParse({ ...minimal, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts empty string for email", () => {
    const result = supplierSchema.safeParse({ ...minimal, email: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("");
    }
  });

  it("accepts valid email", () => {
    const result = supplierSchema.safeParse({ ...minimal, email: "test@test.com" });
    expect(result.success).toBe(true);
  });

  // Refine: lat/lng must be together
  it("accepts both latitude and longitude present", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: -37.8136,
      longitude: 144.9631,
    });
    expect(result.success).toBe(true);
  });

  it("accepts both latitude and longitude absent", () => {
    const result = supplierSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects latitude without longitude", () => {
    const result = supplierSchema.safeParse({ ...minimal, latitude: -37.8136 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("latitude and longitude must be provided together");
    }
  });

  it("rejects longitude without latitude", () => {
    const result = supplierSchema.safeParse({ ...minimal, longitude: 144.9631 });
    expect(result.success).toBe(false);
  });

  it("accepts null latitude and null longitude (both absent)", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: null,
      longitude: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects null latitude with numeric longitude", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: null,
      longitude: 144.9631,
    });
    expect(result.success).toBe(false);
  });

  it("rejects numeric latitude with null longitude", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: -37.8136,
      longitude: null,
    });
    expect(result.success).toBe(false);
  });

  // Coercion for lat/lng
  it("coerces string to number for latitude", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: "-37.81",
      longitude: "144.96",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(-37.81);
      expect(result.data.longitude).toBe(144.96);
    }
  });

  // Edge cases
  it("accepts zero latitude and zero longitude", () => {
    const result = supplierSchema.safeParse({
      ...minimal,
      latitude: 0,
      longitude: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty tags array", () => {
    const result = supplierSchema.safeParse({ ...minimal, tags: [] });
    expect(result.success).toBe(true);
  });

  it("accepts tags with multiple entries", () => {
    const result = supplierSchema.safeParse({ ...minimal, tags: ["a", "b", "c"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toHaveLength(3);
    }
  });
});
