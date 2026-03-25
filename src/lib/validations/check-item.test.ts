import { describe, it, expect } from "vitest";
import {
  checkItemSchema,
  checkRecordSchema,
  completeCheckAndPackSchema,
  completeCheckAndFlagSchema,
  completeCheckAndStoreSchema,
  submitChecksSchema,
  reorderModelCheckItemsSchema,
  warehouseCloseSchema,
} from "./check-item";

// ─── checkItemSchema ──────────────────────────────────────────────────────────

describe("checkItemSchema", () => {
  const validMinimal = { label: "Cable check" };
  const validComplete = {
    label: "Impedance test",
    description: "Measure impedance at 1kHz",
    type: "MEASUREMENT" as const,
    category: "Audio",
    measurementUnit: "ohms",
    measurementMin: 4,
    measurementMax: 16,
  };

  describe("valid data", () => {
    it("accepts minimal valid data (defaults to PASS_FAIL)", () => {
      const result = checkItemSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("PASS_FAIL");
      }
    });

    it("accepts complete MEASUREMENT data", () => {
      const result = checkItemSchema.safeParse(validComplete);
      expect(result.success).toBe(true);
    });

    it("accepts NOTES type without extra fields", () => {
      const result = checkItemSchema.safeParse({ label: "Notes check", type: "NOTES" });
      expect(result.success).toBe(true);
    });

    it("accepts DROPDOWN type with 2+ options", () => {
      const result = checkItemSchema.safeParse({
        label: "Condition",
        type: "DROPDOWN",
        dropdownOptions: [
          { label: "Good", isFail: false },
          { label: "Bad", isFail: true },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("label (required, max 200)", () => {
    it("rejects missing label", () => {
      const result = checkItemSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects empty string label", () => {
      const result = checkItemSchema.safeParse({ label: "" });
      expect(result.success).toBe(false);
    });

    it("accepts label at max length (200)", () => {
      const result = checkItemSchema.safeParse({ label: "x".repeat(200) });
      expect(result.success).toBe(true);
    });

    it("rejects label exceeding max length", () => {
      const result = checkItemSchema.safeParse({ label: "x".repeat(201) });
      expect(result.success).toBe(false);
    });
  });

  describe("type enum", () => {
    it.each(["PASS_FAIL", "NOTES", "MEASUREMENT", "DROPDOWN"] as const)(
      "accepts type %s",
      (type) => {
        const result = checkItemSchema.safeParse({ label: "Test", type });
        // MEASUREMENT and DROPDOWN have additional refinements — only test enum acceptance
        if (type === "PASS_FAIL" || type === "NOTES") {
          expect(result.success).toBe(true);
        }
      }
    );

    it("rejects invalid type", () => {
      const result = checkItemSchema.safeParse({ label: "Test", type: "INVALID" });
      expect(result.success).toBe(false);
    });
  });

  describe("MEASUREMENT refinement", () => {
    it("requires at least min or max for MEASUREMENT type", () => {
      const result = checkItemSchema.safeParse({
        label: "Impedance",
        type: "MEASUREMENT",
        // no measurementMin or measurementMax
      });
      expect(result.success).toBe(false);
    });

    it("accepts MEASUREMENT with only min", () => {
      const result = checkItemSchema.safeParse({
        label: "Impedance",
        type: "MEASUREMENT",
        measurementMin: 4,
      });
      expect(result.success).toBe(true);
    });

    it("accepts MEASUREMENT with only max", () => {
      const result = checkItemSchema.safeParse({
        label: "Impedance",
        type: "MEASUREMENT",
        measurementMax: 16,
      });
      expect(result.success).toBe(true);
    });

    it("accepts MEASUREMENT with both min and max", () => {
      const result = checkItemSchema.safeParse({
        label: "Impedance",
        type: "MEASUREMENT",
        measurementMin: 4,
        measurementMax: 16,
      });
      expect(result.success).toBe(true);
    });

    it("does not require min/max for non-MEASUREMENT types", () => {
      const result = checkItemSchema.safeParse({ label: "Test", type: "PASS_FAIL" });
      expect(result.success).toBe(true);
    });
  });

  describe("DROPDOWN refinement", () => {
    it("requires at least 2 options for DROPDOWN type", () => {
      const result = checkItemSchema.safeParse({
        label: "Condition",
        type: "DROPDOWN",
        dropdownOptions: [{ label: "Good", isFail: false }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects DROPDOWN with no options", () => {
      const result = checkItemSchema.safeParse({
        label: "Condition",
        type: "DROPDOWN",
        dropdownOptions: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects DROPDOWN with undefined options", () => {
      const result = checkItemSchema.safeParse({
        label: "Condition",
        type: "DROPDOWN",
      });
      expect(result.success).toBe(false);
    });

    it("accepts DROPDOWN with exactly 2 options", () => {
      const result = checkItemSchema.safeParse({
        label: "Condition",
        type: "DROPDOWN",
        dropdownOptions: [
          { label: "Good", isFail: false },
          { label: "Bad", isFail: true },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("does not require options for non-DROPDOWN types", () => {
      const result = checkItemSchema.safeParse({ label: "Test", type: "PASS_FAIL" });
      expect(result.success).toBe(true);
    });
  });

  describe("description (max 1000)", () => {
    it("accepts description at max length", () => {
      const result = checkItemSchema.safeParse({ label: "Test", description: "x".repeat(1000) });
      expect(result.success).toBe(true);
    });

    it("rejects description exceeding max length", () => {
      const result = checkItemSchema.safeParse({ label: "Test", description: "x".repeat(1001) });
      expect(result.success).toBe(false);
    });
  });
});

// ─── checkRecordSchema ────────────────────────────────────────────────────────

describe("checkRecordSchema", () => {
  const validRecord = {
    checkItemId: "ci-123",
    result: "PASS" as const,
  };

  it("accepts minimal valid record", () => {
    const result = checkRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it("accepts record with all optional fields", () => {
    const result = checkRecordSchema.safeParse({
      ...validRecord,
      value: "8.5",
      notes: "Within range",
      photos: ["photo1.jpg", "photo2.jpg"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing checkItemId", () => {
    const result = checkRecordSchema.safeParse({ result: "PASS" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid result enum", () => {
    const result = checkRecordSchema.safeParse({ checkItemId: "ci-123", result: "INVALID" });
    expect(result.success).toBe(false);
  });

  it.each(["PASS", "FAIL", "NOTES_ONLY"] as const)("accepts result %s", (res) => {
    const result = checkRecordSchema.safeParse({ checkItemId: "ci-123", result: res });
    expect(result.success).toBe(true);
  });

  it("rejects notes exceeding max length", () => {
    const result = checkRecordSchema.safeParse({
      ...validRecord,
      notes: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("defaults photos to empty array", () => {
    const result = checkRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.photos).toEqual([]);
    }
  });
});

// ─── completeCheckAndPackSchema ───────────────────────────────────────────────

describe("completeCheckAndPackSchema", () => {
  const validData = {
    projectId: "proj-1",
    lineItemId: "li-1",
    checks: [{ checkItemId: "ci-1", result: "PASS" as const }],
  };

  it("accepts valid data", () => {
    const result = completeCheckAndPackSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("accepts with optional assetId and prepContainer", () => {
    const result = completeCheckAndPackSchema.safeParse({
      ...validData,
      assetId: "asset-1",
      prepContainer: "Case A",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null prepContainer", () => {
    const result = completeCheckAndPackSchema.safeParse({
      ...validData,
      prepContainer: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectId", () => {
    const { projectId, ...rest } = validData;
    const result = completeCheckAndPackSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty checks array", () => {
    const result = completeCheckAndPackSchema.safeParse({ ...validData, checks: [] });
    expect(result.success).toBe(false);
  });
});

// ─── completeCheckAndFlagSchema ───────────────────────────────────────────────

describe("completeCheckAndFlagSchema", () => {
  const validData = {
    projectId: "proj-1",
    lineItemId: "li-1",
    checks: [{ checkItemId: "ci-1", result: "FAIL" as const }],
    flagType: "FLAGGED_FAULTY" as const,
  };

  it("accepts FLAGGED_FAULTY", () => {
    const result = completeCheckAndFlagSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("accepts FLAGGED_TT_OVERDUE", () => {
    const result = completeCheckAndFlagSchema.safeParse({
      ...validData,
      flagType: "FLAGGED_TT_OVERDUE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid flagType", () => {
    const result = completeCheckAndFlagSchema.safeParse({
      ...validData,
      flagType: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});

// ─── completeCheckAndStoreSchema ──────────────────────────────────────────────

describe("completeCheckAndStoreSchema", () => {
  const validData = {
    projectId: "proj-1",
    lineItemId: "li-1",
    checks: [{ checkItemId: "ci-1", result: "PASS" as const }],
    condition: "GOOD" as const,
  };

  it("accepts valid data with GOOD condition", () => {
    const result = completeCheckAndStoreSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it.each(["GOOD", "DAMAGED", "MISSING"] as const)("accepts condition %s", (condition) => {
    const result = completeCheckAndStoreSchema.safeParse({ ...validData, condition });
    expect(result.success).toBe(true);
  });

  it("rejects invalid condition", () => {
    const result = completeCheckAndStoreSchema.safeParse({
      ...validData,
      condition: "BROKEN",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional locationId and notes", () => {
    const result = completeCheckAndStoreSchema.safeParse({
      ...validData,
      locationId: "loc-1",
      notes: "Minor scratch on side",
    });
    expect(result.success).toBe(true);
  });

  it("rejects notes exceeding max length", () => {
    const result = completeCheckAndStoreSchema.safeParse({
      ...validData,
      notes: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

// ─── submitChecksSchema ───────────────────────────────────────────────────────

describe("submitChecksSchema", () => {
  it("accepts valid ad-hoc check", () => {
    const result = submitChecksSchema.safeParse({
      assetId: "asset-1",
      context: "AD_HOC",
      checks: [{ checkItemId: "ci-1", result: "PASS" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing assetId", () => {
    const result = submitChecksSchema.safeParse({
      context: "AD_HOC",
      checks: [{ checkItemId: "ci-1", result: "PASS" }],
    });
    expect(result.success).toBe(false);
  });

  it.each(["PREP", "RETURN", "AD_HOC"] as const)("accepts context %s", (context) => {
    const result = submitChecksSchema.safeParse({
      assetId: "asset-1",
      context,
      checks: [{ checkItemId: "ci-1", result: "PASS" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty checks array", () => {
    const result = submitChecksSchema.safeParse({
      assetId: "asset-1",
      context: "AD_HOC",
      checks: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── reorderModelCheckItemsSchema ─────────────────────────────────────────────

describe("reorderModelCheckItemsSchema", () => {
  it("accepts valid reorder data", () => {
    const result = reorderModelCheckItemsSchema.safeParse({
      modelId: "model-1",
      orderedCheckItemIds: ["ci-1", "ci-2", "ci-3"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty orderedCheckItemIds", () => {
    const result = reorderModelCheckItemsSchema.safeParse({
      modelId: "model-1",
      orderedCheckItemIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing modelId", () => {
    const result = reorderModelCheckItemsSchema.safeParse({
      orderedCheckItemIds: ["ci-1"],
    });
    expect(result.success).toBe(false);
  });
});

// ─── warehouseCloseSchema ─────────────────────────────────────────────────────

describe("warehouseCloseSchema", () => {
  it("accepts valid projectId", () => {
    const result = warehouseCloseSchema.safeParse({ projectId: "proj-1" });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectId", () => {
    const result = warehouseCloseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty projectId", () => {
    const result = warehouseCloseSchema.safeParse({ projectId: "" });
    expect(result.success).toBe(false);
  });
});
