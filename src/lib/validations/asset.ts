import { z } from "zod";

export const assetSchema = z.object({
  modelId: z.string().min(1, "Model is required"),
  assetTag: z.string().min(1, "Asset tag is required").max(50),
  serialNumber: z.string().max(100).optional(),
  customName: z.string().max(200).optional(),
  status: z.enum(["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "LOST", "RESERVED", "SOLD"]).default("AVAILABLE"),
  condition: z.enum(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]).default("NEW"),
  purchaseDate: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  purchasePrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform(v => v === "" ? undefined : v),
  purchaseSupplier: z.string().max(200).optional(),
  supplierId: z.string().optional(),
  purchaseOrderNumber: z.string().max(100).optional(),
  supplierOrderId: z.string().optional(),
  warrantyExpiry: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  notes: z.string().max(2000).optional(),
  locationId: z.string().optional(),
  customFieldValues: z.record(z.string(), z.string()).optional(),
  barcode: z.string().max(100).optional(),
  images: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export type AssetFormValues = z.input<typeof assetSchema>;

export const bulkAssetSchema = z.object({
  modelId: z.string().min(1, "Model is required"),
  assetTag: z.string().min(1, "Asset tag is required").max(50),
  totalQuantity: z.coerce.number().int().min(0, "Quantity must be 0 or more").default(0),
  purchasePricePerUnit: z.coerce.number().min(0).optional(),
  locationId: z.string().optional(),
  status: z.enum(["ACTIVE", "LOW_STOCK", "OUT_OF_STOCK", "RETIRED"]).default("ACTIVE"),
  notes: z.string().max(2000).optional(),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export type BulkAssetFormValues = z.input<typeof bulkAssetSchema>;

// ─── Child assets / accessories ──────────────────────────────────────────────

/** Attach a serialised asset as a permanent accessory of a parent asset. */
export const assetSerializedChildSchema = z.object({
  childAssetId: z.string().min(1, "Accessory asset is required"),
  notes: z.string().max(500).optional(),
});

export type AssetSerializedChildFormValues = z.input<typeof assetSerializedChildSchema>;

/** Attach a bulk asset (with quantity + allocation mode) as an accessory. */
export const assetBulkChildSchema = z.object({
  bulkAssetId: z.string().min(1, "Bulk asset is required"),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  // SHIPS_WITH (default): drawn from the live pool at prep/checkout — the
  // shared pool is NOT touched at attach time. DEDICATED: permanently pulled
  // out of the pool now (availableQuantity decremented), restored on detach.
  allocationMode: z.enum(["SHIPS_WITH", "DEDICATED"]).default("SHIPS_WITH"),
  notes: z.string().max(500).optional(),
});

export type AssetBulkChildFormValues = z.input<typeof assetBulkChildSchema>;

/** Attach a bulk asset as a default accessory on a Model — every asset of
 * that model inherits it. Bulk only at the model level; always SHIPS_WITH.
 * Same bulkAssetId/quantity/notes shape as assetBulkChildSchema, minus
 * allocationMode (model-level accessories are always SHIPS_WITH) — derived via
 * `.omit()` (R-8.6.3) rather than re-declared. */
export const modelBulkAccessorySchema = assetBulkChildSchema.omit({ allocationMode: true }).extend({
  // DEFAULT (default): auto-attaches when the model is added to a project (PM may
  // deselect per line). OPTIONAL: never auto-attaches — offered in the add-time
  // picker (issue #794).
  inclusion: z.enum(["DEFAULT", "OPTIONAL"]).default("DEFAULT"),
});

export type ModelBulkAccessoryFormValues = z.input<typeof modelBulkAccessorySchema>;

/** Patch form for an existing model accessory — quantity/inclusion/notes only
 * (bulkAssetId is immutable after creation; remove+re-add to change it). */
export const modelBulkAccessoryUpdateSchema = modelBulkAccessorySchema.omit({ bulkAssetId: true }).partial();

export type ModelBulkAccessoryUpdateFormValues = z.input<typeof modelBulkAccessoryUpdateSchema>;

export const locationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  address: z.string().max(500).optional(),
  latitude: z.union([z.null(), z.coerce.number()]).optional(),
  longitude: z.union([z.null(), z.coerce.number()]).optional(),
  type: z.enum(["WAREHOUSE", "VENUE", "VEHICLE", "OFFSITE"]).default("WAREHOUSE"),
  isDefault: z.boolean().default(false),
  parentId: z.string().nullable().optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string()).default([]),
}).refine(
  (data) => (data.latitude != null) === (data.longitude != null),
  { message: "Both latitude and longitude must be provided together" }
);

export type LocationFormValues = z.input<typeof locationSchema>;

