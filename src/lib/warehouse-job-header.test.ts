import { describe, it, expect, vi } from "vitest";
import { warehouseHeaderProps } from "./warehouse-job-header";

const base = () => ({
  name: "Gig", status: "PREPPING", statusLabel: "Prepping", openDocument: vi.fn(), hasContainers: false,
  onViewProject: vi.fn(), feedback: { enabled: true, toggle: vi.fn() },
});

describe("warehouse header props", () => {
  it("is the warehouse variant with packer facts, no chips", () => {
    const p = warehouseHeaderProps({ ...base(), loadsOut: "Tue 06:30", truck: "Van 2", packing: ["Sam"] });
    expect(p.variant).toBe("warehouse");
    expect(p.packerFacts).toEqual({ loadsOut: "Tue 06:30", truck: "Van 2", packing: ["Sam"] });
  });
  it("case labels only when the job has cases", () => {
    const keys = (has: boolean) => warehouseHeaderProps({ ...base(), hasContainers: has }).documents!.items.map((i) => i.key);
    expect(keys(false)).not.toContain("container-label");
    expect(keys(true)).toContain("container-label");
  });
  it("Pull sheet leads Documents ▾ when the page can open the dialog", () => {
    const openPullSheet = vi.fn();
    const items = warehouseHeaderProps({ ...base(), openPullSheet }).documents!.items;
    expect(items[0]).toMatchObject({ key: "pull-sheet", label: "Pull sheet" });
    void items[0].onSelect();
    expect(openPullSheet).toHaveBeenCalled();
    expect(warehouseHeaderProps(base()).documents!.items.map((i) => i.key)).not.toContain("pull-sheet");
  });
  it("admin overrides are danger items that confirm; absent when none", () => {
    const run = vi.fn();
    const p = warehouseHeaderProps({ ...base(), overrides: [{ key: "mark-out", label: "Mark deployed", title: "Mark deployed?", body: "Ignores item state.", run }] });
    const o = p.menu!.items.find((i) => i.key === "mark-out")!;
    expect(o).toMatchObject({ danger: true, confirm: { confirmLabel: "Mark deployed" } });
    expect(warehouseHeaderProps(base()).menu!.items.some((i) => i.danger)).toBe(false);
  });
});
