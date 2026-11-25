import { z } from "zod";

import { blankableNumber } from "./blankable";

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
  // Optional money / measures are `blankableNumber`: a blank box stays blank, never a
  // real $0 (a rate of 0 means "free", not "not set"; #1249, UX Phase 12 §9e.3).
  defaultRentalPrice: blankableNumber(z.number().min(0)),
  dailyRate: blankableNumber(z.number().min(0)),
  weeklyRate: blankableNumber(z.number().min(0)),
  monthlyRate: blankableNumber(z.number().min(0)),
  defaultPurchasePrice: blankableNumber(z.number().min(0)),
  replacementCost: blankableNumber(z.number().min(0)),
  // WS11 (#950) — sales items. `saleStockQuantity` has no `.min()`: a negative
  // pool is valid (oversell is warn-allow, spec decision), not an input error.
  salePrice: blankableNumber(z.number().min(0)),
  // Blank stays blank (never a real 0 pool): `blankableNumber`, like every other optional number here.
  saleStockQuantity: blankableNumber(z.number().int()),
  weight: blankableNumber(z.number().min(0)),
  powerDraw: blankableNumber(z.number().int().min(0)),
  requiresTestAndTag: z.boolean().default(false),
  testAndTagIntervalDays: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional().transform(v => v === "" || v === 0 ? undefined : v),
  defaultTestProfileId: z.string().optional(),
  defaultEquipmentClass: z.enum(["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"]).optional(),
  defaultApplianceType: z.enum(["APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD", "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER"]).optional(),
  // maintenanceIntervalDays is DEPRECATED (WS6 #945) — superseded by serviceSchedules
  // (fixed interval + anchor date, managed on the /maintenance/due worklist, not
  // per-model), and no form field edits it. It stays in the schema only so a stored
  // value is CARRIED through an edit: the write treats an absent field as "clear it".
  maintenanceIntervalDays: blankableNumber(z.number().int().min(0)),
  assetType: z.enum(["SERIALIZED", "BULK"]).default("SERIALIZED"),
  barcodeLabelTemplate: z.string().optional(),
  isActive: z.boolean().default(true),
  // #1296 packing containers — this model can be used as a packing container
  // (case, tub, road box) regardless of which category it sits in.
  isContainer: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  xeroRentalAccountCode: z.string().max(50).optional(),
  xeroSaleAccountCode: z.string().max(50).optional(),
});

export type ModelFormValues = z.input<typeof modelSchema>;
