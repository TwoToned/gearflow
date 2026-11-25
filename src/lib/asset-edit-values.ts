import type { AssetFormValues } from "@/lib/validations/asset";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";

const text = (v: string | null | undefined) => v ?? "";

/**
 * The record the edit sheet opens with. `notes` rides along unchanged: the Notes tab owns
 * the note, and an edit must never clear it (the write sets every field the sheet holds).
 */
export function assetEditValues(a: NativeAssetDetail): AssetFormValues & { id: string } {
  return {
    id: a.id,
    modelId: text(a.modelId),
    assetTag: a.assetTag,
    serialNumber: text(a.serialNumber),
    customName: text(a.customName),
    status: a.status as AssetFormValues["status"],
    condition: a.condition as AssetFormValues["condition"],
    purchaseDate: a.purchaseDate ?? undefined,
    purchasePrice: a.purchasePrice ?? undefined,
    purchaseSupplier: text(a.purchaseSupplier),
    supplierId: text(a.supplierId),
    warrantyExpiry: a.warrantyExpiry ?? undefined,
    notes: text(a.notes),
    locationId: text(a.locationId),
    barcode: text(a.barcode),
    images: a.images,
    isActive: a.isActive,
    tags: a.tags,
    customFieldValues: (a.customFieldValues ?? undefined) as Record<string, string> | undefined,
  };
}
