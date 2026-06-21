/**
 * Unit tests for the warehouse lifecycle stage model. The critical behaviours:
 *   - status === RETURNED always reads as Returned / De-prepped, NEVER as
 *     "to prep" (the bug where early-returned gear reappeared in Pick/Prep).
 *   - a returned item still PACKED is "Returned"; once de-prepped (prepStatus
 *     reset off PACKED) it's "De-prepped".
 *   - kit / group parents expand into their children for the counts.
 */

import { describe, it, expect } from "vitest";
import type { LineItem } from "./warehouse-types";
import {
  deriveItemStage,
  summarizeWarehouseStages,
  activeWarehouseStage,
  totalStaged,
} from "./warehouse-stages";

function make(partial: Partial<LineItem>): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    type: "EQUIPMENT",
    status: "CONFIRMED",
    quantity: 1,
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    description: null,
    modelId: null,
    assetId: null,
    bulkAssetId: null,
    kitId: null,
    isKitChild: false,
    parentLineItemId: null,
    model: null,
    asset: null,
    bulkAsset: null,
    kit: null,
    prepStatus: null,
    prepContainer: null,
    isContainerLineItem: false,
    isCustomItem: false,
    subHireId: null,
    supplier: null,
    ...partial,
  };
}

describe("deriveItemStage", () => {
  it("maps a fresh confirmed item to to_prep", () => {
    expect(deriveItemStage(make({ status: "CONFIRMED", prepStatus: "PENDING" }))).toBe("to_prep");
    expect(deriveItemStage(make({ status: "CONFIRMED", prepStatus: "PULLED" }))).toBe("to_prep");
  });

  it("maps a packed-but-not-out item to prepped", () => {
    expect(deriveItemStage(make({ status: "CONFIRMED", prepStatus: "PACKED" }))).toBe("prepped");
  });

  it("maps checked-out / on-site to deployed", () => {
    expect(deriveItemStage(make({ status: "CHECKED_OUT", prepStatus: "PACKED" }))).toBe("deployed");
    expect(deriveItemStage(make({ status: "ON_SITE", prepStatus: "PACKED" }))).toBe("deployed");
  });

  it("maps a returned-but-still-packed item to returned (awaiting de-prep)", () => {
    expect(deriveItemStage(make({ status: "RETURNED", prepStatus: "PACKED" }))).toBe("returned");
  });

  it("maps a de-prepped returned item to deprepped — NEVER back to to_prep", () => {
    // This is the bug fix: a returned item whose prepStatus has been reset must
    // read as de-prepped, not as needing prep again.
    expect(deriveItemStage(make({ status: "RETURNED", prepStatus: "PENDING" }))).toBe("deprepped");
    expect(deriveItemStage(make({ status: "RETURNED", prepStatus: null }))).toBe("deprepped");
    expect(deriveItemStage(make({ status: "RETURNED", prepStatus: "PULLED" }))).toBe("deprepped");
  });

  it("treats an early return (returned before others) as returned, not un-deployed", () => {
    const earlyReturn = make({ status: "RETURNED", prepStatus: "PACKED" });
    expect(deriveItemStage(earlyReturn)).toBe("returned");
    expect(deriveItemStage(earlyReturn)).not.toBe("to_prep");
    expect(deriveItemStage(earlyReturn)).not.toBe("prepped");
  });

  it("returns null for cancelled lines", () => {
    expect(deriveItemStage(make({ status: "CANCELLED" }))).toBeNull();
  });
});

describe("summarizeWarehouseStages", () => {
  it("counts each leaf line at its stage and skips cancelled", () => {
    const counts = summarizeWarehouseStages([
      make({ status: "CONFIRMED", prepStatus: "PENDING" }), // to_prep
      make({ status: "CONFIRMED", prepStatus: "PACKED" }), // prepped
      make({ status: "CHECKED_OUT" }), // deployed
      make({ status: "RETURNED", prepStatus: "PACKED" }), // returned
      make({ status: "RETURNED", prepStatus: "PENDING" }), // deprepped
      make({ status: "CANCELLED" }), // skipped
    ]);
    expect(counts).toEqual({ to_prep: 1, prepped: 1, deployed: 1, returned: 1, deprepped: 1 });
    expect(totalStaged(counts)).toBe(5);
  });

  it("expands kit parents into their children", () => {
    const kit = make({
      kitId: "kit1",
      isKitChild: false,
      childLineItems: [
        make({ kitId: "kit1", isKitChild: true, status: "CHECKED_OUT" }),
        make({ kitId: "kit1", isKitChild: true, status: "CONFIRMED", prepStatus: "PACKED" }),
      ],
    });
    const counts = summarizeWarehouseStages([kit]);
    expect(counts.deployed).toBe(1);
    expect(counts.prepped).toBe(1);
    // the parent wrapper itself is not double-counted
    expect(totalStaged(counts)).toBe(2);
  });

  it("ignores container lines", () => {
    const counts = summarizeWarehouseStages([
      make({ isContainerLineItem: true, status: "CONFIRMED", prepStatus: "PENDING" }),
    ]);
    expect(totalStaged(counts)).toBe(0);
  });
});

describe("activeWarehouseStage", () => {
  it("points at the earliest stage with gear needing a warehouse action", () => {
    expect(activeWarehouseStage({ to_prep: 3, prepped: 1, deployed: 5, returned: 2, deprepped: 0 })).toBe("to_prep");
    expect(activeWarehouseStage({ to_prep: 0, prepped: 2, deployed: 5, returned: 1, deprepped: 0 })).toBe("prepped");
    expect(activeWarehouseStage({ to_prep: 0, prepped: 0, deployed: 5, returned: 3, deprepped: 0 })).toBe("returned");
  });

  it("falls back to deployed when nothing needs warehouse action but gear is out", () => {
    expect(activeWarehouseStage({ to_prep: 0, prepped: 0, deployed: 4, returned: 0, deprepped: 1 })).toBe("deployed");
  });

  it("points at deprepped when the job is fully wrapped", () => {
    expect(activeWarehouseStage({ to_prep: 0, prepped: 0, deployed: 0, returned: 0, deprepped: 6 })).toBe("deprepped");
  });
});
