/**
 * Unit tests for the pure pick-list helpers — accessory filtering and the
 * progress counter. The progress counter must include accessory children
 * (they're individually pickable) and fan out qty>1 rows, mirroring the keys
 * the render toggles.
 */

import { describe, it, expect } from "vitest";
import { getAccessoryChildren, pickListProgress } from "./pick-list-progress";

type Row = Record<string, unknown>;

describe("getAccessoryChildren (pick list)", () => {
  it("returns only ACCESSORY children", () => {
    const item: Row = {
      childLineItems: [
        { id: "a", childKind: "ACCESSORY" },
        { id: "k", childKind: "KIT" },
        { id: "n" },
      ],
    };
    expect(getAccessoryChildren(item).map((c) => c.id)).toEqual(["a"]);
  });

  it("returns [] when there are no children", () => {
    expect(getAccessoryChildren({})).toEqual([]);
  });
});

describe("pickListProgress", () => {
  it("counts a plain asset plus its accessories", () => {
    const groups = [
      {
        items: [
          {
            id: "light",
            quantity: 1,
            childLineItems: [
              { id: "cable", childKind: "ACCESSORY", quantity: 1 },
              { id: "clamps", childKind: "ACCESSORY", quantity: 2 },
            ],
          },
        ],
      },
    ];
    // light(1) + cable(1) + clamps(2) = 4 rows
    const { totalItems, checkedItems } = pickListProgress(groups, new Set());
    expect(totalItems).toBe(4);
    expect(checkedItems).toBe(0);
  });

  it("counts checked accessory rows, including qty>1 per-unit keys", () => {
    const groups = [
      {
        items: [
          {
            id: "light",
            quantity: 1,
            childLineItems: [{ id: "clamps", childKind: "ACCESSORY", quantity: 2 }],
          },
        ],
      },
    ];
    // Check the asset and the first clamp unit (key `clamps-0`).
    const checked = new Set(["light", "clamps-0"]);
    const { totalItems, checkedItems } = pickListProgress(groups, checked);
    expect(totalItems).toBe(3); // light + clamps-0 + clamps-1
    expect(checkedItems).toBe(2);
  });

  it("counts a kit header plus its members, not the parent's accessories path", () => {
    const groups = [
      {
        items: [
          {
            id: "kit1",
            kitId: "k1",
            isKitChild: false,
            quantity: 1,
            childLineItems: [
              { id: "m1", quantity: 1 },
              { id: "m2", quantity: 3 },
            ],
          },
        ],
      },
    ];
    // kit header(1) + m1(1) + m2(3) = 5
    const { totalItems } = pickListProgress(groups, new Set());
    expect(totalItems).toBe(5);
  });

  it("ignores non-accessory children on a plain asset", () => {
    const groups = [
      {
        items: [
          {
            id: "asset",
            quantity: 1,
            childLineItems: [{ id: "stray", childKind: "KIT", quantity: 1 }],
          },
        ],
      },
    ];
    // Only the asset row counts — the stray non-accessory child is not pickable here.
    expect(pickListProgress(groups, new Set()).totalItems).toBe(1);
  });
});
