import { describe, it, expect, vi } from "vitest";
import { buildPackingCaseActions } from "./packing-case";

const handlers = () => ({ onRename: vi.fn(), onMoveInto: vi.fn(), onTakeOut: vi.fn(), onUnpack: vi.fn() });

describe("buildPackingCaseActions", () => {
  it("offers Rename, Move into ▸ the given cases, and Unpack for a top-level case", () => {
    const h = handlers();
    const spec = buildPackingCaseActions(
      { id: "c1", label: "LX-02", parent: null, plannedOnlyCount: 2 },
      { moveTargets: [{ id: "c2", label: "VID-04" }], ...h },
    );
    expect(spec.items.map((i) => i.label)).toEqual(["Rename…", "Move into", "Unpack · lines go loose"]);
    spec.items[1].children?.[0].onSelect();
    expect(h.onMoveInto).toHaveBeenCalledWith("c2");
  });

  it("offers Take out of the parent for a nested case", () => {
    const h = handlers();
    const spec = buildPackingCaseActions(
      { id: "c1", label: "BATT-01", parent: { id: "c2", label: "LX-02" }, plannedOnlyCount: 0 },
      { moveTargets: [], ...h },
    );
    expect(spec.items.map((i) => i.label)).toEqual(["Rename…", "Take out of LX-02"]);
    spec.items[1].onSelect();
    expect(h.onTakeOut).toHaveBeenCalled();
  });

  it("leaves out what does not apply instead of disabling it", () => {
    const spec = buildPackingCaseActions(
      { id: "c1", label: "LX-02", parent: null, plannedOnlyCount: 0 },
      { moveTargets: [] },
    );
    expect(spec.items).toEqual([]);
    // Unpack is undoable: never a danger item.
    const withUnpack = buildPackingCaseActions(
      { id: "c1", label: "LX-02", parent: null, plannedOnlyCount: 1 },
      { moveTargets: [], onUnpack: vi.fn() },
    );
    expect(withUnpack.items[0].danger).toBeUndefined();
  });
});
