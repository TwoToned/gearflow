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

// ─── Complete-check completion actions (Pack / Flag / Store) ────────────────
// Pack/Flag/Store are 3 distinct terminal actions on the same PREP/RETURN check
// flow; `projectId`/`lineItemId`/`assetId`/`bulkAssetId`/`checks` were previously
// re-declared verbatim in all three (R-8.6.3 — DRY schema variants). Each variant
// now `.pick()`s its fields from one base object instead of retyping the shared
// validators three times.
const checkCompletionFieldsSchema = z.object({
  projectId: z.string().min(1),
  lineItemId: z.string().min(1),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
  checks: z.array(checkRecordSchema).min(1),
  // Accessory identities to pack with this unit (serialised assetId / bulk
  // bulkAssetId). Undefined = all; the prep picker passes the ticked set so an
  // operator can leave an accessory off this handheld even on a checked prep.
  prepContainer: z.string().nullish(),
  includeAccessoryIds: z.array(z.string()).optional(),
  flagType: z.enum(["FLAGGED_FAULTY", "FLAGGED_TT_OVERDUE"]),
  condition: z.enum(["GOOD", "DAMAGED", "MISSING"]),
  locationId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

// ─── Complete Check and Pack (prep flow) ────────────────────────────────────

export const completeCheckAndPackSchema = checkCompletionFieldsSchema.pick({
  projectId: true,
  lineItemId: true,
  assetId: true,
  bulkAssetId: true,
  prepContainer: true,
  checks: true,
  includeAccessoryIds: true,
});

export type CompleteCheckAndPackValues = z.input<
  typeof completeCheckAndPackSchema
>;

// ─── Complete Check and Flag (prep flow — faulty/TT overdue) ────────────────

export const completeCheckAndFlagSchema = checkCompletionFieldsSchema.pick({
  projectId: true,
  lineItemId: true,
  assetId: true,
  bulkAssetId: true,
  checks: true,
  flagType: true,
});

export type CompleteCheckAndFlagValues = z.input<
  typeof completeCheckAndFlagSchema
>;

// ─── Complete Check and Store (return flow) ─────────────────────────────────

export const completeCheckAndStoreSchema = checkCompletionFieldsSchema.pick({
  projectId: true,
  lineItemId: true,
  assetId: true,
  bulkAssetId: true,
  checks: true,
  condition: true,
  locationId: true,
  notes: true,
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
