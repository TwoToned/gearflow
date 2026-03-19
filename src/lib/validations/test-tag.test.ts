import { describe, it, expect } from "vitest";
import {
  testTagAssetSchema,
  testTagRecordSchema,
  batchCreateTestTagSchema,
} from "./test-tag";

// ---------------------------------------------------------------------------
// testTagAssetSchema
// ---------------------------------------------------------------------------
describe("testTagAssetSchema", () => {
  const validMinimal = {
    testTagId: "TT-001",
    description: "Power cable test tag",
  };

  const validComplete = {
    testTagId: "TT-001",
    description: "Power cable test tag",
    equipmentClass: "CLASS_II" as const,
    applianceType: "CORD_SET" as const,
    make: "Acme",
    modelName: "X200",
    serialNumber: "SN-12345",
    location: "Warehouse A",
    testIntervalMonths: 12,
    notes: "Handle with care",
    assetId: "asset-abc",
    bulkAssetId: "bulk-xyz",
  };

  it("accepts valid minimal data", () => {
    const result = testTagAssetSchema.safeParse(validMinimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = testTagAssetSchema.safeParse(validComplete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equipmentClass).toBe("CLASS_II");
      expect(result.data.applianceType).toBe("CORD_SET");
      expect(result.data.testIntervalMonths).toBe(12);
    }
  });

  // --- defaults ---
  it("applies default equipmentClass CLASS_I", () => {
    const result = testTagAssetSchema.parse(validMinimal);
    expect(result.equipmentClass).toBe("CLASS_I");
  });

  it("applies default applianceType APPLIANCE", () => {
    const result = testTagAssetSchema.parse(validMinimal);
    expect(result.applianceType).toBe("APPLIANCE");
  });

  it("applies default testIntervalMonths 3", () => {
    const result = testTagAssetSchema.parse(validMinimal);
    expect(result.testIntervalMonths).toBe(3);
  });

  // --- required fields ---
  it("rejects missing testTagId", () => {
    const result = testTagAssetSchema.safeParse({ description: "desc" });
    expect(result.success).toBe(false);
  });

  it("rejects empty testTagId", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testTagId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const result = testTagAssetSchema.safeParse({ testTagId: "TT-001" });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, description: "" });
    expect(result.success).toBe(false);
  });

  // --- max length ---
  it("rejects testTagId longer than 50 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testTagId: "x".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("accepts testTagId at exactly 50 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testTagId: "x".repeat(50) });
    expect(result.success).toBe(true);
  });

  it("rejects description longer than 500 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, description: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 500 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, description: "x".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("rejects make longer than 200 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, make: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects modelName longer than 200 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, modelName: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects serialNumber longer than 200 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, serialNumber: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects location longer than 200 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, location: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects notes longer than 2000 chars", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, notes: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid equipmentClass", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, equipmentClass: "CLASS_III" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid applianceType", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, applianceType: "LAMP" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid equipmentClass values", () => {
    for (const val of ["CLASS_I", "CLASS_II", "CLASS_II_DOUBLE_INSULATED", "LEAD_CORD_ASSEMBLY"]) {
      const result = testTagAssetSchema.safeParse({ ...validMinimal, equipmentClass: val });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid applianceType values", () => {
    for (const val of ["APPLIANCE", "CORD_SET", "EXTENSION_LEAD", "POWER_BOARD", "RCD_PORTABLE", "RCD_FIXED", "THREE_PHASE", "OTHER"]) {
      const result = testTagAssetSchema.safeParse({ ...validMinimal, applianceType: val });
      expect(result.success).toBe(true);
    }
  });

  // --- testIntervalMonths boundaries ---
  it("rejects testIntervalMonths less than 1", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testIntervalMonths: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects testIntervalMonths greater than 120", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testIntervalMonths: 121 });
    expect(result.success).toBe(false);
  });

  it("accepts testIntervalMonths at boundary 1", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testIntervalMonths: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts testIntervalMonths at boundary 120", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testIntervalMonths: 120 });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer testIntervalMonths", () => {
    const result = testTagAssetSchema.safeParse({ ...validMinimal, testIntervalMonths: 2.5 });
    expect(result.success).toBe(false);
  });

  it("coerces string testIntervalMonths to number", () => {
    const result = testTagAssetSchema.parse({ ...validMinimal, testIntervalMonths: "6" });
    expect(result.testIntervalMonths).toBe(6);
  });

  // --- optional fields ---
  it("allows omitting all optional fields", () => {
    const result = testTagAssetSchema.safeParse(validMinimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.make).toBeUndefined();
      expect(result.data.modelName).toBeUndefined();
      expect(result.data.serialNumber).toBeUndefined();
      expect(result.data.location).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
      expect(result.data.assetId).toBeUndefined();
      expect(result.data.bulkAssetId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// testTagRecordSchema
// ---------------------------------------------------------------------------
describe("testTagRecordSchema", () => {
  const validMinimal = {
    testTagAssetId: "tta-123",
    testDate: "2024-06-15",
    testerName: "John Doe",
    nextDueDate: "2024-09-15",
  };

  const validComplete = {
    ...validMinimal,
    result: "FAIL" as const,
    visualInspectionResult: "FAIL" as const,
    visualCordCondition: true,
    visualPlugCondition: false,
    visualHousingCondition: true,
    visualSwitchCondition: true,
    visualVentsUnobstructed: true,
    visualCordGrip: false,
    visualEarthPin: true,
    visualMarkingsLegible: true,
    visualNoModifications: true,
    visualNotes: "Cord frayed near plug",
    equipmentClassTested: "CLASS_II" as const,
    testMethod: "BOTH" as const,
    earthContinuityResult: "PASS" as const,
    earthContinuityReading: 0.15,
    insulationResult: "PASS" as const,
    insulationReading: 200,
    insulationTestVoltage: 500,
    leakageCurrentResult: "NOT_APPLICABLE" as const,
    leakageCurrentReading: 0.5,
    polarityResult: "PASS" as const,
    rcdTripTimeResult: "PASS" as const,
    rcdTripTimeReading: 25,
    functionalTestResult: "PASS" as const,
    functionalTestNotes: "All functions OK",
    failureAction: "REPAIRED" as const,
    failureNotes: "Replaced cord",
  };

  it("accepts valid minimal data", () => {
    const result = testTagRecordSchema.safeParse(validMinimal);
    expect(result.success).toBe(true);
  });

  it("accepts valid complete data", () => {
    const result = testTagRecordSchema.safeParse(validComplete);
    expect(result.success).toBe(true);
  });

  // --- defaults ---
  it("applies default result PASS", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.result).toBe("PASS");
  });

  it("applies default visualInspectionResult PASS", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.visualInspectionResult).toBe("PASS");
  });

  it("applies default equipmentClassTested CLASS_I", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.equipmentClassTested).toBe("CLASS_I");
  });

  it("applies default testMethod INSULATION_RESISTANCE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.testMethod).toBe("INSULATION_RESISTANCE");
  });

  it("applies default earthContinuityResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.earthContinuityResult).toBe("NOT_APPLICABLE");
  });

  it("applies default insulationResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.insulationResult).toBe("NOT_APPLICABLE");
  });

  it("applies default leakageCurrentResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.leakageCurrentResult).toBe("NOT_APPLICABLE");
  });

  it("applies default polarityResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.polarityResult).toBe("NOT_APPLICABLE");
  });

  it("applies default rcdTripTimeResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.rcdTripTimeResult).toBe("NOT_APPLICABLE");
  });

  it("applies default functionalTestResult NOT_APPLICABLE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.functionalTestResult).toBe("NOT_APPLICABLE");
  });

  it("applies default failureAction NONE", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.failureAction).toBe("NONE");
  });

  // --- required fields ---
  it("rejects missing testTagAssetId", () => {
    const { testTagAssetId: _, ...data } = validMinimal;
    expect(testTagRecordSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty testTagAssetId", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, testTagAssetId: "" }).success).toBe(false);
  });

  it("rejects missing testDate", () => {
    const { testDate: _, ...data } = validMinimal;
    expect(testTagRecordSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing testerName", () => {
    const { testerName: _, ...data } = validMinimal;
    expect(testTagRecordSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty testerName", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, testerName: "" }).success).toBe(false);
  });

  it("rejects missing nextDueDate", () => {
    const { nextDueDate: _, ...data } = validMinimal;
    expect(testTagRecordSchema.safeParse(data).success).toBe(false);
  });

  // --- max length ---
  it("rejects testerName longer than 200 chars", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, testerName: "x".repeat(201) }).success).toBe(false);
  });

  it("accepts testerName at exactly 200 chars", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, testerName: "x".repeat(200) }).success).toBe(true);
  });

  it("rejects visualNotes longer than 2000 chars", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, visualNotes: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects functionalTestNotes longer than 2000 chars", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, functionalTestNotes: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects failureNotes longer than 2000 chars", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, failureNotes: "x".repeat(2001) }).success).toBe(false);
  });

  // --- date coercion ---
  it("coerces string testDate to Date", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.testDate).toBeInstanceOf(Date);
  });

  it("coerces string nextDueDate to Date", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.nextDueDate).toBeInstanceOf(Date);
  });

  it("accepts Date object for testDate", () => {
    const result = testTagRecordSchema.safeParse({ ...validMinimal, testDate: new Date("2024-06-15") });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date string for testDate", () => {
    const result = testTagRecordSchema.safeParse({ ...validMinimal, testDate: "not-a-date" });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid result enum", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, result: "MAYBE" }).success).toBe(false);
  });

  it("rejects invalid testMethod enum", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, testMethod: "VISUAL_ONLY" }).success).toBe(false);
  });

  it("rejects invalid failureAction enum", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, failureAction: "DESTROYED" }).success).toBe(false);
  });

  it("accepts all valid failureAction values", () => {
    for (const val of ["NONE", "REPAIRED", "REMOVED_FROM_SERVICE", "DISPOSED", "REFERRED_TO_ELECTRICIAN"]) {
      expect(testTagRecordSchema.safeParse({ ...validMinimal, failureAction: val }).success).toBe(true);
    }
  });

  it("accepts all valid testMethod values", () => {
    for (const val of ["INSULATION_RESISTANCE", "LEAKAGE_CURRENT", "BOTH"]) {
      expect(testTagRecordSchema.safeParse({ ...validMinimal, testMethod: val }).success).toBe(true);
    }
  });

  // --- numeric coercion and constraints ---
  it("coerces string earthContinuityReading to number", () => {
    const parsed = testTagRecordSchema.parse({ ...validMinimal, earthContinuityReading: "0.3" });
    expect(parsed.earthContinuityReading).toBe(0.3);
  });

  it("rejects negative earthContinuityReading", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, earthContinuityReading: -1 }).success).toBe(false);
  });

  it("rejects negative insulationReading", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, insulationReading: -0.1 }).success).toBe(false);
  });

  it("rejects negative leakageCurrentReading", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, leakageCurrentReading: -5 }).success).toBe(false);
  });

  it("rejects negative rcdTripTimeReading", () => {
    expect(testTagRecordSchema.safeParse({ ...validMinimal, rcdTripTimeReading: -1 }).success).toBe(false);
  });

  it("accepts zero for earthContinuityReading", () => {
    const parsed = testTagRecordSchema.parse({ ...validMinimal, earthContinuityReading: 0 });
    expect(parsed.earthContinuityReading).toBe(0);
  });

  it("accepts zero for insulationReading", () => {
    const parsed = testTagRecordSchema.parse({ ...validMinimal, insulationReading: 0 });
    expect(parsed.insulationReading).toBe(0);
  });

  // --- boolean optional fields ---
  it("allows omitting all boolean visual fields", () => {
    const parsed = testTagRecordSchema.parse(validMinimal);
    expect(parsed.visualCordCondition).toBeUndefined();
    expect(parsed.visualPlugCondition).toBeUndefined();
    expect(parsed.visualHousingCondition).toBeUndefined();
    expect(parsed.visualSwitchCondition).toBeUndefined();
    expect(parsed.visualVentsUnobstructed).toBeUndefined();
    expect(parsed.visualCordGrip).toBeUndefined();
    expect(parsed.visualEarthPin).toBeUndefined();
    expect(parsed.visualMarkingsLegible).toBeUndefined();
    expect(parsed.visualNoModifications).toBeUndefined();
  });

  it("accepts boolean visual fields as true/false", () => {
    const result = testTagRecordSchema.safeParse({
      ...validMinimal,
      visualCordCondition: true,
      visualPlugCondition: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visualCordCondition).toBe(true);
      expect(result.data.visualPlugCondition).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// batchCreateTestTagSchema
// ---------------------------------------------------------------------------
describe("batchCreateTestTagSchema", () => {
  const validMinimal = {
    bulkAssetId: "bulk-abc",
    count: 10,
    description: "Batch power cords",
  };

  const validComplete = {
    bulkAssetId: "bulk-abc",
    count: 50,
    equipmentClass: "LEAD_CORD_ASSEMBLY" as const,
    applianceType: "EXTENSION_LEAD" as const,
    testIntervalMonths: 6,
    description: "Extension leads batch",
    make: "Acme",
    modelName: "EL-100",
    location: "Site B",
  };

  it("accepts valid minimal data", () => {
    expect(batchCreateTestTagSchema.safeParse(validMinimal).success).toBe(true);
  });

  it("accepts valid complete data", () => {
    expect(batchCreateTestTagSchema.safeParse(validComplete).success).toBe(true);
  });

  // --- defaults ---
  it("applies default equipmentClass CLASS_I", () => {
    const parsed = batchCreateTestTagSchema.parse(validMinimal);
    expect(parsed.equipmentClass).toBe("CLASS_I");
  });

  it("applies default applianceType APPLIANCE", () => {
    const parsed = batchCreateTestTagSchema.parse(validMinimal);
    expect(parsed.applianceType).toBe("APPLIANCE");
  });

  it("applies default testIntervalMonths 3", () => {
    const parsed = batchCreateTestTagSchema.parse(validMinimal);
    expect(parsed.testIntervalMonths).toBe(3);
  });

  // --- required fields ---
  it("rejects missing bulkAssetId", () => {
    const { bulkAssetId: _, ...data } = validMinimal;
    expect(batchCreateTestTagSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty bulkAssetId", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, bulkAssetId: "" }).success).toBe(false);
  });

  it("rejects missing count", () => {
    const { count: _, ...data } = validMinimal;
    expect(batchCreateTestTagSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _, ...data } = validMinimal;
    expect(batchCreateTestTagSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, description: "" }).success).toBe(false);
  });

  // --- count boundaries ---
  it("rejects count less than 1", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, count: 0 }).success).toBe(false);
  });

  it("rejects count greater than 500", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, count: 501 }).success).toBe(false);
  });

  it("accepts count at boundary 1", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, count: 1 }).success).toBe(true);
  });

  it("accepts count at boundary 500", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, count: 500 }).success).toBe(true);
  });

  it("rejects non-integer count", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, count: 2.7 }).success).toBe(false);
  });

  it("coerces string count to number", () => {
    const parsed = batchCreateTestTagSchema.parse({ ...validMinimal, count: "25" });
    expect(parsed.count).toBe(25);
  });

  // --- max length ---
  it("rejects description longer than 500 chars", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, description: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects make longer than 200 chars", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, make: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects modelName longer than 200 chars", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, modelName: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects location longer than 200 chars", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, location: "x".repeat(201) }).success).toBe(false);
  });

  // --- testIntervalMonths boundaries ---
  it("rejects testIntervalMonths less than 1", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, testIntervalMonths: 0 }).success).toBe(false);
  });

  it("rejects testIntervalMonths greater than 120", () => {
    expect(batchCreateTestTagSchema.safeParse({ ...validMinimal, testIntervalMonths: 121 }).success).toBe(false);
  });

  it("coerces string testIntervalMonths to number", () => {
    const parsed = batchCreateTestTagSchema.parse({ ...validMinimal, testIntervalMonths: "12" });
    expect(parsed.testIntervalMonths).toBe(12);
  });

  // --- optional fields ---
  it("allows omitting optional fields", () => {
    const parsed = batchCreateTestTagSchema.parse(validMinimal);
    expect(parsed.make).toBeUndefined();
    expect(parsed.modelName).toBeUndefined();
    expect(parsed.location).toBeUndefined();
  });
});
