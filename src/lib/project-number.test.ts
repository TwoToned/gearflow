import { describe, it, expect } from "vitest";
import {
  renderProjectNumber,
  scopeKeyFor,
  validateProjectNumberFormat,
  hasIncrementToken,
  datePartsInTimezone,
} from "./project-number";

describe("renderProjectNumber", () => {
  const june = { year: 2026, month: 6, day: 1 };
  const july = { year: 2026, month: 7, day: 8 };

  it("renders the user's example: %YY%MM%INC, first of June 2026 = 260601", () => {
    expect(renderProjectNumber("%YY%MM%INC", { parts: june, sequence: 1, padding: 2 })).toBe("260601");
  });

  it("renders the 8th project of July 2026 = 260708", () => {
    expect(renderProjectNumber("%YY%MM%INC", { parts: july, sequence: 8, padding: 2 })).toBe("260708");
  });

  it("substitutes longer tokens before prefixes (%YYYY not 26YY)", () => {
    expect(renderProjectNumber("%YYYY-%MM-%D", { parts: june, sequence: 1, padding: 1 })).toBe("2026-06-1");
  });

  it("honours increment padding", () => {
    expect(renderProjectNumber("P-%INCREMENT", { parts: june, sequence: 7, padding: 4 })).toBe("P-0007");
    expect(renderProjectNumber("P-%SEQ", { parts: june, sequence: 123, padding: 2 })).toBe("P-123");
  });

  it("supports literal text and separators", () => {
    expect(renderProjectNumber("GIG/%YYYY/%SEQ", { parts: july, sequence: 42, padding: 3 })).toBe("GIG/2026/042");
  });

  it("%M and %D render without padding", () => {
    expect(renderProjectNumber("%M-%D-%INC", { parts: july, sequence: 1, padding: 1 })).toBe("7-8-1");
  });
});

describe("scopeKeyFor", () => {
  const parts = { year: 2026, month: 6, day: 5 };
  it("buckets by reset period", () => {
    expect(scopeKeyFor("NONE", parts)).toBe("GLOBAL");
    expect(scopeKeyFor("YEARLY", parts)).toBe("2026");
    expect(scopeKeyFor("MONTHLY", parts)).toBe("2026-06");
    expect(scopeKeyFor("DAILY", parts)).toBe("2026-06-05");
  });

  it("different months get different monthly keys (so the counter resets)", () => {
    expect(scopeKeyFor("MONTHLY", { year: 2026, month: 6, day: 30 })).not.toBe(
      scopeKeyFor("MONTHLY", { year: 2026, month: 7, day: 1 }),
    );
  });
});

describe("validateProjectNumberFormat", () => {
  it("requires an increment token", () => {
    expect(validateProjectNumberFormat("%YY%MM")).toMatch(/increment token/i);
    expect(validateProjectNumberFormat("%YY%MM%INC")).toBeNull();
    expect(validateProjectNumberFormat("")).toMatch(/empty/i);
  });

  it("hasIncrementToken recognises all three aliases", () => {
    expect(hasIncrementToken("%INCREMENT")).toBe(true);
    expect(hasIncrementToken("%INC")).toBe(true);
    expect(hasIncrementToken("%SEQ")).toBe(true);
    expect(hasIncrementToken("%YY")).toBe(false);
  });
});

describe("datePartsInTimezone", () => {
  it("resolves a UTC instant into Sydney-local parts (date rolls over)", () => {
    // 2026-06-30 16:00 UTC is 2026-07-01 02:00 in Sydney (UTC+10).
    const parts = datePartsInTimezone(new Date("2026-06-30T16:00:00Z"), "Australia/Sydney");
    expect(parts).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it("falls back gracefully on an invalid timezone", () => {
    const parts = datePartsInTimezone(new Date("2026-06-15T12:00:00Z"), "Not/AZone");
    expect(parts.year).toBe(2026);
  });
});
