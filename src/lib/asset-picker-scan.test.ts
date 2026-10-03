import { describe, it, expect } from "vitest";
import { resolvePickerScan, countAssigned, type PickerSlot } from "./asset-picker-scan";

/** Three slots for the same model, sharing one pool of available assets. */
function headsetSlots(selected: [string, string, string] = ["", "", ""]): PickerSlot[] {
  const pool = [
    { id: "a1", assetTag: "HS-001" },
    { id: "a2", assetTag: "HS-002" },
    { id: "a3", assetTag: "HS-003" },
  ];
  return selected.map((selectedAssetId) => ({
    modelName: "IMX6A Headset",
    availableAssets: pool,
    selectedAssetId,
  }));
}

describe("resolvePickerScan — assigning", () => {
  it("fills the first empty slot", () => {
    const r = resolvePickerScan(headsetSlots(), "HS-002");
    expect(r).toEqual({
      kind: "assigned", index: 0, assetId: "a2", assetTag: "HS-002", modelName: "IMX6A Headset",
    });
  });

  it("skips slots that are already filled", () => {
    const r = resolvePickerScan(headsetSlots(["a1", "", ""]), "HS-003");
    expect(r.kind).toBe("assigned");
    expect(r.kind === "assigned" && r.index).toBe(1);
  });

  it("matches case-insensitively", () => {
    // Printed labels and HID wedges disagree about case often enough that a
    // case-sensitive miss would read as a broken scanner.
    const r = resolvePickerScan(headsetSlots(), "hs-002");
    expect(r.kind).toBe("assigned");
    expect(r.kind === "assigned" && r.assetId).toBe("a2");
    // Reports the tag as PRINTED, not as scanned.
    expect(r.kind === "assigned" && r.assetTag).toBe("HS-002");
  });

  it("tolerates the CR/LF an HID wedge appends", () => {
    expect(resolvePickerScan(headsetSlots(), "HS-001\r\n").kind).toBe("assigned");
  });

  it("assigns across different models, first eligible empty slot wins", () => {
    const slots: PickerSlot[] = [
      { modelName: "Headset", availableAssets: [{ id: "h1", assetTag: "HS-001" }], selectedAssetId: "" },
      { modelName: "Beltpack", availableAssets: [{ id: "b1", assetTag: "BP-001" }], selectedAssetId: "" },
    ];
    const r = resolvePickerScan(slots, "BP-001");
    expect(r.kind).toBe("assigned");
    expect(r.kind === "assigned" && r.index).toBe(1);
    expect(r.kind === "assigned" && r.modelName).toBe("Beltpack");
  });
});

describe("resolvePickerScan — re-scanning something already logged", () => {
  it("reports WHERE it went rather than silently doing nothing", () => {
    // Head-down through eleven identical headsets, "did that one register?" is
    // the question actually being asked.
    const r = resolvePickerScan(headsetSlots(["a1", "", ""]), "HS-001");
    expect(r).toEqual({
      kind: "already-assigned", index: 0, assetTag: "HS-001", modelName: "IMX6A Headset",
    });
  });

  it("is decided BEFORE looking for an empty slot", () => {
    // HS-001 sits in slot 0 and slots 1-2 are empty and could also take it —
    // without the ordering this would duplicate the same asset into slot 1.
    const r = resolvePickerScan(headsetSlots(["a1", "", ""]), "HS-001");
    expect(r.kind).toBe("already-assigned");
  });
});

describe("resolvePickerScan — rejections", () => {
  it("distinguishes 'you have enough of those' from 'wrong tag'", () => {
    // Every slot that could hold HS-001 is full. The operator needs to hear
    // "enough of those", not "that tag is wrong".
    const r = resolvePickerScan(headsetSlots(["a2", "a3", "a1"]), "HS-001");
    expect(r.kind).toBe("already-assigned"); // a1 IS selected in slot 2
  });

  it("reports no-slot when the model is full but the asset itself is unused", () => {
    const slots: PickerSlot[] = [
      {
        modelName: "IMX6A Headset",
        availableAssets: [
          { id: "a1", assetTag: "HS-001" },
          { id: "a2", assetTag: "HS-002" },
        ],
        selectedAssetId: "a2",
      },
    ];
    const r = resolvePickerScan(slots, "HS-001");
    expect(r).toEqual({ kind: "no-slot", assetTag: "HS-001", modelName: "IMX6A Headset" });
  });

  it("reports unknown for a tag no slot can take", () => {
    expect(resolvePickerScan(headsetSlots(), "XX-999")).toEqual({ kind: "unknown", assetTag: "XX-999" });
  });

  it("reports unknown for a decode outside the tag grammar", () => {
    // Pointing a camera at a warehouse incidentally reads shipping labels.
    const r = resolvePickerScan(headsetSlots(), "https://example.com/promo?utm=1");
    expect(r.kind).toBe("unknown");
  });

  it("reports unknown for empty input rather than throwing", () => {
    expect(resolvePickerScan(headsetSlots(), "   ").kind).toBe("unknown");
  });

  it("handles an empty slot list", () => {
    expect(resolvePickerScan([], "HS-001").kind).toBe("unknown");
  });

  it("never assigns into a slot whose pool lacks the tag", () => {
    const slots: PickerSlot[] = [
      { modelName: "Beltpack", availableAssets: [{ id: "b1", assetTag: "BP-001" }], selectedAssetId: "" },
      { modelName: "Headset", availableAssets: [{ id: "h1", assetTag: "HS-001" }], selectedAssetId: "" },
    ];
    const r = resolvePickerScan(slots, "HS-001");
    expect(r.kind === "assigned" && r.index).toBe(1);
  });
});

describe("back-to-back scans — the continuous-mode contract", () => {
  /** Apply an `assigned` result, the way the dialog's write helper does. */
  function apply(slots: PickerSlot[], r: ReturnType<typeof resolvePickerScan>): PickerSlot[] {
    if (r.kind !== "assigned") return slots;
    return slots.map((s, i) => (i === r.index ? { ...s, selectedAssetId: r.assetId } : s));
  }

  it("fills DIFFERENT slots when each scan sees the previous one's result", () => {
    // This is the contract the dialog's synchronous ref mirror upholds.
    // Continuous scanning delivers hits from a decode callback, so the handler
    // React invokes is the one captured at the last COMMITTED render. If two
    // units land before that commit, both would resolve against the same rows
    // and pick the same empty slot — the second silently overwriting the first
    // and losing a unit, in exactly the eleven-in-a-row flow this exists for.
    let slots = headsetSlots();

    const first = resolvePickerScan(slots, "HS-001");
    slots = apply(slots, first);
    const second = resolvePickerScan(slots, "HS-002");
    slots = apply(slots, second);
    const third = resolvePickerScan(slots, "HS-003");
    slots = apply(slots, third);

    expect([first, second, third].map((r) => (r.kind === "assigned" ? r.index : -1))).toEqual([0, 1, 2]);
    expect(slots.map((s) => s.selectedAssetId)).toEqual(["a1", "a2", "a3"]);
  });

  it("would COLLIDE if a scan resolved against stale rows — the bug being guarded", () => {
    // Same two scans, but the second resolves against the pre-assignment rows,
    // which is what a stale closure hands it. Both pick slot 0. Asserting the
    // collision keeps the reason for the ref from being refactored away as
    // redundant.
    const stale = headsetSlots();
    const first = resolvePickerScan(stale, "HS-001");
    const secondAgainstStale = resolvePickerScan(stale, "HS-002");

    expect(first.kind === "assigned" && first.index).toBe(0);
    expect(secondAgainstStale.kind === "assigned" && secondAgainstStale.index).toBe(0);
  });

  it("reports the second scan as already-assigned once the first is applied", () => {
    let slots = headsetSlots();
    slots = apply(slots, resolvePickerScan(slots, "HS-001"));
    expect(resolvePickerScan(slots, "HS-001").kind).toBe("already-assigned");
  });
});

describe("countAssigned", () => {
  it("counts filled slots", () => {
    expect(countAssigned(headsetSlots())).toBe(0);
    expect(countAssigned(headsetSlots(["a1", "", ""]))).toBe(1);
    expect(countAssigned(headsetSlots(["a1", "a2", "a3"]))).toBe(3);
  });
});
