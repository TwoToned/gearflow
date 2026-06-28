/**
 * CLIENT-SAFE reconstruction of the KIT detail page's getKit shape from the ONE
 * `kitDetail.bundle` subscription. Zero server imports.
 *
 * DTO reconstruction: the kit page reads only a small subset of each sub-entity
 * (verified by field-usage trace), so this produces exactly those fields rather
 * than the full Prisma row — the §3.5 browser-DTO principle. Parity with getKit's
 * structure (members drop when their asset/project is absent, ≤20 sorted usage /
 * scan rows — already applied in the composite, scanLogs keep null joins).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type KitBundleData = NonNullable<FunctionReturnType<typeof api.kitDetail.bundle>>;

const toDate = (n: number | null | undefined): Date | null =>
  typeof n === "number" ? new Date(n) : null;

export interface NativeKitDetail {
  id: string;
  name: string;
  assetTag: string;
  status: string;
  condition: string;
  isActive: boolean;
  description: string | null;
  categoryId: string | null;
  locationId: string | null;
  weight: number | null;
  caseType: string | null;
  caseDimensions: string | null;
  notes: string | null;
  purchaseDate: Date | null;
  purchasePrice: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  location: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  serializedItems: Array<{
    id: string;
    assetId: string;
    position: string | null;
    asset: { id: string; assetTag: string; condition: string | null; model: { name: string } | null };
  }>;
  bulkItems: Array<{
    id: string;
    quantity: number;
    position: string | null;
    bulkAsset: { id: string; model: { name: string } | null };
  }>;
  lineItems: Array<{
    id: string;
    projectId: string;
    status: string;
    checkedOutAt: Date | null;
    returnedAt: Date | null;
    project: { id: string; name: string; projectNumber: string };
  }>;
  scanLogs: Array<{
    id: string;
    scannedAt: Date | null;
    scannedById: string;
    projectId: string | null;
    scannedBy: { id: string; name: string } | null;
    project: { id: string; name: string } | null;
  }>;
  /** getKit returns these but the kit page never renders them. */
  maintenanceRecords: never[];
  media: Array<{
    id: string;
    type: string;
    isPrimary: boolean;
    file: { url: string; thumbnailUrl: string | null } | null;
  }>;
}

/** Reconstruct getKit's output from the bundle's raw docs (thin DTOs). */
export function reconstructKit(bundle: KitBundleData): NativeKitDetail {
  const k = bundle.kit;
  const modelName = new Map(bundle.models.map((m) => [m.id, m.name ?? ""]));
  const assetMap = new Map(bundle.assets.map((a) => [a.id, a]));
  const bulkAssetMap = new Map(bundle.bulkAssets.map((b) => [b.id, b]));
  const projectMap = new Map(bundle.projects.map((p) => [p.id, p]));
  const userMap = new Map(bundle.users.map((u) => [u.id, u]));
  const fileMap = new Map(bundle.files.map((f) => [f.id, f]));

  // Members drop when their asset/bulkAsset is absent (mirrors getKit's flatMap).
  const serializedItems = bundle.serializedItems.flatMap((si) => {
    const asset = assetMap.get(si.assetId);
    if (!asset) return [];
    return [{
      id: si.id,
      assetId: si.assetId,
      position: si.position ?? null,
      asset: {
        id: asset.id,
        assetTag: asset.assetTag ?? "",
        condition: asset.condition ?? null,
        model: asset.modelId ? { name: modelName.get(asset.modelId) ?? "" } : null,
      },
    }];
  });

  const bulkItems = bundle.bulkItems.flatMap((bi) => {
    const bulkAsset = bulkAssetMap.get(bi.bulkAssetId);
    if (!bulkAsset) return [];
    return [{
      id: bi.id,
      quantity: bi.quantity ?? 0,
      position: bi.position ?? null,
      bulkAsset: {
        id: bulkAsset.id,
        model: bulkAsset.modelId ? { name: modelName.get(bulkAsset.modelId) ?? "" } : null,
      },
    }];
  });

  // Usage line items drop when their project is absent (mirrors getKit's flatMap).
  const lineItems = bundle.lineItems.flatMap((r) => {
    const project = projectMap.get(r.projectId);
    if (!project) return [];
    return [{
      id: r.id,
      projectId: r.projectId,
      status: r.status ?? "QUOTED",
      checkedOutAt: toDate(r.checkedOutAt),
      returnedAt: toDate(r.returnedAt),
      project: { id: project.id, name: project.name, projectNumber: project.projectNumber },
    }];
  });

  const scanLogs = bundle.scanLogs.map((l) => {
    const user = userMap.get(l.scannedById);
    const project = l.projectId ? projectMap.get(l.projectId) : undefined;
    return {
      id: l.id,
      scannedAt: toDate(l.scannedAt),
      scannedById: l.scannedById,
      projectId: l.projectId ?? null,
      scannedBy: user ? { id: user.id, name: user.name } : null,
      project: project ? { id: project.id, name: project.name } : null,
    };
  });

  const media = bundle.media.map((m) => {
    const file = fileMap.get(m.fileId);
    return {
      id: m.id,
      type: m.type ?? "PHOTO",
      isPrimary: m.isPrimary ?? false,
      file: file ? { url: file.url, thumbnailUrl: file.thumbnailUrl ?? null } : null,
    };
  });

  return {
    id: k.id,
    name: k.name,
    assetTag: k.assetTag,
    status: k.status ?? "AVAILABLE",
    condition: k.condition ?? "NEW",
    isActive: k.isActive ?? true,
    description: k.description ?? null,
    categoryId: k.categoryId ?? null,
    locationId: k.locationId ?? null,
    weight: k.weight ?? null,
    caseType: k.caseType ?? null,
    caseDimensions: k.caseDimensions ?? null,
    notes: k.notes ?? null,
    purchaseDate: toDate(k.purchaseDate),
    purchasePrice: k.purchasePrice ?? null,
    createdAt: toDate(k.createdAt),
    updatedAt: toDate(k.updatedAt),
    location: bundle.location ? { id: bundle.location.id, name: bundle.location.name } : null,
    category: bundle.category ? { id: bundle.category.id, name: bundle.category.name } : null,
    serializedItems,
    bulkItems,
    lineItems,
    scanLogs,
    maintenanceRecords: [],
    media,
  };
}
