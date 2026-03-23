import { z } from "zod";

// ─── Check Item Library ─────────────────────────────────────────────────────

const dropdownOptionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  isFail: z.boolean().default(false),
});

export const checkItemSchema = z
  .object({
    label: z.string().min(1, "Label is required").max(200),
    description: z.string().max(1000).optional(),
    type: z
      .enum(["PASS_FAIL", "NOTES", "MEASUREMENT", "DROPDOWN"])
      .default("PASS_FAIL"),
    category: z.string().max(100).optional(),
    measurementUnit: z.string().max(20).optional(),
    measurementMin: z.coerce.number().optional(),
    measurementMax: z.coerce.number().optional(),
    dropdownOptions: z.array(dropdownOptionSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.type === "MEASUREMENT") {
        return (
          data.measurementMin !== undefined || data.measurementMax !== undefined
        );
      }
      return true;
    },
    {
      message: "Measurement type requires at least a min or max threshold",
      path: ["measurementMin"],
    }
  )
  .refine(
    (data) => {
      if (data.type === "DROPDOWN") {
        return data.dropdownOptions && data.dropdownOptions.length >= 2;
      }
      return true;
    },
    {
      message: "Dropdown type requires at least 2 options",
      path: ["dropdownOptions"],
    }
  );

export type CheckItemFormValues = z.input<typeof checkItemSchema>;

// ─── Model Check Item (assign to model) ─────────────────────────────────────

export const modelCheckItemSchema = z.object({
  checkItemId: z.string().min(1, "Check item is required"),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export type ModelCheckItemFormValues = z.input<typeof modelCheckItemSchema>;

// ─── Check Record (single result) ──────────────────────────────────────────

export const checkRecordSchema = z.object({
  checkItemId: z.string().min(1),
  result: z.enum(["PASS", "FAIL", "NOTES_ONLY"]),
  value: z.string().optional(),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string()).default([]),
});

export type CheckRecordFormValues = z.input<typeof checkRecordSchema>;

// ─── Submit Checks (batch for a single item/asset) ──────────────────────────

export const submitChecksSchema = z.object({
  lineItemId: z.string().optional(), // null for AD_HOC
  assetId: z.string().min(1, "Asset is required"),
  bulkAssetId: z.string().optional(),
  context: z.enum(["PREP", "RETURN", "AD_HOC"]),
  checks: z.array(checkRecordSchema).min(1, "At least one check is required"),
});

export type SubmitChecksFormValues = z.input<typeof submitChecksSchema>;

// ─── Complete Check and Pack (prep flow) ────────────────────────────────────

export const completeCheckAndPackSchema = z.object({
  projectId: z.string().min(1),
  lineItemId: z.string().min(1),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  checks: z.array(checkRecordSchema).min(1),
});

export type CompleteCheckAndPackValues = z.input<
  typeof completeCheckAndPackSchema
>;

// ─── Complete Check and Flag (prep flow — faulty/TT overdue) ────────────────

export const completeCheckAndFlagSchema = z.object({
  projectId: z.string().min(1),
  lineItemId: z.string().min(1),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  checks: z.array(checkRecordSchema).min(1),
  flagType: z.enum(["FLAGGED_FAULTY", "FLAGGED_TT_OVERDUE"]),
});

export type CompleteCheckAndFlagValues = z.input<
  typeof completeCheckAndFlagSchema
>;

// ─── Complete Check and Store (return flow) ─────────────────────────────────

export const completeCheckAndStoreSchema = z.object({
  projectId: z.string().min(1),
  lineItemId: z.string().min(1),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  checks: z.array(checkRecordSchema).min(1),
  condition: z.enum(["GOOD", "DAMAGED", "MISSING"]),
  locationId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type CompleteCheckAndStoreValues = z.input<
  typeof completeCheckAndStoreSchema
>;

// ─── Warehouse Close ────────────────────────────────────────────────────────

export const warehouseCloseSchema = z.object({
  projectId: z.string().min(1, "Project is required"),
});

export type WarehouseCloseFormValues = z.input<typeof warehouseCloseSchema>;

// ─── Reorder Model Check Items ──────────────────────────────────────────────

export const reorderModelCheckItemsSchema = z.object({
  modelId: z.string().min(1),
  orderedCheckItemIds: z
    .array(z.string().min(1))
    .min(1, "At least one item is required"),
});

export type ReorderModelCheckItemsValues = z.input<
  typeof reorderModelCheckItemsSchema
>;
