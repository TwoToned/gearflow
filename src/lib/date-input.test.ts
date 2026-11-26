import { describe, expect, it } from "vitest";
import { fromDateInput, toDateInput } from "@/lib/date-input";

describe("date input round trip (UTC midnight, the same day on every device)", () => {
  it("epoch ms reads as yyyy-mm-dd and parses back to UTC midnight", () => {
    expect(toDateInput(Date.UTC(2026, 2, 5, 13))).toBe("2026-03-05");
    expect(fromDateInput("2026-03-05")).toBe(Date.UTC(2026, 2, 5));
    expect(fromDateInput(toDateInput(Date.UTC(2026, 11, 31, 23)))).toBe(Date.UTC(2026, 11, 31));
  });

  it("an absent date shows as an empty box", () => {
    expect(toDateInput(null)).toBe("");
    expect(toDateInput(undefined)).toBe("");
  });
});
