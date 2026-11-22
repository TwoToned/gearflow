import { describe, it, expect, vi } from "vitest";
import { buildPackingCaseActions, type PackingCaseRow } from "./packing-case";

const row = (over: Partial<PackingCaseRow> = {}): PackingCaseRow => ({
  id: "c1",
  label: "LX-02",
  parent: null,
  plannedOnlyCount: 0,
  sealed: false,
  hiddenLineCount: 0,
  expanded: false,
  packedCount: 0,
  ...over,
});
const handlers = () => ({
  onRename: vi.fn(),
  onMoveInto: vi.fn(),
  onTakeOut: vi.fn(),
  onUnpack: vi.fn(),
  onPrintLabel: vi.fn(),
  onSeal: vi.fn(),
  onUnseal: vi.fn(),
  onToggleExpanded: vi.fn(),
  onDelete: vi.fn(),
});
const labels = (spec: { items: { label: string }[] }) => spec.items.map((i) => i.label);

describe("buildPackingCaseActions", () => {
  it("offers Rename, Move into, Unpack, Print, Seal and Delete (red, last) for an open top-level case", () => {
    const h = handlers();
    const spec = buildPackingCaseActions(row({ plannedOnlyCount: 2 }), { moveTargets: [{ id: "c2", label: "VID-04" }], ...h });
    expect(labels(spec)).toEqual([
      "Rename…",
      "Move into",
      "Unpack · lines go unplanned",
      "Print case label",
      "Seal · lock the plan, print label",
      "Delete case…",
    ]);
    spec.items[1].children?.[0].onSelect();
    expect(h.onMoveInto).toHaveBeenCalledWith("c2");
    const del = spec.items.at(-1)!;
    expect(del.danger).toBe(true);
    expect(del.group).toBe("danger");
    expect(del.confirm?.body).toMatch(/2 lines planned into LX-02 go back to Unplanned/);
  });

  it("offers Take out of the parent for a nested case", () => {
    const h = handlers();
    const spec = buildPackingCaseActions(row({ label: "BATT-01", parent: { id: "c2", label: "LX-02" } }), { moveTargets: [], ...h });
    expect(labels(spec)).toContain("Take out of LX-02");
    spec.items.find((i) => i.key === "take-out")!.onSelect();
    expect(h.onTakeOut).toHaveBeenCalled();
  });

  it("a SEALED case offers only Print, Unseal and Show every line: Rename, Move, Unpack, Delete are absent", () => {
    const h = handlers();
    const spec = buildPackingCaseActions(
      row({ sealed: true, plannedOnlyCount: 3, parent: { id: "c2", label: "LX-02" }, hiddenLineCount: 4 }),
      { moveTargets: [{ id: "c3", label: "VID-04" }], ...h },
    );
    expect(labels(spec)).toEqual(["Print case label", "Unseal", "Show every line"]);
    spec.items.find((i) => i.key === "unseal")!.onSelect();
    expect(h.onUnseal).toHaveBeenCalled();
  });

  it("Show every line / Show fewer lines only when the card has more than it shows", () => {
    const h = handlers();
    expect(labels(buildPackingCaseActions(row(), { moveTargets: [], ...h }))).not.toContain("Show every line");
    expect(labels(buildPackingCaseActions(row({ hiddenLineCount: 2 }), { moveTargets: [], ...h }))).toContain("Show every line");
    expect(labels(buildPackingCaseActions(row({ hiddenLineCount: 2, expanded: true }), { moveTargets: [], ...h }))).toContain("Show fewer lines");
  });

  it("the delete confirm says why a case with packed lines will be refused", () => {
    const spec = buildPackingCaseActions(row({ packedCount: 2 }), { moveTargets: [], onDelete: vi.fn() });
    expect(spec.items[0].confirm?.body).toMatch(/2 packed lines/);
  });

  it("offers no 'Take out of X' when X is sealed (the server refuses it), but does for an open parent", () => {
    const h = handlers();
    expect(labels(buildPackingCaseActions(row({ parent: { id: "p", label: "LX-01", sealed: true } }), { moveTargets: [], onTakeOut: h.onTakeOut }))).toEqual([]);
    expect(labels(buildPackingCaseActions(row({ parent: { id: "p", label: "LX-01" } }), { moveTargets: [], onTakeOut: h.onTakeOut }))).toEqual(["Take out of LX-01"]);
  });

  it("the delete confirm says a case holding another case will be refused, before the packed-lines sentence", () => {
    const spec = buildPackingCaseActions(row({ hasNestedCase: true, packedCount: 2 }), { moveTargets: [], onDelete: vi.fn() });
    expect(spec.items[0].confirm?.body).toMatch(/another case packed inside it.*refused/);
  });

  it("leaves out what does not apply instead of disabling it", () => {
    expect(buildPackingCaseActions(row(), { moveTargets: [] }).items).toEqual([]);
    const withUnpack = buildPackingCaseActions(row({ plannedOnlyCount: 1 }), { moveTargets: [], onUnpack: vi.fn() });
    expect(withUnpack.items[0].danger).toBeUndefined(); // Unpack is undoable, never a danger item
  });
});
