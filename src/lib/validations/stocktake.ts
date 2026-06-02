import { z } from "zod";

export const createStocktakeSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  locationId: z.string().min(1, "Location is required"),
  scope: z.enum(["FULL", "CATEGORY", "SPOT_CHECK"]),
  categoryId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateStocktakeValues = z.input<typeof createStocktakeSchema>;

export const updateStocktakeSchema = createStocktakeSchema;
export type UpdateStocktakeValues = z.input<typeof updateStocktakeSchema>;

export const scanItemSchema = z.object({
  stocktakeId: z.string().min(1),
  assetTag: z.string().min(1, "Asset tag is required").max(128),
});

export type ScanItemValues = z.input<typeof scanItemSchema>;

export const updateBulkCountSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().int().min(0, "Quantity must be 0 or more"),
});

export type UpdateBulkCountValues = z.input<typeof updateBulkCountSchema>;

export const resolveDiscrepancySchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(["MARK_LOST", "UPDATE_LOCATION", "ADJUST_QUANTITY", "IGNORE"]),
  note: z.string().max(500).optional(),
});

export type ResolveDiscrepancyValues = z.input<typeof resolveDiscrepancySchema>;

export const bulkResolveSchema = z.object({
  stocktakeId: z.string().min(1),
  action: z.enum(["MARK_ALL_MISSING_LOST", "IGNORE_ALL_MISSING"]),
});

export type BulkResolveValues = z.input<typeof bulkResolveSchema>;
