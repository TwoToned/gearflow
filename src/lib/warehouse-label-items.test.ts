import { describe, it, expect, vi } from "vitest";
import { labelActionItems } from "./warehouse-label-items";

describe("labelActionItems", () => {
  it("offers per-case, per-kit and per-item picks plus the All entries", () => {
    const open = vi.fn();
    const items = labelActionItems({
      containers: [{ id: "c1", label: "Case 1" }],
      kit: [{ id: "k1", title: "Mic kit", tag: "K-1" } as never],
      item: [{ id: "i1", title: "Lamp", tag: null } as never],
      open,
    });
    expect(items.map((i) => i.label)).toEqual(["Case label: Case 1", "Kit labels", "Loose item labels"]);
    items[0].onSelect();
    items[1].children![0].onSelect();
    items[1].children![1].onSelect();
    items[2].children![1].onSelect();
    expect(open.mock.calls).toEqual([["container-label", "c1"], ["kit-label"], ["kit-label", "k1"], ["item-label", "i1"]]);
    expect(items[1].children![1].label).toBe("Mic kit (K-1)");
  });
  it("still offers All while the list loads", () => {
    const items = labelActionItems({ containers: [], kit: null, item: null, open: vi.fn() });
    expect(items[1].children).toHaveLength(1);
  });
});
