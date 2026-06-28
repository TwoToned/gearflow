/**
 * CLIENT-SAFE reconstruction of the ASSET detail page's getAsset shape from the
 * ONE `assetDetail.bundle` subscription. Zero server imports.
 *
 * DTO reconstruction: the asset page (+ AssetAccessoriesManager / booking history)
 * reads a bounded subset of each sub-entity (verified by field-usage trace), so
 * this produces those fields rather than the full Prisma rows. Parity with getAsset:
 * media drop file-less rows, child assets carry their model, child bulk children +
 * model accessories carry bulkAsset.model, ≤20 usage line items (already sliced in
 * the composite), maintenance links keep only their record (sorted desc), scanLogs
 * omitted (no page consumer). Dates → Date (formatDate accepts Date).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type AssetBundleData = NonNullable<FunctionReturnType<typeof api.assetDetail.bundle>>;

const toDate = (n: number | null | undefined): Date | null =>
  typeof n === "number" ? new Date(n) : null;

type FileDoc = AssetBundleData["files"][number];
/** Structural shape shared by assetMedia + modelMedia rows (the consumed fields). */
type MediaRow = {
  id: string;
  fileId: string;
  type?: string;
  isPrimary?: boolean;
  displayName?: string | null;
  sortOrder?: number;
};

interface MediaItem {
  id: string;
  fileId: string;
  type: string;
  isPrimary: boolean;
  displayName: string | null;
  sortOrder: number;
  file: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    url: string;
    thumbnailUrl: string | null;
  };
}

function toMediaItems(rows: MediaRow[], fileMap: Map<string, FileDoc>): MediaItem[] {
  return [...rows]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .flatMap((m) => {
      const f = fileMap.get(m.fileId);
      if (!f) return []; // drop file-less rows (broken join → empty, mirrors getAsset)
      return [{
        id: m.id,
        fileId: m.fileId,
        type: (m.type ?? "PHOTO") as string,
        isPrimary: m.isPrimary ?? false,
        displayName: m.displayName ?? null,
        sortOrder: m.sortOrder ?? 0,
        file: {
          id: f.id,
          fileName: f.fileName,
          fileSize: f.fileSize,
          mimeType: f.mimeType,
          url: f.url,
          thumbnailUrl: f.thumbnailUrl ?? null,
        },
      }];
    });
}

/** Reconstruct getAsset's output from the bundle's raw docs (thin DTOs). */
export function reconstructAsset(bundle: AssetBundleData) {
  const a = bundle.asset;
  const modelName = new Map(bundle.models.map((m) => [m.id, m]));
  const bulkAssetMap = new Map(bundle.bulkAssets.map((b) => [b.id, b]));
  const projectMap = new Map(bundle.projects.map((p) => [p.id, p]));
  const maintMap = new Map(bundle.maintenanceRecords.map((m) => [m.id, m]));
  const fileMap = new Map(bundle.files.map((f) => [f.id, f]));

  // Resolve a bulk asset → { assetTag, model: { name } } (for accessories lists).
  const bulkRef = (bulkAssetId: string) => {
    const ba = bulkAssetMap.get(bulkAssetId);
    const m = ba?.modelId ? modelName.get(ba.modelId) : undefined;
    return {
      id: bulkAssetId,
      assetTag: ba?.assetTag ?? "",
      modelId: ba?.modelId ?? null,
      model: m ? { name: m.name ?? "", manufacturer: m.manufacturer ?? null } : null,
    };
  };

  const childAssets = [...bundle.childAssets]
    .sort((x, y) => (x.assetTag < y.assetTag ? -1 : x.assetTag > y.assetTag ? 1 : 0))
    .map((c) => {
      const m = c.modelId ? modelName.get(c.modelId) : undefined;
      return {
        id: c.id,
        assetTag: c.assetTag,
        customName: c.customName ?? null,
        modelId: c.modelId ?? null,
        model: m ? { name: m.name ?? "", manufacturer: m.manufacturer ?? null } : null,
      };
    });

  const childBulkItems = [...bundle.childBulkChildren]
    .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))
    .map((item) => ({
      id: item.id,
      parentAssetId: item.parentAssetId,
      bulkAssetId: item.bulkAssetId,
      quantity: item.quantity,
      sortOrder: item.sortOrder ?? null,
      bulkAsset: bulkRef(item.bulkAssetId),
    }));

  const lineItems = bundle.lineItems.map((li) => {
    const project = li.projectId ? projectMap.get(li.projectId) : undefined;
    return {
      id: li.id,
      projectId: li.projectId ?? null,
      status: li.status ?? "CONFIRMED",
      checkedOutAt: toDate(li.checkedOutAt),
      returnedAt: toDate(li.returnedAt),
      project: project
        ? { id: project.id, name: project.name, projectNumber: project.projectNumber }
        : { name: "", projectNumber: "" },
    };
  });

  const maintenanceLinks = bundle.maintenanceLinks
    .flatMap((link) => {
      const rec = maintMap.get(link.maintenanceRecordId);
      if (!rec) return [];
      return [{
        id: link.id,
        maintenanceRecordId: link.maintenanceRecordId,
        maintenanceRecord: {
          id: rec.id,
          title: rec.title,
          type: rec.type,
          status: rec.status,
          result: rec.result ?? null,
          completedDate: toDate(rec.completedDate),
          scheduledDate: toDate(rec.scheduledDate),
          createdAt: toDate(rec.createdAt),
        },
      }];
    })
    .sort((x, y) => (y.maintenanceRecord.createdAt?.getTime() ?? 0) - (x.maintenanceRecord.createdAt?.getTime() ?? 0))
    .slice(0, 20);

  const tt = bundle.testTags[0];
  const testTagAsset = tt
    ? {
        id: tt.id,
        testTagId: tt.testTagId,
        status: tt.status ?? null,
        lastTestDate: toDate(tt.lastTestDate),
        nextDueDate: toDate(tt.nextDueDate),
      }
    : null;

  const model = bundle.model
    ? {
        id: bundle.model.id,
        name: bundle.model.name ?? "",
        manufacturer: bundle.model.manufacturer ?? null,
        requiresTestAndTag: bundle.model.requiresTestAndTag ?? false,
        specifications: bundle.model.specifications ?? null,
        category: bundle.category ? { id: bundle.category.id, name: bundle.category.name } : null,
        media: toMediaItems(bundle.modelMedia, fileMap),
        bulkAccessories: [...bundle.modelAccessories]
          .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))
          .map((ba) => ({
            id: ba.id,
            modelId: ba.modelId,
            bulkAssetId: ba.bulkAssetId,
            quantity: ba.quantity,
            sortOrder: ba.sortOrder ?? null,
            bulkAsset: bulkRef(ba.bulkAssetId),
          })),
      }
    : null;

  return {
    id: a.id,
    organizationId: a.organizationId,
    assetTag: a.assetTag,
    customName: a.customName ?? null,
    serialNumber: a.serialNumber ?? null,
    status: a.status ?? "AVAILABLE",
    condition: a.condition ?? "GOOD",
    modelId: a.modelId ?? null,
    supplierId: a.supplierId ?? null,
    locationId: a.locationId ?? null,
    parentAssetId: a.parentAssetId ?? null,
    barcode: a.barcode ?? null,
    notes: a.notes ?? null,
    isActive: a.isActive ?? true,
    purchaseDate: toDate(a.purchaseDate),
    purchasePrice: a.purchasePrice ?? null,
    purchaseSupplier: a.purchaseSupplier ?? null,
    warrantyExpiry: toDate(a.warrantyExpiry),
    lastTestAndTagDate: toDate(a.lastTestAndTagDate),
    nextTestAndTagDate: toDate(a.nextTestAndTagDate),
    customFieldValues: a.customFieldValues ?? null,
    createdAt: toDate(a.createdAt),
    updatedAt: toDate(a.updatedAt),
    media: toMediaItems(bundle.assetMedia, fileMap),
    model,
    supplier: bundle.supplier ? { id: bundle.supplier.id, name: bundle.supplier.name } : null,
    parentAsset: bundle.parentAsset
      ? { id: bundle.parentAsset.id, assetTag: bundle.parentAsset.assetTag, customName: bundle.parentAsset.customName ?? null }
      : null,
    location: bundle.location ? { id: bundle.location.id, name: bundle.location.name } : null,
    childAssets,
    childBulkItems,
    lineItems,
    maintenanceLinks,
    testTagAsset,
    scanLogs: [] as never[],
  };
}

export type NativeAssetDetail = ReturnType<typeof reconstructAsset>;
