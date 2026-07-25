import { describe, expect, it } from "vitest";
import { isInternalStockLine } from "./warehouse-subhire-filter";

describe("isInternalStockLine", () => {
  it("is true for internal stock (no subHireId)", () => {
    expect(isInternalStockLine(null)).toBe(true);
    expect(isInternalStockLine(undefined)).toBe(true);
  });

  it("is false for sub-hire equipment", () => {
    expect(isInternalStockLine("subhire_abc123")).toBe(false);
  });

  it("never regresses to always-true via operator precedence", () => {
    // The original bug was `!x.subHireId != null`, which parses as
    // `(!x.subHireId) != null` — always true, since a boolean is never
    // loosely equal to null. Assert the two diverge for a sub-hire id.
    const subHireId = "subhire_abc123";
    // eslint-disable-next-line no-constant-binary-expression -- intentionally
    // reproducing the exact broken expression for regression coverage.
    const buggyExpression = !subHireId != null;
    expect(buggyExpression).toBe(true);
    expect(isInternalStockLine(subHireId)).toBe(false);
  });
});
