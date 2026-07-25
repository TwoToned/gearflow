import { describe, expect, it } from "vitest";
import { isInternalStockLine } from "./warehouse-subhire-filter";

describe("isInternalStockLine", () => {
  it("is true for internal stock (no subHireId)", () => {
    expect(isInternalStockLine(null)).toBe(true);
    expect(isInternalStockLine(undefined)).toBe(true);
  });

  it("is false for sub-hire equipment", () => {
    // Regression: the original bug (`!x.subHireId != null`, which parses as
    // `(!x.subHireId) != null` due to operator precedence) was always true
    // regardless of subHireId. This assertion fails if that pattern returns.
    expect(isInternalStockLine("subhire_abc123")).toBe(false);
  });
});
