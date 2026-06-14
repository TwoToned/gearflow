import { describe, it, expect } from "vitest";
import { toRevisionMs, isStaleRevision } from "./collaboration-conflict";

describe("toRevisionMs", () => {
  it("returns epoch ms unchanged for finite numbers", () => {
    expect(toRevisionMs(1717000000000)).toBe(1717000000000);
    expect(toRevisionMs(0)).toBe(0);
  });

  it("converts a Date to epoch ms", () => {
    const d = new Date("2026-06-14T10:00:00.000Z");
    expect(toRevisionMs(d)).toBe(d.getTime());
  });

  it("parses ISO strings", () => {
    expect(toRevisionMs("2026-06-14T10:00:00.000Z")).toBe(
      Date.parse("2026-06-14T10:00:00.000Z"),
    );
  });

  it("returns null for missing or unparseable input", () => {
    expect(toRevisionMs(null)).toBeNull();
    expect(toRevisionMs(undefined)).toBeNull();
    expect(toRevisionMs("not a date")).toBeNull();
    expect(toRevisionMs(new Date("nope"))).toBeNull();
    expect(toRevisionMs(NaN)).toBeNull();
    expect(toRevisionMs(Infinity)).toBeNull();
  });
});

describe("isStaleRevision", () => {
  const base = "2026-06-14T10:00:00.000Z";

  it("is stale when the record was updated after the editor's baseline", () => {
    expect(isStaleRevision("2026-06-14T10:00:05.000Z", base)).toBe(true);
  });

  it("is not stale when current equals the baseline", () => {
    expect(isStaleRevision(base, base)).toBe(false);
  });

  it("is not stale when the baseline is newer than current (clock skew / no-op)", () => {
    expect(isStaleRevision("2026-06-14T09:59:00.000Z", base)).toBe(false);
  });

  it("fails open when either revision is unknown", () => {
    expect(isStaleRevision(null, base)).toBe(false);
    expect(isStaleRevision(base, null)).toBe(false);
    expect(isStaleRevision(undefined, undefined)).toBe(false);
  });

  it("handles mixed Date / number / string inputs", () => {
    const baseDate = new Date(base);
    expect(isStaleRevision(baseDate.getTime() + 1000, baseDate)).toBe(true);
    expect(isStaleRevision(baseDate, baseDate.getTime())).toBe(false);
  });
});
