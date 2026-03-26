import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, formatLabel, roundCurrency } from "./formatters";

describe("formatCurrency", () => {
  it("formats positive whole number", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats decimal value", () => {
    expect(formatCurrency(99.5)).toBe("$99.50");
  });

  it("formats negative value", () => {
    // en-AU locale places minus after currency symbol: $-250.00
    expect(formatCurrency(-250)).toBe("$-250.00");
  });

  it("returns em dash for null", () => {
    expect(formatCurrency(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatCurrency(undefined)).toBe("\u2014");
  });

  it("formats large number with comma separators", () => {
    expect(formatCurrency(1234567.89)).toBe("$1,234,567.89");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(99.999)).toBe("$100.00");
  });

  it("pads single decimal place", () => {
    expect(formatCurrency(50.1)).toBe("$50.10");
  });
});

describe("formatDate", () => {
  it("formats Date object", () => {
    const d = new Date("2024-07-15T00:00:00Z");
    const result = formatDate(d);
    // Accept locale-specific format — just verify it contains the parts
    expect(result).toMatch(/15/);
    expect(result).toMatch(/Jul/);
    expect(result).toMatch(/2024/);
  });

  it("formats date string", () => {
    const result = formatDate("2024-12-25");
    expect(result).toMatch(/25/);
    expect(result).toMatch(/Dec/);
    expect(result).toMatch(/2024/);
  });

  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("\u2014");
  });

  it("returns em dash for undefined", () => {
    expect(formatDate(undefined)).toBe("\u2014");
  });

  it("returns em dash for empty string", () => {
    expect(formatDate("")).toBe("\u2014");
  });
});

describe("formatLabel", () => {
  it("converts SCREAMING_SNAKE_CASE to Title Case", () => {
    expect(formatLabel("CHECKED_OUT")).toBe("Checked Out");
  });

  it("converts single word", () => {
    expect(formatLabel("ENQUIRY")).toBe("Enquiry");
  });

  it("handles multiple underscores", () => {
    expect(formatLabel("DRY_HIRE_EXTENDED")).toBe("Dry Hire Extended");
  });

  it("handles already-lowercase input", () => {
    expect(formatLabel("daily")).toBe("Daily");
  });

  it("handles empty string", () => {
    expect(formatLabel("")).toBe("");
  });
});

describe("roundCurrency", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundCurrency(10.255)).toBe(10.26);
  });

  it("preserves exact 2 decimal values", () => {
    expect(roundCurrency(99.99)).toBe(99.99);
  });

  it("rounds down when appropriate", () => {
    expect(roundCurrency(10.254)).toBe(10.25);
  });

  it("handles zero", () => {
    expect(roundCurrency(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(roundCurrency(-5.555)).toBe(-5.55);
  });

  it("handles whole numbers", () => {
    expect(roundCurrency(100)).toBe(100);
  });

  it("handles very small fractions", () => {
    expect(roundCurrency(0.001)).toBe(0);
  });

  it("handles floating point edge case (0.1 + 0.2)", () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });
});
