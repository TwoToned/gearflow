import { describe, it, expect } from "vitest";

import { assetEditValues } from "./asset-edit-values";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";

const asset = {
  id: "a1", assetTag: "AURA-01", modelId: "m1", serialNumber: null, customName: null, status: "AVAILABLE", condition: "GOOD",
  purchaseDate: new Date("2026-01-02"), purchasePrice: null, purchaseSupplier: null, supplierId: "s1", warrantyExpiry: null,
  notes: "keep me", locationId: null, barcode: "BC", images: ["img1"], isActive: true, tags: ["rig", "led"], customFieldValues: { Owner: "FOH" },
} as unknown as NativeAssetDetail;

describe("assetEditValues", () => {
  it("holds everything the edit write sets back, so an edit never clears tags, images, notes or custom fields", () => {
    const v = assetEditValues(asset);
    expect(v).toMatchObject({ id: "a1", tags: ["rig", "led"], images: ["img1"], notes: "keep me", barcode: "BC", customFieldValues: { Owner: "FOH" }, supplierId: "s1" });
  });

  it("blank text is empty and a missing price stays undefined, never 0", () => {
    const v = assetEditValues(asset);
    expect(v.serialNumber).toBe("");
    expect(v.locationId).toBe("");
    expect(v.purchasePrice).toBeUndefined();
    expect(v.warrantyExpiry).toBeUndefined();
  });
});
