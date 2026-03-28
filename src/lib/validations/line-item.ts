import { z } from "zod";

export const lineItemSchema = z.object({
  type: z
    .enum(["EQUIPMENT", "SERVICE", "LABOUR", "TRANSPORT", "MISC"])
    .default("EQUIPMENT"),
  modelId: z.string().optional(),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  categoryId: z.string().optional(),
  groupId: z.string().optional(),
  description: z.string().max(500).optional(),
  quantity: z.coerce.number().int().min(1).max(99999).default(1),
  unitPrice: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? undefined : val),
    z.coerce.number().min(0).max(999999.99).optional()
  ),
  pricingType: z.enum(["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR", "OPTIMIZED"]).default("PER_DAY"),
  duration: z.coerce.number().int().min(1).max(3650).default(1),
  discount: z.coerce.number().min(0).max(999999.99).optional(),
  priceBreakdown: z.string().optional(),
  priceOverridden: z.boolean().default(false),
  overrideReason: z.string().max(200).optional(),
  groupName: z.string().optional(),
  notes: z.string().optional(),
  isOptional: z.boolean().default(false),
  isSubhire: z.boolean().default(false),
  showSubhireOnDocs: z.boolean().default(false),
  supplierId: z.string().optional(),
  subhireOrderNumber: z.string().max(100).optional(),
});

export type LineItemFormValues = z.input<typeof lineItemSchema>;
