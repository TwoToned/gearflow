import { describe, expect, it } from "vitest";
import { parsePaletteDate, splitDateQuery } from "@/lib/palette/date-query";

const NOW = new Date(2026, 10, 22, 15, 0).getTime(); // 22 Nov 2026, local

describe("parsePaletteDate (§6d.3: a date lists that day's jobs)", () => {
  it.each([
    ["14/11", "2026-11-14"],
    ["14 nov", "2026-11-14"],
    ["14 November", "2026-11-14"],
    ["nov 14", "2026-11-14"],
    ["14/11/26", "2026-11-14"],
    ["14-11-2026", "2026-11-14"],
    ["14.11.26", "2026-11-14"],
    ["2026-11-14", "2026-11-14"],
    ["1 sept", "2026-09-01"],
  ])("%s → %s", (input, iso) => {
    expect(parsePaletteDate(input, NOW)?.iso).toBe(iso);
  });

  it.each(["31/02", "14", "aura 01", "2341", "#2341", "14 novx", "ma 3", ""])("%s is not a date", (input) => {
    expect(parsePaletteDate(input, NOW)).toBeNull();
  });

  it.each(["2.4", "1.5", "2-4", "12.11", "1.5 m XLR", "1/4 inch jack", "3/8 bolt", "2.4 GHz"])(
    "%s is an everyday gear search, not a date (decimals, fractions, yearless d/m with words)",
    (input) => {
      expect(splitDateQuery(input, NOW)).toBeNull();
    },
  );

  it("the day is a local midnight-to-midnight window, labelled for humans", () => {
    const d = parsePaletteDate("14/11", NOW)!;
    expect(d.dayStart).toBe(new Date(2026, 10, 14).getTime());
    expect(d.dayEnd).toBe(new Date(2026, 10, 15).getTime() - 1);
    expect(d.label).toMatch(/14 Nov/);
  });

  it("the year comes from the caller's stable now, never a fresh clock read", () => {
    expect(parsePaletteDate("14/11", new Date(2027, 0, 1).getTime())?.iso).toBe("2027-11-14");
  });
});

describe("splitDateQuery", () => {
  it("a date WITH a year may be followed by search words; a yearless one must be the whole input", () => {
    expect(splitDateQuery("14 nov 2026 drum shield", NOW)).toMatchObject({ date: { iso: "2026-11-14" }, rest: "drum shield" });
    expect(splitDateQuery("26/01/2026 aura", NOW)).toMatchObject({ date: { iso: "2026-01-26" }, rest: "aura" });
    expect(splitDateQuery("14/11", NOW)).toMatchObject({ rest: "" });
    expect(splitDateQuery("14 nov", NOW)).toMatchObject({ date: { iso: "2026-11-14" }, rest: "" });
    expect(splitDateQuery("14 nov drum shield", NOW)).toBeNull();
    expect(splitDateQuery("14/11 aura", NOW)).toBeNull();
  });

  it("no date at the start is no date", () => {
    expect(splitDateQuery("hilton 14 nov", NOW)).toBeNull();
  });
});
