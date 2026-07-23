import { z } from "zod";

const equipmentClassEnum = z.enum(["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"]);
const applianceTypeEnum = z.enum([
  "APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD",
  "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "MICROWAVE", "OTHER",
]);
const testResultEnum = z.enum(["PASS", "FAIL", "NOT_APPLICABLE"]);

// ─── Test Tag Asset ─────────────────────────────────────────────────────────

export const testTagAssetSchema = z.object({
  testTagId: z.string().min(1, "Test Tag ID is required").max(50),
  description: z.string().min(1, "Description is required").max(500),
  equipmentClass: equipmentClassEnum.default("CLASS_I"),
  applianceType: applianceTypeEnum.default("APPLIANCE"),
  make: z.string().max(200).optional(),
  modelName: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  testIntervalMonths: z.coerce.number().int().min(1).max(120).default(3),
  testProfileId: z.string().optional(),
  outletCount: z.coerce.number().int().min(1).max(50).optional(),
  notes: z.string().max(2000).optional(),
  assetId: z.string().optional(),
  bulkAssetId: z.string().optional(),
});

export type TestTagAssetFormValues = z.input<typeof testTagAssetSchema>;

// ─── Sub-Test Record ────────────────────────────────────────────────────────

export const subTestRecordSchema = z.object({
  label: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  earthContinuityReading: z.coerce.number().min(0).nullable().optional(),
  earthContinuityResult: testResultEnum.default("NOT_APPLICABLE"),
  insulationReading: z.coerce.number().min(0).nullable().optional(),
  insulationResult: testResultEnum.default("NOT_APPLICABLE"),
  leakageCurrentReading: z.coerce.number().min(0).nullable().optional(),
  leakageCurrentResult: testResultEnum.default("NOT_APPLICABLE"),
  polarityResult: testResultEnum.default("NOT_APPLICABLE"),
  result: z.enum(["PASS", "FAIL"]).default("PASS"),
  notes: z.string().max(2000).optional(),
});

export type SubTestRecordFormValues = z.input<typeof subTestRecordSchema>;

// ─── Test Tag Record ────────────────────────────────────────────────────────

export const testTagRecordSchema = z.object({
  testTagAssetId: z.string().min(1, "Test tag asset is required"),
  testProfileId: z.string().optional(),
  testDate: z.coerce.date(),
  testedById: z.string().optional(), // Session tester — defaults to logged-in user on server
  testerName: z.string().min(1, "Tester name is required").max(200),
  result: z.enum(["PASS", "FAIL"]).default("PASS"),

  // Visual inspection
  visualInspectionResult: z.enum(["PASS", "FAIL"]).default("PASS"),
  visualCordCondition: z.boolean().optional(),
  visualPlugCondition: z.boolean().optional(),
  visualHousingCondition: z.boolean().optional(),
  visualSwitchCondition: z.boolean().optional(),
  visualVentsUnobstructed: z.boolean().optional(),
  visualCordGrip: z.boolean().optional(),
  visualEarthPin: z.boolean().optional(),
  visualMarkingsLegible: z.boolean().optional(),
  visualNoModifications: z.boolean().optional(),
  visualNotes: z.string().max(2000).optional(),

  // Electrical tests
  equipmentClassTested: equipmentClassEnum.default("CLASS_I"),
  testMethod: z.enum(["INSULATION_RESISTANCE", "LEAKAGE_CURRENT", "BOTH"]).default("INSULATION_RESISTANCE"),

  earthContinuityResult: testResultEnum.default("NOT_APPLICABLE"),
  earthContinuityReading: z.coerce.number().min(0).optional(),

  insulationResult: testResultEnum.default("NOT_APPLICABLE"),
  insulationReading: z.coerce.number().min(0).optional(),
  insulationTestVoltage: z.coerce.number().int().optional(),

  leakageCurrentResult: testResultEnum.default("NOT_APPLICABLE"),
  leakageCurrentReading: z.coerce.number().min(0).optional(),

  polarityResult: testResultEnum.default("NOT_APPLICABLE"),

  rcdTripTimeResult: testResultEnum.default("NOT_APPLICABLE"),
  rcdTripTimeReading: z.coerce.number().min(0).optional(),

  functionalTestResult: testResultEnum.default("NOT_APPLICABLE"),
  functionalTestNotes: z.string().max(2000).optional(),

  // Failure details
  failureAction: z.enum(["NONE", "REPAIRED", "REMOVED_FROM_SERVICE", "DISPOSED", "REFERRED_TO_ELECTRICIAN"]).default("NONE"),
  failureNotes: z.string().max(2000).optional(),

  // Sub-tests
  subTests: z.array(subTestRecordSchema).optional(),

  // Next due
  nextDueDate: z.coerce.date(),
});

export type TestTagRecordFormValues = z.input<typeof testTagRecordSchema>;

// ─── Batch Create ───────────────────────────────────────────────────────────

// R-8.6.3: derived from `testTagAssetSchema` (`.omit()` + `.extend()`)
// rather than re-declared — shares equipmentClass/applianceType/
// testIntervalMonths/description/make/modelName/location verbatim; drops
// the per-asset-only fields; and overrides `bulkAssetId` (optional on a
// single asset, required for a batch) plus adds the batch-only `count`.
export const batchCreateTestTagSchema = testTagAssetSchema
  .omit({
    testTagId: true,
    serialNumber: true,
    testProfileId: true,
    outletCount: true,
    notes: true,
    assetId: true,
    bulkAssetId: true,
  })
  .extend({
    bulkAssetId: z.string().min(1, "Bulk asset is required"),
    count: z.coerce.number().int().min(1, "Must create at least 1").max(500),
  });

export type BatchCreateTestTagFormValues = z.input<typeof batchCreateTestTagSchema>;

// ─── Test Profile ───────────────────────────────────────────────────────────

const visualCheckSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
});

const electricalTestSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  threshold: z.number().nullable(),
  operator: z.enum(["lt", "lte", "gt", "gte"]).nullable(),
  unit: z.string(),
  enabled: z.boolean(),
});

const thresholdsSchema = z.object({
  earthMax: z.number().optional(),
  insulationMin: z.number().optional(),
  leakageMax: z.number().optional(),
  rcdTripTimeMax: z.number().optional(),
  rcdTripCurrentMin: z.number().optional(),
  rcdTripCurrentMax: z.number().optional(),
  microwaveLeakageMax: z.number().optional(),
});

export const testProfileSchema = z.object({
  name: z.string().min(1, "Profile name is required").max(200),
  equipmentClass: equipmentClassEnum.default("CLASS_I"),
  applianceType: applianceTypeEnum.default("APPLIANCE"),
  visualChecks: z.array(visualCheckSchema).min(1, "At least one visual check is required"),
  electricalTests: z.array(electricalTestSchema),
  thresholds: thresholdsSchema,
  requiresSubTests: z.boolean().default(false),
  defaultSubTestCount: z.coerce.number().int().min(1).max(50).default(1),
  subTestLabel: z.string().min(1).max(50).default("Outlet"),
  isActive: z.boolean().default(true),
});

export type TestProfileFormValues = z.input<typeof testProfileSchema>;
