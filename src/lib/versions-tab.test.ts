// UX Phase 8 (§7b.4) — the Versions tab's words and the Make-live preview rows, plus the row ⋯ builder.
import { describe, test, expect, vi } from "vitest";
import { makeLivePreviewRows, versionDiffLine, versionFactLine, versionTitle, type MakeLivePreview, type VersionRowFacts } from "./versions-tab";
import { buildVersionRowActions } from "./row-actions/version-row";

const facts = (over: Partial<VersionRowFacts> = {}): VersionRowFacts => ({
  versionId: "v1", lineCount: 44, plannedCount: 36, total: 1, quoteStatus: null, diff: null, ...over,
});

describe("version row words", () => {
  test("title: v3 · Live · name", () => {
    expect(versionTitle({ number: 3, isLive: true, label: "Hilton" })).toBe("v3 · Live · Hilton");
    expect(versionTitle({ number: 2, isLive: false })).toBe("v2");
  });
  test("fact line: lines, planned (only when counted) and the derived quote word", () => {
    expect(versionFactLine({ contentState: "ready" }, facts({ quoteStatus: "SENT" }))).toBe("44 lines · 36 planned · quote sent");
    expect(versionFactLine({ contentState: "ready" }, facts({ plannedCount: null, lineCount: 1 }))).toBe("1 line");
    expect(versionFactLine({ contentState: "ready" }, undefined)).toBeNull();
    expect(versionFactLine({ contentState: "missing" }, facts())).toBe("no captured content");
  });
  test("diff line: signed parts, nothing for zero, 'no change' when nothing differs", () => {
    expect(versionDiffLine({ vsNumber: 2, added: 2, removed: 1, changed: 3, totalDelta: 1970 })).toBe("vs v2: +2 lines · −1 line · 3 lines changed · +$1,970");
    expect(versionDiffLine({ vsNumber: 2, added: 0, removed: 0, changed: 0, totalDelta: -50 })).toBe("vs v2: −$50");
    expect(versionDiffLine({ vsNumber: 2, added: 0, removed: 0, changed: 0, totalDelta: 0 })).toBe("vs v2: no change");
    expect(versionDiffLine(null)).toBeNull();
  });
});

describe("makeLivePreviewRows (counts only, calm words)", () => {
  const base: MakeLivePreview = {
    incomingNumber: 3, outgoingNumber: 4, lines: { incoming: 44, outgoing: 42 }, carriedLines: 5, packedUnits: 12, notOnIncoming: 0,
    modelsWithDemandChange: 0, invoiceCount: 0, total: { before: 100, after: 100 }, balance: { before: 0, after: 0 }, truncated: false,
  };
  test("Warehouse / Availability / Invoices rows", () => {
    const rows = makeLivePreviewRows({ ...base, notOnIncoming: 2, modelsWithDemandChange: 1, invoiceCount: 1, total: { before: 21910, after: 23880 }, balance: { before: 0, after: 1970 } });
    expect(rows.map((r) => r.label)).toEqual(["Warehouse", "Availability", "Invoices"]);
    expect(rows[0].text).toBe("The pick list follows v3: 44 lines. 12 packed units carry over. 2 lines with packed gear aren’t on v3.");
    expect(rows[1].text).toBe("Demand changes on 1 model. Re-checked after, never a block.");
    expect(rows[2].text).toBe("1 invoice stays as it is. Quote total $21,910 → $23,880. Balance to raise $0 → $1,970.");
  });
  test("an unchanged job reads as no change", () => {
    const rows = makeLivePreviewRows({ ...base, packedUnits: 0 });
    expect(rows[1].text).toBe("No change in demand.");
    expect(rows[2].text).toBe("Quote total $100. Balance to raise $0.");
  });
});

describe("buildVersionRowActions", () => {
  const h = () => ({ open: vi.fn(), makeLive: vi.fn(), compare: vi.fn(), rename: vi.fn(), saveCopy: vi.fn(), remove: vi.fn() });
  const labels = (s: { items: { label: string }[] }) => s.items.map((i) => i.label);
  test("a draft: every verb, Delete red and last with a confirm", () => {
    const spec = buildVersionRowActions({ number: 2, isLive: false, contentState: "ready" }, { canPublish: true, canRename: true, onScreen: false, compareWith: 3 }, h());
    expect(labels(spec)).toEqual(["Open this version", "Make v2 live…", "Compare with v3…", "Rename…", "Save a copy as new version…", "Delete…"]);
    expect(spec.items.at(-1)).toMatchObject({ danger: true, group: "danger", confirm: { confirmLabel: "Delete version" } });
  });
  test("the live row never offers Make live or Delete; the on-screen row never offers Open", () => {
    const spec = buildVersionRowActions({ number: 3, isLive: true, contentState: "ready" }, { canPublish: true, canRename: true, onScreen: true, compareWith: 2 }, h());
    expect(labels(spec)).toEqual(["Compare with v2…", "Rename…", "Save a copy as new version…"]);
  });
  test("without publish: only Open, Compare and Rename; with one version: no Compare", () => {
    const spec = buildVersionRowActions({ number: 2, isLive: false, contentState: "ready" }, { canPublish: false, canRename: true, onScreen: false, compareWith: null }, h());
    expect(labels(spec)).toEqual(["Open this version", "Rename…"]);
  });
  test("Rename is gated on project:update (canRename), independent of publish", () => {
    const spec = buildVersionRowActions({ number: 2, isLive: false, contentState: "ready" }, { canPublish: true, canRename: false, onScreen: false, compareWith: null }, h());
    expect(labels(spec)).not.toContain("Rename…");
    expect(labels(spec)).toContain("Make v2 live…");
  });
  test("a version with no captured content can be viewed and renamed, not made live or copied", () => {
    const spec = buildVersionRowActions({ number: 1, isLive: false, contentState: "missing" }, { canPublish: true, canRename: true, onScreen: false, compareWith: 3 }, h());
    expect(labels(spec)).toEqual(["Open this version", "Compare with v3…", "Rename…", "Delete…"]);
  });
});
