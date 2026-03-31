import { z } from "zod";

export const subHireSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  projectId: z.string().optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "ON_HIRE", "RETURNED", "CANCELLED"]).default("DRAFT"),
  hireStart: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  hireEnd: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  showOnDocs: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

export type SubHireFormValues = z.input<typeof subHireSchema>;

export const subHireItemSchema = z.object({
  modelId: z.string().optional(),
  groupId: z.string().optional(),
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").default(1),
  unitCost: z.coerce.number().min(0, "Cost cannot be negative").default(0),
  unitCharge: z.coerce.number().min(0, "Charge cannot be negative").default(0),
  pricingType: z.enum(["FLAT", "PER_DAY", "PER_WEEK", "PER_HOUR"]).default("FLAT"),
  duration: z.coerce.number().int().min(1, "Duration must be at least 1").default(1),
  discount: z.coerce.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%").default(0),
});

export type SubHireItemFormValues = z.input<typeof subHireItemSchema>;

export const subHireGroupSchema = z.object({
  title: z.string().min(1, "Group title is required").max(200),
  sortOrder: z.coerce.number().int().optional(),
});

export type SubHireGroupFormValues = z.input<typeof subHireGroupSchema>;

export const subHireOrderPricingSchema = z.object({
  pricingMode: z.enum(["ITEMIZED", "ORDER_TOTAL"]),
  orderTotalCost: z.coerce.number().min(0).optional().nullable(),
  orderTotalCharge: z.coerce.number().min(0).optional().nullable(),
});

export type SubHireOrderPricingFormValues = z.input<typeof subHireOrderPricingSchema>;
