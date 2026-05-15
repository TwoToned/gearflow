import { z } from "zod";

export const maintenanceSchema = z.object({
  assetId: z.string().optional(),
  assetIds: z.array(z.string().min(1)).optional(),
  type: z
    .enum([
      "REPAIR",
      "PREVENTATIVE",
      "TEST_AND_TAG",
      "INSPECTION",
      "CLEANING",
      "FIRMWARE_UPDATE",
    ])
    .default("REPAIR"),
  status: z
    .enum(["SCHEDULED", "AWAITING_PARTS", "IN_PROGRESS", "QA", "COMPLETED", "CANCELLED"])
    .default("SCHEDULED"),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  reportedById: z.string().optional(),
  assignedToId: z.string().optional(),
  scheduledDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  completedDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  cost: z.coerce.number().min(0).optional(),
  partsUsed: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(20).default([]),
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]).optional(),
  tags: z.array(z.string()).default([]),
  nextDueDate: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
}).refine(
  (data) => (data.assetId && data.assetId.length > 0) || (data.assetIds && data.assetIds.length > 0),
  { message: "At least one asset is required", path: ["assetIds"] }
);

export type MaintenanceFormValues = z.input<typeof maintenanceSchema>;
