import { describe, it, expect, vi } from "vitest";
import { buildFloorBulkActions, buildFloorJobActions, type FloorJobCtx } from "./floor-job";
import { floorJob } from "@/lib/__tests__/floor-fixtures";

const ctx = (over: Partial<FloorJobCtx> = {}): FloorJobCtx => ({
  canCheckOut: true, canCloseOut: true, open: vi.fn(), openDocument: vi.fn(), setStatus: vi.fn(), closeOut: vi.fn(), ...over,
});
const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const admin = (spec: ReturnType<typeof buildFloorJobActions>) => spec.items.find((i) => i.key === "admin")?.children ?? [];

describe("floor card ⋯ (absent, never disabled)", () => {
  it("opens, documents, and Admin overrides that follow the status", () => {
    const spec = buildFloorJobActions(floorJob({ id: "a", status: "CONFIRMED" }), ctx());
    expect(keys(spec)).toEqual(["open", "overview", "pull-slip", "delivery-docket", "return-sheet", "admin"]);
    expect(admin(spec).map((c) => c.key)).toEqual(["override-CHECKED_OUT"]);
    const out = buildFloorJobActions(floorJob({ id: "b", status: "CHECKED_OUT", stage: "out" }), ctx());
    expect(admin(out).map((c) => c.key)).toEqual(["override-RETURNED", "override-COMPLETED"]);
  });

  it("every override is danger with a confirm that states what the scanner disagrees with", () => {
    const job = floorJob({ id: "a", status: "CHECKED_OUT", counts: { lines: 2, linesToPick: 0, items: 5, packed: 0, out: 3, back: 2, damaged: 0, missing: 0 } });
    for (const c of admin(buildFloorJobActions(job, ctx()))) {
      expect(c.danger).toBe(true);
      expect(c.confirm?.body).toMatch(/^3 items not returned yet/);
    }
  });

  it("Admin is absent without check-out; Close out only for a returned job and the close permission", () => {
    expect(keys(buildFloorJobActions(floorJob({ id: "a" }), ctx({ canCheckOut: false })))).not.toContain("admin");
    expect(keys(buildFloorJobActions(floorJob({ id: "a", status: "RETURNED" }), ctx()))).toContain("close-out");
    expect(keys(buildFloorJobActions(floorJob({ id: "a", status: "RETURNED" }), ctx({ canCloseOut: false })))).not.toContain("close-out");
    expect(keys(buildFloorJobActions(floorJob({ id: "a", status: "CHECKED_OUT" }), ctx()))).not.toContain("close-out");
  });

  it("Open job routes to the warehouse page", () => {
    const c = ctx();
    void buildFloorJobActions(floorJob({ id: "p1" }), c).items[0].onSelect();
    expect(c.open).toHaveBeenCalledWith("/warehouse/p1");
  });
});

describe("floor bulk verbs", () => {
  it("Close out n counts only closeable jobs, caps at 25 and confirms", async () => {
    const closeOut = vi.fn();
    const jobs = [floorJob({ id: "a", status: "RETURNED" }), floorJob({ id: "b", status: "CHECKED_OUT" })];
    const [verb] = buildFloorBulkActions(jobs, { canCloseOut: true, closeOut });
    expect(verb.label(2)).toBe("Close out 1");
    expect(verb.confirm?.body).toMatch(/Only returned jobs close out \(1 of 2\)/);
    await verb.onSelect();
    expect(closeOut).toHaveBeenCalledWith(["a"]);
    const many = Array.from({ length: 30 }, (_, i) => floorJob({ id: `r${i}`, status: "RETURNED" }));
    expect(buildFloorBulkActions(many, { canCloseOut: true, closeOut })[0].label(30)).toBe("Close out 25");
  });

  it("absent when nothing selected is closeable or the user may not close", () => {
    expect(buildFloorBulkActions([floorJob({ id: "a" })], { canCloseOut: true, closeOut: vi.fn() })).toEqual([]);
    expect(buildFloorBulkActions([floorJob({ id: "a", status: "RETURNED" })], { canCloseOut: false, closeOut: vi.fn() })).toEqual([]);
  });

  it("Assign packer… n is present only when the caller can assign, and passes every ticked job", () => {
    const assignPacker = vi.fn();
    const jobs = [floorJob({ id: "a" }), floorJob({ id: "b" })];
    const [verb] = buildFloorBulkActions(jobs, { canCloseOut: false, closeOut: vi.fn(), assignPacker });
    expect(verb.label(2)).toBe("Assign packer… 2");
    void verb.onSelect();
    expect(assignPacker).toHaveBeenCalledWith(["a", "b"]);
    expect(buildFloorBulkActions(jobs, { canCloseOut: false, closeOut: vi.fn() })).toEqual([]);
  });
});
