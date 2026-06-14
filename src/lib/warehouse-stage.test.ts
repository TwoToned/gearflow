import { describe, expect, it } from "vitest"
import {
  belongsInStage,
  stageQuantity,
  stagesForItem,
  type StageLineLike,
  type WarehouseStage,
} from "./warehouse-stage"

/** Build a leaf line with sane defaults; override only what a case cares about. */
function line(overrides: Partial<StageLineLike> = {}): StageLineLike {
  return {
    status: "CONFIRMED",
    prepStatus: "PENDING",
    quantity: 1,
    checkedOutQuantity: 0,
    returnedQuantity: 0,
    ...overrides,
  }
}

/** The single stage a homogeneous serialized line should be in. */
function only(item: StageLineLike): WarehouseStage[] {
  return [...stagesForItem(item).keys()]
}

describe("stagesForItem — serialized split line lifecycle", () => {
  it("needs prep → Pick/Prep only", () => {
    expect(only(line({ status: "CONFIRMED", prepStatus: "PENDING", quantity: 1 }))).toEqual([
      "PICK_PREP",
    ])
  })

  it("packed, not deployed → Prepped only", () => {
    expect(only(line({ status: "CONFIRMED", prepStatus: "PACKED" }))).toEqual(["PREPPED"])
  })

  it("deployed → Deployed only", () => {
    const it_ = line({ status: "CHECKED_OUT", prepStatus: "PACKED", checkedOutQuantity: 1 })
    expect(only(it_)).toEqual(["DEPLOYED"])
  })

  it("returned, still in staging → Returned only (NOT Pick/Prep — the leak fix)", () => {
    const it_ = line({
      status: "RETURNED",
      prepStatus: "PACKED",
      checkedOutQuantity: 0,
      returnedQuantity: 1,
    })
    expect(only(it_)).toEqual(["RETURNED"])
    expect(belongsInStage(it_, "PICK_PREP")).toBe(false)
  })

  it("returned + deprepped (put away) → Depreped only", () => {
    const it_ = line({
      status: "RETURNED",
      prepStatus: "PENDING",
      checkedOutQuantity: 0,
      returnedQuantity: 1,
    })
    expect(only(it_)).toEqual(["DEPREPED"])
    expect(belongsInStage(it_, "PICK_PREP")).toBe(false)
    expect(belongsInStage(it_, "RETURNED")).toBe(false)
  })
})

describe("stagesForItem — flagged returns must not vanish", () => {
  it("returned + FLAGGED_FAULTY → Returned (not Depreped, not gone)", () => {
    const it_ = line({
      status: "RETURNED",
      prepStatus: "FLAGGED_FAULTY",
      returnedQuantity: 1,
    })
    expect(only(it_)).toEqual(["RETURNED"])
  })

  it("returned + FLAGGED_TT_OVERDUE → Returned", () => {
    const it_ = line({
      status: "RETURNED",
      prepStatus: "FLAGGED_TT_OVERDUE",
      returnedQuantity: 1,
    })
    expect(belongsInStage(it_, "RETURNED")).toBe(true)
    expect(belongsInStage(it_, "DEPREPED")).toBe(false)
  })
})

describe("stagesForItem — bulk partial returns (multi-membership)", () => {
  it("10 out, 4 back → Deployed(6) + Returned(4) simultaneously", () => {
    const it_ = line({
      status: "CHECKED_OUT",
      prepStatus: "PACKED",
      quantity: 10,
      checkedOutQuantity: 10,
      returnedQuantity: 4,
    })
    expect(stageQuantity(it_, "DEPLOYED")).toBe(6)
    expect(stageQuantity(it_, "RETURNED")).toBe(4)
    expect(belongsInStage(it_, "PICK_PREP")).toBe(false)
  })

  it("all back → Returned with full quantity", () => {
    const it_ = line({
      status: "RETURNED",
      prepStatus: "PACKED",
      quantity: 10,
      checkedOutQuantity: 0,
      returnedQuantity: 10,
    })
    expect(stageQuantity(it_, "RETURNED")).toBe(10)
    expect(belongsInStage(it_, "DEPLOYED")).toBe(false)
  })
})

describe("stagesForItem — exclusions", () => {
  it("cancelled → no stages", () => {
    expect(only(line({ status: "CANCELLED", quantity: 1 }))).toEqual([])
  })

  it("exhausted split original (quantity 0, nothing out/back) → no stages", () => {
    expect(only(line({ status: "CONFIRMED", prepStatus: "PACKED", quantity: 0 }))).toEqual([])
  })
})

describe("stagesForItem — kit parent aggregates children across stages", () => {
  it("kit with one deployed + one returned child → parent in Deployed and Returned", () => {
    const kit: StageLineLike = {
      status: "CHECKED_OUT",
      prepStatus: "PACKED",
      quantity: 1,
      checkedOutQuantity: 0,
      returnedQuantity: 0,
      kitId: "kit1",
      isKitChild: false,
      childLineItems: [
        line({
          status: "CHECKED_OUT",
          prepStatus: "PACKED",
          checkedOutQuantity: 1,
          isKitChild: true,
        }),
        line({
          status: "RETURNED",
          prepStatus: "PACKED",
          returnedQuantity: 1,
          isKitChild: true,
        }),
      ],
    }
    expect(belongsInStage(kit, "DEPLOYED")).toBe(true)
    expect(belongsInStage(kit, "RETURNED")).toBe(true)
    expect(belongsInStage(kit, "PICK_PREP")).toBe(false)
  })

  it("kit aggregates nested grandchildren", () => {
    const kit: StageLineLike = {
      status: "CONFIRMED",
      prepStatus: "PACKED",
      quantity: 1,
      checkedOutQuantity: 0,
      returnedQuantity: 0,
      kitId: "kit1",
      isKitChild: false,
      childLineItems: [
        {
          status: "CONFIRMED",
          prepStatus: "PACKED",
          quantity: 1,
          checkedOutQuantity: 0,
          returnedQuantity: 0,
          kitId: "nested",
          isKitChild: true,
          childLineItems: [
            line({ status: "RETURNED", prepStatus: "PENDING", returnedQuantity: 1, isKitChild: true }),
          ],
        },
      ],
    }
    expect(belongsInStage(kit, "DEPREPED")).toBe(true)
  })
})
