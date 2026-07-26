import { z } from "zod";

export const modelSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  manufacturer: z.string().max(200).optional(),
  modelNumber: z.string().max(100).optional(),
  sku: z.string().max(100).optional(),
  categoryId: z.string().optional(),
  description: z.string().max(2000).optional(),
  image: z.string().optional(),
  images: z.array(z.string()).default([]),
  manuals: z.array(z.string()).default([]),
  specifications: z.record(z.string(), z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  defaultRentalPrice: z.coerce.number().min(0).optional(),
  dailyRate: z.coerce.number().min(0).optional(),
  weeklyRate: z.coerce.number().min(0).optional(),
  monthlyRate: z.coerce.number().min(0).optional(),
  defaultPurchasePrice: z.coerce.number().min(0).optional(),
  replacementCost: z.coerce.number().min(0).optional(),
  weight: z.coerce.number().min(0).optional(),
  powerDraw: z.coerce.number().int().min(0).optional(),
  requiresTestAndTag: z.boolean().default(false),
  testAndTagIntervalDays: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional().transform(v => v === "" || v === 0 ? undefined : v),
  defaultTestProfileId: z.string().optional(),
  defaultEquipmentClass: z.enum(["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"]).optional(),
  defaultApplianceType: z.enum(["APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD", "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER"]).optional(),
  // maintenanceIntervalDays removed (WS6 #945) — superseded by serviceSchedules
  // (fixed interval + anchor date, managed on the /maintenance/due worklist,
  // not per-model). See convex/schema.ts's deprecation comment on the field.
  assetType: z.enum(["SERIALIZED", "BULK"]).default("SERIALIZED"),
  barcodeLabelTemplate: z.string().optional(),
  isActive: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export type ModelFormValues = z.input<typeof modelSchema>;
