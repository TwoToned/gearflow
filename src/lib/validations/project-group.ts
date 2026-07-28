import { z } from "zod";

import { discountModeField } from "./line-item";

export const projectGroupSchema = z.object({
  // Nullable since v0.9.4.0 — a group can be created directly in the
  // project's Uncategorized zone (categoryId stays null on the row).
  categoryId: z.string().min(1).nullable(),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).optional(),
  // Flat $ amount off `price × quantity` (#883) — same bound as line-item discount
  // (src/lib/validations/line-item.ts discountField).
  discount: z.coerce.number().min(0).max(999999.99).optional(),
  // #1012 — entry shape of the discount above, shared with the line-item schema
  // (R-3.1: one definition of the mode union, not a second `z.enum`).
  discountMode: discountModeField,
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  xeroAccountCode: z.string().max(50).optional(),
  xeroTaxType: z.string().max(50).optional(),
});

export type ProjectGroupFormValues = z.input<typeof projectGroupSchema>;

// R-8.6.3: derived from `projectGroupSchema` (`.pick()` + `.required()`)
// rather than re-declared — same field/constraints, just mandatory here.
// `price` is required (the mutation always needs one to set); `discount` stays
// optional so callers can omit it to leave the existing discount untouched.
export const updateGroupPriceSchema = projectGroupSchema
  .pick({ price: true, discount: true, discountMode: true })
  .required({ price: true });

export const moveLineItemSchema = z.object({
  lineItemId: z.string().min(1),
  targetGroupId: z.string().nullable(),
  targetCategoryId: z.string().nullable(),
});

// Bulk variant: move many line items to the same destination at once.
export const moveLineItemsSchema = z.object({
  lineItemIds: z.array(z.string().min(1)).min(1),
  targetGroupId: z.string().nullable(),
  targetCategoryId: z.string().nullable(),
});
