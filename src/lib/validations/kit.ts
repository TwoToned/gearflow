import { z } from "zod";

export const kitSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  assetTag: z.string().min(1, "Asset tag is required").max(50),
  description: z.string().max(2000).optional(),
  categoryId: z.string().optional(),
  status: z.enum(["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "INCOMPLETE"]).default("AVAILABLE"),
  condition: z.enum(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]).default("NEW"),
  locationId: z.string().optional(),
  weight: z.coerce.number().min(0).optional(),
  caseType: z.string().max(200).optional(),
  caseDimensions: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  purchaseDate: z.union([z.coerce.date(), z.literal("")]).optional().transform((val) => val === "" ? undefined : val),
  purchasePrice: z.coerce.number().min(0).optional(),
  image: z.string().optional(),
  images: z.array(z.string()).default([]),
  checkMode: z.enum(["KIT_LEVEL", "PER_ITEM"]).default("KIT_LEVEL"),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  xeroAccountCode: z.string().max(50).optional(),
});

export type KitFormValues = z.input<typeof kitSchema>;

export const kitSerializedItemSchema = z.object({
  assetId: z.string().min(1, "Asset is required"),
  position: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export type KitSerializedItemFormValues = z.input<typeof kitSerializedItemSchema>;

export const kitBulkItemSchema = z.object({
  bulkAssetId: z.string().min(1, "Bulk asset is required"),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  position: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export type KitBulkItemFormValues = z.input<typeof kitBulkItemSchema>;
