import { describe, expect, it, vi } from "vitest";
import { buildHomePageActions } from "@/lib/row-actions/home-page";

const keys = (ctx: Parameters<typeof buildHomePageActions>[0]) => buildHomePageActions(ctx).items.map((i) => i.key);

describe("buildHomePageActions", () => {
  it("lists Warehouse, Add gear and Customise… when all apply", () => {
    expect(keys({ onWarehouse: vi.fn(), onAddGear: vi.fn(), onCustomise: vi.fn() })).toEqual(["warehouse", "add-gear", "customise"]);
  });

  it("an action the viewer can't take is absent, never disabled (phone: no Customise, D89)", () => {
    expect(keys({ onWarehouse: vi.fn() })).toEqual(["warehouse"]);
    expect(keys({})).toEqual([]);
  });
});
