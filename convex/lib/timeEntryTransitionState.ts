import type { Doc } from "../_generated/dataModel";
import { TIME_ENTRY_TRANSITION_FROM, TIME_ENTRY_TRANSITION_TO, type TimeEntryTransition } from "./timeEntryTransitions";

/**
 * The pure state math behind the timesheet transitions and their exact Undos
 * (UX Phase 15, D47): what a transition records, what it writes, and what its
 * Undo puts back. `crewTimeEntriesWrites` does the reads, the writes and the
 * audit; everything here is a plain function of the row, so it is unit-testable
 * and keeps the mutation module to its I/O.
 */
type EntryDoc = Doc<"crewTimeEntries">;
export type EntryFields = Omit<EntryDoc, "_id" | "_creationTime">;

/** The prior state a forward transition recorded on its activity row. */
export interface TransitionRecord {
  transition: TimeEntryTransition;
  prevStatus?: string;
  prevQueryReason?: string;
  prevApprovedById?: string;
  prevApprovedAt?: number;
}

export const isTransition = (t: unknown): t is TimeEntryTransition => t === "submit" || t === "approve" || t === "query";

/** The fields a transition replaces, as they stand before it. Absent fields stay absent. */
export function priorState(doc: EntryDoc): Record<string, unknown> {
  const prior: Record<string, unknown> = { prevStatus: doc.status ?? "DRAFT" };
  if (doc.queryReason != null) prior.prevQueryReason = doc.queryReason;
  if (doc.approvedById != null) prior.prevApprovedById = doc.approvedById;
  if (doc.approvedAt != null) prior.prevApprovedAt = doc.approvedAt;
  return prior;
}

/**
 * The entry after `t`. `queryReason` is set by Query and cleared by Submit /
 * Approve (D47). A queried entry is no longer approved: Query clears the
 * approval stamp (the dialog says "an approved entry loses its approval"), and
 * its Undo restores it exactly from the recorded prior state (`restored`).
 */
export function transitioned(doc: EntryDoc, t: TimeEntryTransition, actorId: string, now: number, reason: string | undefined): EntryFields {
  const { _id, _creationTime, ...rest } = doc;
  void _id; void _creationTime;
  const next: EntryFields = { ...rest, status: TIME_ENTRY_TRANSITION_TO[t] as EntryFields["status"], updatedAt: now };
  delete next.queryReason;
  if (t === "query") { next.queryReason = reason; delete next.approvedById; delete next.approvedAt; }
  if (t === "approve") { next.approvedById = actorId; next.approvedAt = now; }
  return next;
}

/** Set `key` to `value`, or remove it when the prior state had none. */
function restoreField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value == null) delete target[key];
  else target[key] = value;
}

/** The entry with the fields its transition replaced put back exactly as the forward write recorded them. */
export function restored(doc: EntryDoc, prior: TransitionRecord, now: number): EntryFields {
  const { _id, _creationTime, ...rest } = doc;
  void _id; void _creationTime;
  const next: Record<string, unknown> = { ...rest, status: prior.prevStatus, updatedAt: now };
  restoreField(next, "queryReason", prior.prevQueryReason);
  // Approve and Query both replace the approval stamp, so both put it back.
  if (prior.transition === "approve" || prior.transition === "query") {
    restoreField(next, "approvedById", prior.prevApprovedById);
    restoreField(next, "approvedAt", prior.prevApprovedAt);
  }
  return next as EntryFields;
}

/** Every refusal `revertNative` can raise for one entry before its record is read; null when it may proceed. */
export function revertRefusal(doc: EntryDoc | null, orgId: string, stamp: number): string | null {
  if (!doc || doc.organizationId !== orgId) return "Time entry not found";
  if (doc.updatedAt !== stamp) return "This time entry changed after that write, so it can't be undone";
  return null;
}

/** A record is replayable only if its prior status is one its transition may start from. */
export function replayable(prior: TransitionRecord | null): prior is TransitionRecord & { prevStatus: string } {
  return !!prior?.prevStatus && TIME_ENTRY_TRANSITION_FROM[prior.transition].includes(prior.prevStatus);
}

/** Why one created entry can't be taken back by `undoCreateManyNative` (Log time's Undo), or null. */
export function undoCreateRefusal(doc: EntryDoc | null, orgId: string, stamp: number): string | null {
  if (!doc || doc.organizationId !== orgId) return "Time entry not found";
  const untouched = doc.status === "DRAFT" && doc.updatedAt === stamp && doc.createdAt === stamp;
  return untouched ? null : "An entry was edited, submitted or approved since it was logged, so Log time can't be undone";
}
