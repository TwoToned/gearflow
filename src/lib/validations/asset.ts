import { z } from "zod";

export const assetSchema = z.object({
  modelId: z.string().min(1, "Model is required"),
  assetTag: z.string().min(1, "Asset tag is required").max(50),
  serialNumber: z.string().max(100).optional(),
  customName: z.string().max(200).optional(),
  status: z.enum(["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "LOST", "RESERVED"]).default("AVAILABLE"),
  condition: z.enum(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]).default("NEW"),
  purchaseDate: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  purchasePrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform(v => v === "" ? undefined : v),
  purchaseSupplier: z.string().max(200).optional(),
  supplierId: z.string().optional(),
  purchaseOrderNumber: z.string().max(100).optional(),
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
  reorderThreshold: z.coerce.number().int().min(0).optional(),
  preferredSupplierId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export type BulkAssetFormValues = z.input<typeof bulkAssetSchema>;

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

