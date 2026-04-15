import { z } from "zod";

// Each item references exactly one of modelId or kitId. Model items expand to
// a single model-level line item at the target model's dailyRate; kit items
// expand via addKitLineItem (parent + children + optional grandchildren).
export const groupTemplateItemSchema = z
  .object({
    modelId: z.string().optional(),
    kitId: z.string().optional(),
    quantity: z.coerce.number().int().min(1).max(9999).default(1),
    sortOrder: z.coerce.number().int().default(0),
  })
  .refine((v) => !!v.modelId !== !!v.kitId, {
    message: "Each template item must reference either a model or a kit, not both",
  });

export const groupTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  items: z
    .array(groupTemplateItemSchema)
    .min(1, "At least one item is required"),
});

export type GroupTemplateFormValues = z.input<typeof groupTemplateSchema>;
export type GroupTemplateItemFormValues = z.input<typeof groupTemplateItemSchema>;

export const applyGroupTemplateSchema = z.object({
  templateId: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
});
