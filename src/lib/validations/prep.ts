import { z } from "zod";

export const createPrepSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  name: z.string().min(1, "Name is required").max(200),
  containerAssetId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreatePrepInput = z.input<typeof createPrepSchema>;

export const updatePrepSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type UpdatePrepInput = z.input<typeof updatePrepSchema>;

export const addPrepItemSchema = z.object({
  prepId: z.string().min(1),
  assetTag: z.string().min(1, "Asset tag is required"),
});

export type AddPrepItemInput = z.input<typeof addPrepItemSchema>;

export const addBulkPrepItemSchema = z.object({
  prepId: z.string().min(1),
  bulkAssetId: z.string().min(1),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

export type AddBulkPrepItemInput = z.input<typeof addBulkPrepItemSchema>;
