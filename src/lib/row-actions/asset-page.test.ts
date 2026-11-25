import { describe, it, expect, vi } from "vitest";

import { buildAssetPageActions, type AssetPageCtx } from "./asset";

const all = (): Required<AssetPageCtx> => ({
  onScan: vi.fn(), onMove: vi.fn(), onScheduleService: vi.fn(), onReportIssue: vi.fn(),
  onPrintLabel: vi.fn(), onNewLike: vi.fn(), onForceReturn: vi.fn(), onRetire: vi.fn(), onReinstate: vi.fn(),
});
const keys = (status: string, ctx: AssetPageCtx) => buildAssetPageActions({ status }, ctx).items.map((i) => i.key);

describe("buildAssetPageActions", () => {
  it("an available unit: Scan first, Retire last and red, no Force return, no Reinstate", () => {
    const spec = buildAssetPageActions({ status: "AVAILABLE" }, all());
    expect(spec.items.map((i) => i.key)).toEqual(["scan", "move", "schedule", "new-like", "report", "print", "retire"]);
    expect(spec.items[0]).toMatchObject({ label: "Scan a tag…", kbd: "/" });
    expect(spec.items.at(-1)).toMatchObject({ key: "retire", label: "Retire…", group: "danger", danger: true });
    // Retire opens its own dialog (which names the effects and holds Delete): no second confirm
    expect(spec.items.at(-1)?.confirm).toBeUndefined();
  });

  it("Force return exists only for a deployed unit", () => {
    expect(keys("CHECKED_OUT", all())).toContain("force");
    for (const s of ["AVAILABLE", "IN_MAINTENANCE", "RESERVED", "LOST"]) expect(keys(s, all())).not.toContain("force");
  });

  it("a retired unit offers Reinstate, not Retire", () => {
    const k = keys("RETIRED", all());
    expect(k).toContain("reinstate");
    expect(k).not.toContain("retire");
  });

  it("a verb the caller cannot do is ABSENT, never disabled (there is no disabled field)", () => {
    expect(keys("AVAILABLE", { onPrintLabel: vi.fn() })).toEqual(["print"]);
    expect(keys("AVAILABLE", {})).toEqual([]);
    for (const item of buildAssetPageActions({ status: "AVAILABLE" }, all()).items) expect("disabled" in item).toBe(false);
  });

  it("there is no Delete verb in the menu (it lives inside the Retire dialog, D32)", () => {
    expect(keys("AVAILABLE", all())).not.toContain("delete");
    expect(keys("RETIRED", all())).not.toContain("delete");
  });
});
