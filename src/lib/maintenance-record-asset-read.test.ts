import { describe, it, expect } from "vitest";
import { mapLink } from "./maintenance-record-asset-read";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "convex_internal_id" as never,
    _creationTime: 1_700_000_000_000,
    id: "link_1",
    maintenanceRecordId: "rec_1",
    assetId: "asset_1",
    ...overrides,
  } as never;
}

describe("mapLink", () => {
  it("returns the flat { id, maintenanceRecordId, assetId } shape, stripping Convex internals", () => {
    const r = mapLink(doc());
    expect(r).toEqual({
      id: "link_1",
      maintenanceRecordId: "rec_1",
      assetId: "asset_1",
    });
    expect(r).not.toHaveProperty("_id");
    expect(r).not.toHaveProperty("_creationTime");
  });
});
