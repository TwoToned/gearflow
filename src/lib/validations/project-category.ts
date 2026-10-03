import { z } from "zod";
import { CATEGORY_PRICING_DISPLAYS } from "@/lib/category-pricing-display";

export const projectCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  /** Category price rollup — how this category prints its money on a
   *  client-facing document. Derived from the shared literal list rather than
   *  re-typing the union so the schema, the Convex validator's comment and the
   *  UI can't drift apart (R-3.1). Optional: absent means "leave as-is"/
   *  `ITEMISED`, matching the stored default. */
  pricingDisplay: z.enum(CATEGORY_PRICING_DISPLAYS).optional(),
});

export type ProjectCategoryFormValues = z.input<typeof projectCategorySchema>;
