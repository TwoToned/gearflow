import { z } from "zod";

/**
 * ServiceSchedule form schema (WS6 #945 — recurring preventative maintenance).
 * Fixed-calendar cadence: interval (months) + anchor date. See
 * convex/lib/serviceScheduleCore.ts for the due-date math this cadence drives.
 */
export const serviceScheduleSchema = z.object({
  modelId: z.string().min(1, "Model is required"),
  name: z.string().min(1, "Name is required").max(200),
  intervalMonths: z.coerce.number().int().min(1, "Must be at least 1 month").max(120),
  anchorDate: z.coerce.date({ message: "Anchor date is required" }),
  instructions: z.string().max(5000).optional(),
  isActive: z.boolean().default(true),
});

export type ServiceScheduleFormValues = z.input<typeof serviceScheduleSchema>;
