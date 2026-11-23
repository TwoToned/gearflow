"use client";

import { toast } from "sonner";

import { useCrewTimeWrites, type TransitionResult } from "@/hooks/use-crew-time-writes";
import { announceListWrite, listWriteTitle } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import type { CrewTimeEntryFormValues } from "@/lib/validations/crew";
import { exportTimesheetCSV } from "@/server/crew-time";
import type { TimeEntryTransition } from "../../../../../convex/lib/timeEntryTransitions";

/**
 * Every timesheet write behind the list (UX Phase 15, §9h.4). Each is an
 * existing mutation; a reversible one toasts with Undo from ONE guarded
 * closure (`announceListWrite`):
 * - Submit / Approve / Query… → `revert(result)`: the forward result's own
 *   `changed` + `stamp`, nothing else (Q-I4). A row edited since makes the
 *   whole Undo refuse; that refusal is toasted, never retried.
 * - Edit entry → the row's snapshot replayed through the same `update`.
 * - Log time → the created entries deleted (offered only to a caller who may delete).
 * - Delete entry → confirmed first, no Undo (as live).
 */

const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

const VERB: Record<TimeEntryTransition, { done: string; undone: string; why: string }> = {
  submit: { done: "Submitted", undone: "back to where they were", why: "not a draft or queried" },
  approve: { done: "Approved", undone: "approval undone", why: "not submitted or queried" },
  query: { done: "Queried", undone: "query undone", why: "not submitted or approved" },
};

export interface TimesheetWriteCtx {
  /** Display name per entry id (`Ana Ruiz · Fri 7 Nov`), for skipped-row toasts. */
  nameOf: (id: string) => string;
  canDelete: boolean;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useTimesheetWrites(ctx: TimesheetWriteCtx) {
  const w = useCrewTimeWrites();

  function forward(t: TimeEntryTransition, ids: string[], reason?: string): Promise<TransitionResult> {
    if (t === "submit") return w.submit(ids);
    if (t === "approve") return w.approve(ids);
    return w.query(ids, { reason: reason ?? "" });
  }

  /** Submit / Approve / Query… on `ids`; the toast names what the server skipped. */
  async function transition(t: TimeEntryTransition, ids: string[], reason?: string): Promise<boolean> {
    let result: TransitionResult;
    try {
      result = await forward(t, ids, reason);
    } catch (e) {
      showError(e, { fallbackTitle: `Could not ${t} the ${ids.length === 1 ? "entry" : "entries"}` });
      return false;
    }
    const changed = new Set(result.changed);
    const skipped = ids.filter((id) => !changed.has(id)).map((id) => ({ name: ctx.nameOf(id), why: VERB[t].why }));
    announceListWrite({
      title: listWriteTitle(`${VERB[t].done} ${entries(result.count)}`, skipped),
      undoneTitle: `Undone · ${entries(result.count)} ${VERB[t].undone}`,
      performUndo: async () => {
        await w.revert(result);
      },
    });
    return true;
  }

  /**
   * Edit entry. `updateNative` returns the entry to Draft and clears its
   * approval, so replaying the snapshot restores a DRAFT entry exactly and
   * nothing else: Undo is offered only when the entry was a draft (the sheet
   * warns before saving any other).
   */
  async function update(id: string, next: CrewTimeEntryFormValues, snapshot: CrewTimeEntryFormValues, wasStatus: string): Promise<boolean> {
    try {
      await w.update(id, next);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the entry" });
      return false;
    }
    const exact = wasStatus === "DRAFT";
    announceListWrite({
      title: exact ? `${ctx.nameOf(id)} · entry saved` : `${ctx.nameOf(id)} · entry saved as Draft`,
      undoneTitle: "Undone · entry restored",
      performUndo: exact
        ? async () => {
            await w.update(id, snapshot);
          }
        : undefined,
    });
    return true;
  }

  async function remove(id: string) {
    try {
      await w.remove(id);
      toast.success("Entry deleted");
    } catch (e) {
      showError(e, { fallbackTitle: "Could not delete the entry" });
    }
  }

  /** Log time for many people at once; per-person failures are named, never silent. */
  async function logTime(data: CrewTimeEntryFormValues, people: { id: string; name: string }[]): Promise<boolean> {
    let res: Awaited<ReturnType<typeof w.createMany>>;
    try {
      res = await w.createMany(data, people.map((p) => p.id));
    } catch (e) {
      showError(e, { fallbackTitle: "Could not log time" });
      return false;
    }
    const skipped = res.errors.map((er) => ({ name: people.find((p) => p.id === er.crewMemberId)?.name ?? "Crew member", why: er.message }));
    if (res.entryIds.length === 0) {
      toast.error(listWriteTitle("No time logged", skipped));
      return false;
    }
    announceListWrite({
      title: listWriteTitle(`Logged time · ${entries(res.entryIds.length)}`, skipped),
      undoneTitle: `Undone · ${entries(res.entryIds.length)} removed`,
      // ONE atomic delete of exactly the created ids; it refuses if any was submitted or approved since.
      performUndo: ctx.canDelete
        ? async () => {
            await w.undoCreateMany(res);
          }
        : undefined,
    });
    return true;
  }

  /** Bulk Export: the SAME server CSV as Export all (pay columns decided there), narrowed to `ids`. */
  async function exportRows(ids: string[]) {
    try {
      const csv = await exportTimesheetCSV({ ids });
      downloadCsv(csv, `timesheet-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${entries(ids.length)}`);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not export" });
    }
  }

  return { transition, update, remove, logTime, exportRows };
}
