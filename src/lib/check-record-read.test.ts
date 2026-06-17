import { describe, it, expect } from "vitest";
import {
  mapCheckHistoryRow,
  filterAndSortCheckHistory,
  aggregateModelFailureAnalytics,
  type CheckHistoryRow,
  type CheckHistoryProject,
} from "@/lib/check-record-read";

describe("mapCheckHistoryRow", () => {
  const userNames = new Map<string, string | null>([["u1", "Alice"], ["u2", null]]);
  const project: CheckHistoryProject = { id: "p1", name: "Show", projectNumber: "PRJ-1" };
  const projByLine = new Map<string, CheckHistoryProject | null>([
    ["li1", project],
    ["li2", null],
  ]);

  it("uses snapshot label/type, resolves performer + project, converts dates", () => {
    const m = mapCheckHistoryRow(
      {
        id: "cr1",
        organizationId: "org",
        context: "PREP",
        checkItemId: "ci1",
        checkItemLabelSnapshot: "Power on",
        checkItemTypeSnapshot: "PASS_FAIL",
        result: "PASS",
        performedById: "u1",
        performedAt: 1_700_000_000_000,
        assetId: "a1",
        lineItemId: "li1",
        value: "12V",
        notes: "ok",
        photos: ["x.jpg"],
        _creationTime: 1_600_000_000_000,
      } as never,
      userNames,
      projByLine,
    );
    expect(m.id).toBe("cr1");
    expect(m.checkItem).toEqual({ label: "Power on", type: "PASS_FAIL", category: null });
    expect(m.performedBy).toEqual({ name: "Alice" });
    expect(m.performedAt).toBeInstanceOf(Date);
    expect(m.performedAt.getTime()).toBe(1_700_000_000_000);
    expect(m.lineItem).toEqual({ project });
    expect(m.value).toBe("12V");
    expect(m.notes).toBe("ok");
    expect(m.photos).toEqual(["x.jpg"]);
    expect(m.assetId).toBe("a1");
  });

  it("falls back to _creationTime when performedAt absent (never null)", () => {
    const m = mapCheckHistoryRow(
      {
        id: "cr2",
        organizationId: "org",
        context: "AD_HOC",
        checkItemId: "ci1",
        checkItemLabelSnapshot: "L",
        checkItemTypeSnapshot: "PASS_FAIL",
        result: "FAIL",
        performedById: "u1",
        _creationTime: 1_600_000_000_000,
      } as never,
      userNames,
      projByLine,
    );
    expect(m.performedAt.getTime()).toBe(1_600_000_000_000);
  });

  it("null performer name → performedBy null; absent optionals → null/[]", () => {
    const m = mapCheckHistoryRow(
      {
        id: "cr3",
        organizationId: "org",
        context: "RETURN",
        checkItemId: "ci1",
        checkItemLabelSnapshot: "L",
        checkItemTypeSnapshot: "PASS_FAIL",
        result: "PASS",
        performedById: "u2", // maps to null name
        performedAt: 1,
        _creationTime: 0,
      } as never,
      userNames,
      projByLine,
    );
    expect(m.performedBy).toBeNull();
    expect(m.value).toBeNull();
    expect(m.notes).toBeNull();
    expect(m.photos).toEqual([]);
    expect(m.assetId).toBeNull();
    expect(m.lineItem).toBeNull(); // no lineItemId
  });

  it("lineItem present but project unresolved → { project: null }", () => {
    const m = mapCheckHistoryRow(
      {
        id: "cr4",
        organizationId: "org",
        context: "PREP",
        checkItemId: "ci1",
        checkItemLabelSnapshot: "L",
        checkItemTypeSnapshot: "PASS_FAIL",
        result: "PASS",
        performedById: "u1",
        performedAt: 1,
        lineItemId: "li2",
        _creationTime: 0,
      } as never,
      userNames,
      projByLine,
    );
    expect(m.lineItem).toEqual({ project: null });
  });
});

describe("filterAndSortCheckHistory", () => {
  const mk = (id: string, context: string, at: number): CheckHistoryRow => ({
    id,
    result: "PASS",
    context,
    value: null,
    notes: null,
    photos: [],
    performedAt: new Date(at),
    assetId: "a1",
    checkItem: { label: "L", type: null, category: null },
    performedBy: null,
    lineItem: null,
  });

  it("sorts by performedAt desc", () => {
    const out = filterAndSortCheckHistory([
      mk("a", "PREP", 100),
      mk("b", "PREP", 300),
      mk("c", "PREP", 200),
    ]);
    expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("filters by context when provided", () => {
    const out = filterAndSortCheckHistory(
      [mk("a", "PREP", 1), mk("b", "RETURN", 2), mk("c", "AD_HOC", 3)],
      "RETURN",
    );
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("no context filter returns all", () => {
    const out = filterAndSortCheckHistory([mk("a", "PREP", 1), mk("b", "RETURN", 2)]);
    expect(out).toHaveLength(2);
  });
});

describe("aggregateModelFailureAnalytics", () => {
  const labels = new Map([
    ["ci1", { label: "Power", type: "PASS_FAIL" as string | null }],
    ["ci2", { label: "Cable", type: "PASS_FAIL" as string | null }],
  ]);

  it("counts PASS+FAIL as total, FAIL as fail, scoped to assetIds, in sortOrder", () => {
    const mcis = [
      { checkItemId: "ci2", sortOrder: 1 },
      { checkItemId: "ci1", sortOrder: 0 },
    ];
    const records = [
      { checkItemId: "ci1", assetId: "a1", result: "PASS" },
      { checkItemId: "ci1", assetId: "a1", result: "FAIL" },
      { checkItemId: "ci1", assetId: "a2", result: "FAIL" }, // a2 not in scope
      { checkItemId: "ci1", assetId: "a1", result: "NOTES_ONLY" }, // not PASS/FAIL
      { checkItemId: "ci2", assetId: "a1", result: "PASS" },
    ];
    const out = aggregateModelFailureAnalytics(
      mcis,
      records,
      new Set(["a1"]),
      labels,
    );
    // sortOrder asc → ci1 first
    expect(out.map((r) => r.checkItemId)).toEqual(["ci1", "ci2"]);
    const ci1 = out[0];
    expect(ci1.totalChecks).toBe(2); // PASS + FAIL on a1 (NOTES_ONLY excluded, a2 excluded)
    expect(ci1.failCount).toBe(1);
    expect(ci1.failRate).toBe(0.5);
    expect(ci1.label).toBe("Power");
    const ci2 = out[1];
    expect(ci2.totalChecks).toBe(1);
    expect(ci2.failCount).toBe(0);
    expect(ci2.failRate).toBe(0);
  });

  it("failRate 0 when no records", () => {
    const out = aggregateModelFailureAnalytics(
      [{ checkItemId: "ci1", sortOrder: 0 }],
      [],
      new Set(["a1"]),
      labels,
    );
    expect(out[0].totalChecks).toBe(0);
    expect(out[0].failRate).toBe(0);
  });

  it("missing checkItem label → empty string + null type", () => {
    const out = aggregateModelFailureAnalytics(
      [{ checkItemId: "unknown", sortOrder: 0 }],
      [{ checkItemId: "unknown", assetId: "a1", result: "FAIL" }],
      new Set(["a1"]),
      labels,
    );
    expect(out[0].label).toBe("");
    expect(out[0].type).toBeNull();
    expect(out[0].failCount).toBe(1);
  });

  it("null assetId on a record is ignored", () => {
    const out = aggregateModelFailureAnalytics(
      [{ checkItemId: "ci1", sortOrder: 0 }],
      [{ checkItemId: "ci1", assetId: null, result: "FAIL" }],
      new Set(["a1"]),
      labels,
    );
    expect(out[0].totalChecks).toBe(0);
  });
});
