import { describe, it, expect } from "vitest";
import { clientContactSchema } from "./client-contact";

describe("clientContactSchema", () => {
  it("accepts a contact with only a name", () => {
    const result = clientContactSchema.safeParse({ name: "Jane Doe" });
    expect(result.success).toBe(true);
  });

  it("accepts a contact with only an email", () => {
    const result = clientContactSchema.safeParse({ email: "jane@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts a contact with only a phone", () => {
    const result = clientContactSchema.safeParse({ phone: "+61 400 000 000" });
    expect(result.success).toBe(true);
  });

  // --- usefulness floor ---
  it("rejects a contact with none of name/email/phone", () => {
    const result = clientContactSchema.safeParse({ role: "Ops Manager", notes: "no way to reach them" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Provide at least a name, email, or phone number.");
    }
  });

  it("rejects an entirely empty object", () => {
    const result = clientContactSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects name over 200 characters", () => {
    const result = clientContactSchema.safeParse({ name: "N".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects role over 100 characters", () => {
    const result = clientContactSchema.safeParse({ name: "Jane", role: "R".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects email over 200 characters", () => {
    const longEmail = "a".repeat(192) + "@test.com"; // 201 chars total
    const result = clientContactSchema.safeParse({ email: longEmail });
    expect(result.success).toBe(false);
  });

  it("rejects phone over 50 characters", () => {
    const result = clientContactSchema.safeParse({ phone: "1".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects notes over 500 characters", () => {
    const result = clientContactSchema.safeParse({ name: "Jane", notes: "N".repeat(501) });
    expect(result.success).toBe(false);
  });

  // --- email format ---
  it("rejects an invalid email format", () => {
    const result = clientContactSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty-string email (form reset) as long as another field carries substance", () => {
    const result = clientContactSchema.safeParse({ name: "Jane", email: "" });
    expect(result.success).toBe(true);
  });

  // --- isPrimary passthrough ---
  it("accepts isPrimary true/false", () => {
    expect(clientContactSchema.safeParse({ name: "Jane", isPrimary: true }).success).toBe(true);
    expect(clientContactSchema.safeParse({ name: "Jane", isPrimary: false }).success).toBe(true);
  });

  it("accepts a fully-populated contact", () => {
    const result = clientContactSchema.safeParse({
      name: "Jane Doe",
      role: "Ops Manager",
      email: "jane@acme.com",
      phone: "+61 400 000 000",
      notes: "Prefers email over phone",
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });
});
