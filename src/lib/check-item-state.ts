/**
 * The pure state of one item checklist (a model's or a kit's check items), shared by
 * the warehouse check sheet (`ItemCheckForm`) and the Scan page's inline Check form
 * (Phase 16, spec §9i.2). Both render the same rows through `CheckItemFields`; these
 * rules decide when a checklist is complete, what it submits and, for the Scan page's
 * disabled primary, the reason in plain words.
 *
 * A FAIL must carry a reason and at least one photo (#898): a genuine failure opens a
 * maintenance record, so it needs enough detail to act on.
 */
import type { CheckRecordFormValues } from "@/lib/validations/check-item";

export type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";
export type CheckResult = "PASS" | "FAIL" | "NOTES_ONLY";

/** One assignment row as `modelCheckItems.assignmentsForModel` / `kitCheckItems.assignmentsForKit` return it. */
export interface CheckItemData {
  id: string;
  checkItem: {
    id: string;
    label: string;
    description: string | null;
    type: CheckItemType;
    category: string | null;
    measurementUnit: string | null;
    measurementMin: number | null;
    measurementMax: number | null;
    dropdownOptions: Array<{ label: string; isFail: boolean }> | null;
  };
  sortOrder: number;
}

export interface CheckState {
  result: CheckResult | null;
  value: string;
  notes: string;
  photos: string[];
}

export type CheckStates = Record<string, CheckState>;

const BLANK: CheckState = { result: null, value: "", notes: "", photos: [] };

/** Every item unanswered. */
export function initialCheckStates(items: CheckItemData[]): CheckStates {
  return Object.fromEntries(items.map((mci) => [mci.checkItem.id, { ...BLANK }]));
}

/** Every unanswered PASS_FAIL item set to PASS; answered ones are left alone. */
export function passAllStates(items: CheckItemData[], states: CheckStates): CheckStates {
  const next = { ...states };
  for (const id of passAllTargets(items, states)) next[id] = { ...(next[id] ?? BLANK), result: "PASS" };
  return next;
}

/** The items Pass all would change: unanswered pass/fail ones. */
export function passAllTargets(items: CheckItemData[], states: CheckStates): string[] {
  return items.filter((mci) => mci.checkItem.type === "PASS_FAIL" && !states[mci.checkItem.id]?.result).map((mci) => mci.checkItem.id);
}

/**
 * Pass all's exact reverse (review SF5): un-answer only the items Pass all answered,
 * and only those still reading Pass. Answers, notes and photos given since survive.
 */
export function revertPassAll(states: CheckStates, ids: readonly string[]): CheckStates {
  const next = { ...states };
  for (const id of ids) if (next[id]?.result === "PASS") next[id] = { ...next[id], result: null };
  return next;
}

/** Whether {@link revertPassAll} would change anything (else its Undo says "Nothing to undo"). */
export function canRevertPassAll(states: CheckStates, ids: readonly string[]): boolean {
  return ids.some((id) => states[id]?.result === "PASS");
}

export const hasPassFail = (items: CheckItemData[]): boolean => items.some((mci) => mci.checkItem.type === "PASS_FAIL");

/** A measurement against its limits; `null` until the value is a number. */
export function measurementAutoResult(value: string, min: number | null, max: number | null): "PASS" | "FAIL" | null {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (min !== null && num < min) return "FAIL";
  if (max !== null && num > max) return "FAIL";
  return "PASS";
}

/** Why ONE item stops the save, in plain words; `null` when it is answered. */
function itemBlocker(mci: CheckItemData, state: CheckState | undefined): string | null {
  const label = mci.checkItem.label;
  if (mci.checkItem.type === "NOTES") return null; // notes are always optional
  if (!state || state.result === null) return `Answer ${label}`;
  if (state.result !== "FAIL") return null;
  const reason = state.notes.trim().length > 0;
  const photo = state.photos.length > 0;
  if (!reason && !photo) return `${label} needs a reason and a photo`;
  if (!reason) return `${label} needs a reason`;
  return photo ? null : `${label} needs a photo`;
}

/**
 * The first thing stopping the save, in plain words (`Yoke needs a reason and a
 * photo`), or `null` when the checklist can be saved. An empty list is never
 * savable: the server rejects an empty checks array.
 */
export function checkBlocker(items: CheckItemData[], states: CheckStates, photoUploading = false): string | null {
  if (items.length === 0) return "This model has no check items";
  for (const mci of items) {
    const why = itemBlocker(mci, states[mci.checkItem.id]);
    if (why) return why;
  }
  return photoUploading ? "Wait for the photo to finish uploading" : null;
}

export function checksComplete(items: CheckItemData[], states: CheckStates, photoUploading = false): boolean {
  return checkBlocker(items, states, photoUploading) === null;
}

export function checkFailCount(states: CheckStates): number {
  return Object.values(states).filter((s) => s.result === "FAIL").length;
}

/** True once anything has been answered or typed (the Scan page's `Discard this check?`). */
export function checkStatesDirty(states: CheckStates): boolean {
  return Object.values(states).some((s) => s.result !== null || s.value !== "" || s.notes !== "" || s.photos.length > 0);
}

/** The failed items in words (`Yoke: tilt lock slips`), one per line — a maintenance job's prefill. */
export function checkFailureReason(items: CheckItemData[], states: CheckStates): string {
  return items
    .filter((mci) => states[mci.checkItem.id]?.result === "FAIL")
    .map((mci) => {
      const notes = states[mci.checkItem.id]?.notes.trim();
      return notes ? `${mci.checkItem.label}: ${notes}` : mci.checkItem.label;
    })
    .join("\n");
}

/** What the save sends: one row per item, an unanswered notes item as NOTES_ONLY. */
export function checksPayload(items: CheckItemData[], states: CheckStates): CheckRecordFormValues[] {
  return items.map((mci) => {
    const state = states[mci.checkItem.id];
    return {
      checkItemId: mci.checkItem.id,
      result: state?.result || "NOTES_ONLY",
      value: state?.value || undefined,
      notes: state?.notes || undefined,
      photos: state?.photos || [],
    };
  });
}
