import { z } from "zod";

import { DISCOUNT_MODES } from "@/lib/discount-mode";

// Shared field pieces (R-3.1/R-8.6.1 single source of truth) — `lineItemSchema` and
// `customLineItemSchema` used to hand-duplicate these bounds character-for-character;
// a divergence between the two copies would be a defect even while they stayed in sync
// by accident (#747). `pricingType`/`description`/`notes` are NOT pulled in here — they
// genuinely diverge per-schema (custom items require a description and support a
// narrower pricingType enum, and the two schemas cap `notes` differently), so those stay
// declared inline on each schema rather than being forced into a shared piece.
const quantityField = z.coerce.number().int().min(1).max(99999).default(1);

/**
 * "Left blank" for an OPTIONAL money field, mapped to `undefined` — i.e. the
 * line has no price / no discount, rendered "—", not "$0.00".
 *
 * `z.coerce.number()` alone cannot express that: an untouched `<input
 * type="number">` submits `""`, and `Number("")` is `0`, so `.optional()` never
 * gets a look in. Every blank price landed as a REAL, explicit $0 (#1249) —
 * which suppressed the server's auto-pricing (`fields.unitPrice == null` was
 * never true) and, until #1249 changed it, excluded that gear from revenue
 * allocation entirely, so anything added to a Project Group reported $0 ROI.
 *
 * A typed `0` still parses to `0`: a deliberate free line is a real choice and
 * stays distinguishable from a blank one.
 *
 * Declared with an explicit input type so `z.input<typeof schema>` — what the
 * forms are typed on (CLAUDE.md, Forms & Validation) — keeps accepting the
 * `string | number | undefined` a React Hook Form register() actually yields,
 * instead of collapsing to `unknown` the way a bare `z.preprocess` would.
 */
const blankableNumber = (
  schema: z.ZodType<number, number>,
): z.ZodType<number | undefined, string | number | null | undefined> =>
  z.optional(
    z
      .union([z.literal(""), z.null(), z.coerce.number().pipe(schema)])
      .transform((v) => (v === "" || v === null ? undefined : v)),
  ) as unknown as z.ZodType<number | undefined, string | number | null | undefined>;

const unitPriceField = blankableNumber(z.number().min(0).max(999999.99));
const durationField = z.coerce.number().int().min(1).max(3650).default(1);
const discountField = blankableNumber(z.number().min(0).max(999999.99));
// #1012 — the ENTRY shape of `discountField` ($ off vs % of the line gross).
// `discount` stays the resolved flat dollar amount; this rides alongside it so
// documents can print the discount the way it was typed. Optional/absent = "$".
export const discountModeField = z.enum(DISCOUNT_MODES).optional();
// T3 (#1091, docs/designs/tax-model.md §3/§6) — per-line tax rate override,
// same 0-100 bound as the project-level rate (src/lib/validations/project.ts)
// and moneyGuards.ts's server-side re-check. Blank = inherit.
//
// NOT on `blankableNumber` yet: today a blank box still lands as an explicit 0%
// override, which contradicts the "Blank = inherit" above. That is the same
// defect #1249 fixed for price/discount, but it changes what a CLIENT is taxed
// on every line edited with an empty box, so it belongs in its own change.
const taxRateField = z.coerce.number().min(0).max(100).optional();
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
  discountMode: discountModeField,
  taxRate: taxRateField,
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
  xeroAccountCode: z.string().max(50).optional(),
  xeroTaxType: z.string().max(50).optional(),
});

export type LineItemFormValues = z.input<typeof lineItemSchema>;

export const customLineItemSchema = z.object({
  description: z.string().min(1, "Name is required").max(200),
  quantity: quantityField,
  unitPrice: unitPriceField,
  pricingType: z.enum(["PER_DAY", "PER_WEEK", "FLAT", "PER_HOUR"]).default("FLAT"),
  duration: durationField,
  discount: discountField,
  discountMode: discountModeField,
  taxRate: taxRateField,
  categoryId: categoryIdField,
  groupId: groupIdField,
  notes: z.string().max(500).optional(),
  isOptional: isOptionalField,
});

export type CustomLineItemFormValues = z.input<typeof customLineItemSchema>;
