import { z } from "zod";

export const projectGroupSchema = z.object({
  // Nullable since v0.9.4.0 — a group can be created directly in the
  // project's Uncategorized zone (categoryId stays null on the row).
  categoryId: z.string().min(1).nullable(),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).optional(),
  rentalPeriod: z.enum(["DAILY", "WEEKLY"]).optional(),
  rentalQuantity: z.coerce.number().int().min(1).optional(),
  billingMonths: z.coerce.number().int().min(0).optional(),
  billingWeeks: z.coerce.number().int().min(0).optional(),
  billingDays: z.coerce.number().int().min(0).optional(),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export type ProjectGroupFormValues = z.input<typeof projectGroupSchema>;

export const updateGroupPriceSchema = z.object({
  price: z.coerce.number().min(0),
});

export const moveLineItemSchema = z.object({
  lineItemId: z.string().min(1),
  targetGroupId: z.string().nullable(),
  targetCategoryId: z.string().nullable(),
});
