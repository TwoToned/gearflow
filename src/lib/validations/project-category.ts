import { z } from "zod";

export const projectCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export type ProjectCategoryFormValues = z.input<typeof projectCategorySchema>;
