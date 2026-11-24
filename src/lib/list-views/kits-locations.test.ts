import { describe, expect, it } from "vitest";
import { defaultListState } from "@/lib/list-url-state";
import { KITS_SPEC, KIT_COLUMNS, kitFlags, kitRowOf, kitSegments, kitStatus, kitsQueryArgs, type KitSource } from "./kits";
import { LOCATIONS_SPEC, LOCATION_COLUMNS, capacityText, locationRowOf, locationSegments, locationsQueryArgs, type LocationSource } from "./locations";

const kit = (over: Partial<KitSource> = {}): KitSource => ({
  id: "k1",
  assetTag: "K-0042",
  name: "Shure ULXD4Q",
  itemCount: 5,
  state: { key: "AVAILABLE", missing: [], booking: null },
  ...over,
});

describe("kits list view", () => {
  it("the strip is the four words with counts; the default query has no segment", () => {
    expect(kitSegments({ all: 4, missing: 1 }).map((s) => [s.key, s.label, s.count])).toEqual([
      ["all", "All", 4],
      ["complete", "Complete", undefined],
      ["missing", "Missing items", 1],
      ["onjob", "On a job", undefined],
    ]);
    expect(kitsQueryArgs(defaultListState(KITS_SPEC), 5)).toMatchObject({ segment: undefined, now: 5, sortBy: "assetTag" });
  });

  it("cost-bearing Value is opt-in; items, complete, on job and location are default", () => {
    expect(KIT_COLUMNS.filter((c) => c.optional).map((c) => c.id)).toEqual(["value", "condition", "tags"]);
  });

  it("a missing item is a red flag and the status word, derived", () => {
    const k = kit({ state: { key: "INCOMPLETE", missing: [{ label: "PA805", why: "lost" }, { label: "X", why: "short" }], booking: null } });
    expect(kitFlags(k)).toEqual([{ label: "2 items missing", tone: "error" }]);
    expect(kitStatus(k)).toMatchObject({ label: "Incomplete", intent: "error" });
    expect(kitStatus(kit())).toMatchObject({ label: "Available", intent: "success" });
    expect(kitStatus(kit({ state: { key: "CHECKED_OUT", missing: [], booking: null } }))).toMatchObject({ label: "Out", intent: "primary" });
  });

  it("a blank price stays blank; no job prints a dash", () => {
    const row = kitRowOf(kit());
    expect(row.facts.value).toEqual({ kind: "money", amount: null });
    expect(row.facts.onJob).toEqual({ kind: "text", label: "—" });
    expect(row.href).toBe("/kits/k1");
  });
});

const loc = (over: Partial<LocationSource> = {}): LocationSource => ({
  id: "w",
  name: "Warehouse A",
  type: "WAREHOUSE",
  address: null,
  tags: [],
  parentName: null,
  stored: 412,
  binCount: 11,
  capacity: 600,
  fill: 69,
  lastMovement: null,
  labelState: "not-printed",
  ...over,
});

describe("locations list view", () => {
  it("capacity reads `412 / 600 · 69%`, and `not set` without one", () => {
    expect(capacityText(loc())).toBe("412 / 600 · 69%");
    expect(capacityText(loc({ capacity: null, fill: null }))).toBe("not set");
  });

  it("an absent last movement prints a dash, never a guess", () => {
    expect(locationRowOf(loc()).facts.lastMovement).toEqual({ kind: "text", label: "—" });
    expect((locationRowOf(loc({ lastMovement: 1_700_000_000_000 })).facts.lastMovement as { label: string }).label).not.toBe("—");
  });

  it("the strip and URL args: Sites and unknown types", () => {
    expect(locationSegments({ sites: 2 }).map((s) => s.label)).toEqual(["All", "Warehouses", "Vehicles", "Sites", "Empty"]);
    const s = { ...defaultListState(LOCATIONS_SPEC), seg: "sites", filters: { type: ["VENUE", "NOPE"] } };
    expect(locationsQueryArgs(s)).toMatchObject({ segment: "sites", typeIn: ["VENUE"] });
    expect(locationsQueryArgs(defaultListState(LOCATIONS_SPEC)).typeIn).toBeUndefined();
  });

  it("Address and Tags are opt-in; Last movement is a default column", () => {
    expect(LOCATION_COLUMNS.filter((c) => c.optional).map((c) => c.id)).toEqual(["address", "tags"]);
    expect(LOCATION_COLUMNS.map((c) => c.id)).toContain("lastMovement");
  });

  it("the subtitle reads type, parent and bins", () => {
    expect(locationRowOf(loc({ parentName: "Depot" })).subtitle).toBe("Warehouse · Depot · 11 bins");
  });
});
