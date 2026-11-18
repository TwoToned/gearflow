import { describe, it, expect, vi } from "vitest";
import { applyShortfall, type ShortfallWrites } from "../sub-hire-shortfall-apply";

const item = { description: "SM58", quantity: 2, unitCost: 10, unitCharge: 20, pricingType: "FLAT" as const, duration: 1, discount: 0 };

function writes(over: Partial<ShortfallWrites> = {}) {
  return {
    create: vi.fn(async () => ({ id: "o-new" })),
    addItem: vi.fn(async () => ({ id: "it1" })),
    removeItem: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...over,
  } satisfies ShortfallWrites;
}

describe("applyShortfall", () => {
  it("creates a draft order when none exists, adds the item, trims the line, and undoes it all", async () => {
    const w = writes();
    const setQuantity = vi.fn(async () => {});
    const r = await applyShortfall({ writes: w, head: { supplierId: "s1", projectId: "p1" }, item, reduce: { from: 5, to: 3, setQuantity } });
    expect(w.create).toHaveBeenCalled();
    expect(w.addItem).toHaveBeenCalledWith("o-new", item);
    expect(setQuantity).toHaveBeenLastCalledWith(3);
    await r.undo();
    expect(setQuantity).toHaveBeenLastCalledWith(5);
    expect(w.removeItem).toHaveBeenCalledWith("it1");
    expect(w.remove).toHaveBeenCalledWith("o-new");
  });

  it("appends to an existing draft and never deletes that order on undo", async () => {
    const w = writes();
    const r = await applyShortfall({ writes: w, head: { supplierId: "s1" }, draftOrderId: "o-draft", item });
    expect(w.create).not.toHaveBeenCalled();
    expect(w.addItem).toHaveBeenCalledWith("o-draft", item);
    await r.undo();
    expect(w.removeItem).toHaveBeenCalledWith("it1");
    expect(w.remove).not.toHaveBeenCalled();
  });

  it("rolls the item and a fresh order back when the line trim fails", async () => {
    const w = writes();
    const setQuantity = vi.fn(async () => {
      throw new Error("locked");
    });
    await expect(applyShortfall({ writes: w, head: { supplierId: "s1" }, item, reduce: { from: 5, to: 3, setQuantity } })).rejects.toThrow("locked");
    expect(w.removeItem).toHaveBeenCalledWith("it1");
    expect(w.remove).toHaveBeenCalledWith("o-new");
  });

  it("drops a fresh order when adding the item fails", async () => {
    const w = writes({ addItem: vi.fn(async () => { throw new Error("nope"); }) });
    await expect(applyShortfall({ writes: w, head: { supplierId: "s1" }, item })).rejects.toThrow("nope");
    expect(w.remove).toHaveBeenCalledWith("o-new");
  });
});
