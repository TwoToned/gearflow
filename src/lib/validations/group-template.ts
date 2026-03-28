import { z } from "zod";

export const groupTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  items: z.array(
    z.object({
      modelId: z.string().min(1),
      quantity: z.coerce.number().int().min(1).default(1),
    })
  ).min(1, "At least one item is required"),
});

export type GroupTemplateFormValues = z.input<typeof groupTemplateSchema>;

export const applyGroupTemplateSchema = z.object({
  templateId: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
});
