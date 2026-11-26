import { blankToUndefined, changedEdit } from "@/lib/changed-edit";

/**
 * The Test & tag Edit sheet's values and the write they become (UX Phase 14, 14b-4, D80). Pure, so the sheet and its
 * tests share ONE mapping. The sheet carries every field `testTagEditWrites.editNative` sets and NOTHING else: status
 * moves only through a test, Retire and Reactivate; the tag id is not editable; next due is derived (last test +
 * interval), so changing the interval is the only way it moves. A blank box CLEARS its optional field.
 */
export interface TestTagSheetValues {
  description: string;
  equipmentClass: string;
  applianceType: string;
  make: string;
  modelName: string;
  serialNumber: string;
  location: string;
  /** As typed. Required: an item always has an interval. */
  testIntervalMonths: string;
  testProfileId: string;
  /** As typed ("" = not set). */
  outletCount: string;
  notes: string;
  /** One link at a time: a serialised asset OR a bulk asset. */
  assetId: string;
  bulkAssetId: string;
}

/** The item as `testTagAssets.detail` returns it. */
export interface TestTagSheetSource {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass?: string | null;
  applianceType?: string | null;
  make?: string | null;
  modelName?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  testIntervalMonths?: number | null;
  testProfileId?: string | null;
  outletCount?: number | null;
  notes?: string | null;
  assetId?: string | null;
  bulkAssetId?: string | null;
}

export interface TestTagSheetInitial extends TestTagSheetValues {
  id: string;
  testTagId: string;
}

const text = (v: string | null | undefined): string => v ?? "";
const numText = (v: number | null | undefined, fallback = ""): string => (v == null ? fallback : String(v));

export function testTagSheetInitialOf(s: TestTagSheetSource): TestTagSheetInitial {
  return {
    id: s.id,
    testTagId: s.testTagId,
    description: s.description,
    equipmentClass: s.equipmentClass || "CLASS_I",
    applianceType: s.applianceType || "APPLIANCE",
    make: text(s.make),
    modelName: text(s.modelName),
    serialNumber: text(s.serialNumber),
    location: text(s.location),
    testIntervalMonths: numText(s.testIntervalMonths, "3"),
    testProfileId: text(s.testProfileId),
    outletCount: numText(s.outletCount),
    notes: text(s.notes),
    assetId: text(s.assetId),
    bulkAssetId: text(s.bulkAssetId),
  };
}

const wholeIn = (text: string, min: number, max: number): boolean => {
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max;
};

/** The one message that says what to fix, or `null` when the values are saveable (the server mirrors these bounds). */
export function testTagSheetError(v: TestTagSheetValues): string | null {
  if (!v.description.trim()) return "An item needs a description.";
  if (v.description.length > 500) return "The description can be at most 500 characters.";
  if (!wholeIn(v.testIntervalMonths, 1, 120)) return "The test interval must be a whole number of months, 1 to 120.";
  if (v.outletCount.trim() !== "" && !wholeIn(v.outletCount, 1, 50)) return "Outlets must be a whole number, 1 to 50.";
  if (v.notes.length > 2000) return "Notes can be at most 2000 characters.";
  if (v.assetId && v.bulkAssetId) return "Link one asset or one bulk asset, not both.";
  return null;
}

export interface TestTagEditInput {
  set: Record<string, unknown>;
  clear: string[];
}

const CLEARABLE_TEXT = ["make", "modelName", "serialNumber", "location", "notes", "testProfileId", "assetId", "bulkAssetId"] as const;
const outlets = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));

/**
 * The edit write's input: ONLY the fields changed against the values the sheet opened with (`before`), so another user's
 * edit made since is never reverted. A changed blank optional box CLEARS its field. Status is never in it.
 */
export function buildTestTagEdit(v: TestTagSheetValues, before: TestTagSheetValues): TestTagEditInput {
  return changedEdit([
    ["description", v.description.trim(), before.description.trim()],
    ["equipmentClass", v.equipmentClass, before.equipmentClass],
    ["applianceType", v.applianceType, before.applianceType],
    ["testIntervalMonths", Number(v.testIntervalMonths), Number(before.testIntervalMonths)],
    ...CLEARABLE_TEXT.map((f) => [f, blankToUndefined(v[f]), blankToUndefined(before[f])] as const),
    ["outletCount", outlets(v.outletCount), outlets(before.outletCount)],
  ]);
}
