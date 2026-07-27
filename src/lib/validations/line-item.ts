import { z } from "zod";

// Shared field pieces (R-3.1/R-8.6.1 single source of truth) — `lineItemSchema` and
// `customLineItemSchema` used to hand-duplicate these bounds character-for-character;
// a divergence between the two copies would be a defect even while they stayed in sync
// by accident (#747). `pricingType`/`description`/`notes` are NOT pulled in here — they
// genuinely diverge per-schema (custom items require a description and support a
// narrower pricingType enum, and the two schemas cap `notes` differently), so those stay
// declared inline on each schema rather than being forced into a shared piece.
const quantityField = z.coerce.number().int().min(1).max(99999).default(1);
const unitPriceField = z.coerce.number().min(0).max(999999.99).optional();
const durationField = z.coerce.number().int().min(1).max(3650).default(1);
const discountField = z.coerce.number().min(0).max(999999.99).optional();
const categoryIdField = z.string().optional();
const groupIdField = z.string().optional();
const isOptionalField = z.boolean().default(false);

export const lineItemSchema = z.object({
  type: z
    .enum(["EQUIPMENT", "SERVICE", "LABOUR", "TRANSPORT", "MISC", "SALE"])
    .default("EQUIPMENT"),
  // WS11 (#950) — set only on `type: "SALE"` lines, never inferred. NEW_STOCK
  // = sell from new stock (no rental-asset impact, decrements
  // Model.saleStockQuantity). FROM_RENTAL_STOCK = sell an owned unit/bulk
  // qty out of rental stock (serialised -> AssetStatus "SOLD"; bulk ->
  // adjustBulkTotal). See FEATUREDOCS/67-sales-line-items.md.
  saleMode: z.enum(["NEW_STOCK", "FROM_RENTAL_STOCK"]).optional(),
  modelId: z.string().optional(),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  categoryId: categoryIdField,
  groupId: groupIdField,
  description: z.string().max(500).optional(),
  quantity: quantityField,
  unitPrice: unitPriceField,
  pricingType: z.enum(["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR", "OPTIMIZED"]).default("PER_DAY"),
  duration: durationField,
  discount: discountField,
  priceBreakdown: z.string().optional(),
  priceOverridden: z.boolean().default(false),
  overrideReason: z.string().max(200).optional(),
  groupName: z.string().optional(),
  notes: z.string().optional(),
  isOptional: isOptionalField,
  // `isSubhire` removed (Wave 2). Sub-hire detection via `subHireId != null`.
  showSubhireOnDocs: z.boolean().default(false),
  supplierId: z.string().optional(),
  subhireOrderNumber: z.string().max(100).optional(),
});

export type LineItemFormValues = z.input<typeof lineItemSchema>;

export const customLineItemSchema = z.object({
  description: z.string().min(1, "Name is required").max(200),
  quantity: quantityField,
  unitPrice: unitPriceField,
  pricingType: z.enum(["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR"]).default("FLAT"),
  duration: durationField,
  discount: discountField,
  categoryId: categoryIdField,
  groupId: groupIdField,
  notes: z.string().max(500).optional(),
  isOptional: isOptionalField,
});

export type CustomLineItemFormValues = z.input<typeof customLineItemSchema>;
