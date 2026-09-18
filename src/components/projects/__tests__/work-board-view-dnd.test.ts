// Work tab board view drag logic (#1244, design §8.3) — the pure
// reorder/move-across-columns helpers extracted out of handleDragEnd
// (R-3.6), unit-testable without mounting dnd-kit.
import { describe, test, expect } from "vitest";
import { reorderWithinColumn, moveAcrossColumns } from "../work-board-view";

describe("reorderWithinColumn", () => {
  test("moves an item to a dropped-on sibling's position", () => {
    const result = reorderWithinColumn(["a", "b", "c"], "a", "c", "quote");
    expect(result).toEqual(["b", "c", "a"]);
  });

  test("dropping on the column itself (empty-column droppable) moves to the end", () => {
    const result = reorderWithinColumn(["a", "b"], "a", "quote", "quote");
    expect(result).toEqual(["b", "a"]);
  });

  test("returns null for a same-position no-op drop", () => {
    expect(reorderWithinColumn(["a", "b"], "a", "a", "quote")).toBeNull();
  });

  test("returns null when the active or over id can't be found", () => {
    expect(reorderWithinColumn(["a", "b"], "ghost", "b", "quote")).toBeNull();
  });
});

describe("moveAcrossColumns", () => {
  test("removes from source and inserts into destination at the dropped position", () => {
    const result = moveAcrossColumns(["a", "b"], ["c", "d"], "a", "c", "prep");
    expect(result.sourceList).toEqual(["b"]);
    expect(result.destList).toEqual(["a", "c", "d"]);
  });

  test("dropping on the column itself appends to the end of the destination", () => {
    const result = moveAcrossColumns(["a"], ["b", "c"], "a", "prep", "prep");
    expect(result.sourceList).toEqual([]);
    expect(result.destList).toEqual(["b", "c", "a"]);
  });

  test("dropping on an id no longer in the destination falls back to the front (defensive Math.max(0, -1))", () => {
    const result = moveAcrossColumns(["a"], ["b"], "a", "ghost", "prep");
    expect(result.destList).toEqual(["a", "b"]);
  });
});
