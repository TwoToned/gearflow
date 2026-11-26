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

export function testTagSheetInitialOf(s: TestTagSheetSource): TestTagSheetInitial {
  return {
    id: s.id,
    testTagId: s.testTagId,
    description: s.description,
    equipmentClass: s.equipmentClass ?? "CLASS_I",
    applianceType: s.applianceType ?? "APPLIANCE",
    make: s.make ?? "",
    modelName: s.modelName ?? "",
    serialNumber: s.serialNumber ?? "",
    location: s.location ?? "",
    testIntervalMonths: String(s.testIntervalMonths ?? 3),
    testProfileId: s.testProfileId ?? "",
    outletCount: s.outletCount == null ? "" : String(s.outletCount),
    notes: s.notes ?? "",
    assetId: s.assetId ?? "",
    bulkAssetId: s.bulkAssetId ?? "",
  };
}

/** The one message that says what to fix, or `null` when the values are saveable (the server mirrors these bounds). */
export function testTagSheetError(v: TestTagSheetValues): string | null {
  if (!v.description.trim()) return "An item needs a description.";
  if (v.description.length > 500) return "The description can be at most 500 characters.";
  const interval = Number(v.testIntervalMonths);
  if (!Number.isInteger(interval) || interval < 1 || interval > 120) return "The test interval must be a whole number of months, 1 to 120.";
  if (v.outletCount.trim() !== "") {
    const n = Number(v.outletCount);
    if (!Number.isInteger(n) || n < 1 || n > 50) return "Outlets must be a whole number, 1 to 50.";
  }
  if (v.notes.length > 2000) return "Notes can be at most 2000 characters.";
  if (v.assetId && v.bulkAssetId) return "Link one asset or one bulk asset, not both.";
  return null;
}

export interface TestTagEditInput {
  set: Record<string, unknown>;
  clear: string[];
}

const CLEARABLE_TEXT = ["make", "modelName", "serialNumber", "location", "notes", "testProfileId", "assetId", "bulkAssetId"] as const;

/** The edit write's input: every filled field is SET, every blank clearable field is CLEARED. Status is never in it. */
export function buildTestTagEdit(v: TestTagSheetValues): TestTagEditInput {
  const set: Record<string, unknown> = {
    description: v.description.trim(),
    equipmentClass: v.equipmentClass,
    applianceType: v.applianceType,
    testIntervalMonths: Number(v.testIntervalMonths),
  };
  const clear: string[] = [];
  for (const f of CLEARABLE_TEXT) {
    const value = v[f].trim();
    if (value) set[f] = value;
    else clear.push(f);
  }
  if (v.outletCount.trim() === "") clear.push("outletCount");
  else set.outletCount = Number(v.outletCount);
  return { set, clear };
}
