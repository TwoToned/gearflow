import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  parentId: z.string().nullable().optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  tags: z.array(z.string()).default([]),
  xeroAccountCode: z.string().max(50).optional(),
});

export type CategoryFormValues = z.input<typeof categorySchema>;
