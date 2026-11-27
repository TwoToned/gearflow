"use client";

import * as React from "react";

import { useRestoreJobStatuses } from "@/components/projects/use-restore-job-statuses";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { useDateMoveGate } from "@/hooks/use-date-move-gate";
import { useNativeProjectStatus, useProjectWrites } from "@/hooks/use-native-project-writes";
import { runBulk, type BulkOutcome } from "@/lib/bulk-run";
import { announceListWrite, listWriteTitle, plural } from "@/lib/list-write-toast";
import type { ScheduleJob } from "@/lib/schedule";
import { confirmSkipReason, moveDates, moveSkipReason, type DateMove } from "@/lib/schedule-move";

/** A settled-by-the-gate promise: the gate's single onProceed resolves or rejects the request that raised it. */
interface Waiter {
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface MovePayload {
  job: ScheduleJob;
  move: DateMove;
}

const numberOf = (j: ScheduleJob) => j.projectNumber;

/**
 * The Schedule's two bulk writes (UX Phase 18, spec §9o.5). Each is a loop over
 * the EXISTING per-job write, behind the EXISTING non-blocking gate, so the
 * Schedule has no write path the job page does not:
 *
 * - `Confirm n`: `useConfirmStatusGate`, whose ONE `onProceed` runs
 *   `updateStatus(id, "CONFIRMED")` (the same `updateStatusNative` the job header
 *   calls, with its own server gates). Undo is `useRestoreJobStatuses`, the Jobs
 *   list's closure: exact rows, live-status guarded.
 * - `Move dates…`: `useDateMoveGate`, whose ONE `onProceed` runs
 *   `updateSchedule(id, patch, { lockDates: true })` (the same `updateNative`; the
 *   SERVER refuses a job whose gear is out or that is finished). Undo is
 *   `undoUpdate` per recorded audit id (`undoUpdateNative`: restores exactly the
 *   fields that edit changed, refusing if any changed since).
 *
 * `runBulk` gates each row, applies in order, names every skipped row and why,
 * and ONE `announceListWrite` toast carries ONE Undo closure for the whole batch.
 * A gate that finds a clash raises its dialog for that row; Cancel skips that row
 * only (named in the toast), and the batch carries on.
 */
export function useScheduleWrites(orgId: string | undefined) {
  const statusWrites = useNativeProjectStatus(orgId);
  const projectWrites = useProjectWrites(orgId);
  const restoreStatuses = useRestoreJobStatuses(orgId);
  const waiters = React.useRef(new Map<string, Waiter>());
  const audits = React.useRef(new Map<string, string>());

  const settle = (id: string, how: "resolve" | "reject", e?: unknown) => {
    const w = waiters.current.get(id);
    waiters.current.delete(id);
    if (how === "resolve") w?.resolve();
    else w?.reject(e);
  };
  const wait = (id: string, start: () => void) =>
    new Promise<void>((resolve, reject) => {
      waiters.current.set(id, { resolve, reject });
      start();
    });

  // ── Confirm ──
  const confirmGate = useConfirmStatusGate(orgId, async (id, next) => {
    try {
      await statusWrites.updateStatus(id, next);
      settle(id, "resolve");
    } catch (e) {
      settle(id, "reject", e);
    }
  });
  const confirmRow = (job: ScheduleJob) => wait(job.id, () => void confirmGate.requestStatusChange(job.id, job.status, "CONFIRMED"));
  const cancelConfirm = () => {
    const id = confirmGate.pending?.projectId;
    confirmGate.cancelPending();
    if (id) settle(id, "reject", new Error("kept as Quoted"));
  };

  // ── Move dates ──
  const moveGate = useDateMoveGate<MovePayload>(orgId, "", undefined, { start: null, end: null }, async ({ job, move }) => {
    try {
      const { auditId } = await projectWrites.updateSchedule(job.id, move.patch, { lockDates: true });
      audits.current.set(job.id, auditId);
      settle(job.id, "resolve");
    } catch (e) {
      settle(job.id, "reject", e);
    }
  });
  const moveRow = (job: ScheduleJob, days: number) => {
    const move = moveDates(job, days);
    const target = { projectId: job.id, status: job.status, window: move.before };
    return wait(job.id, () => void moveGate.requestSave(move.after, { job, move }, target));
  };
  const cancelMove = () => {
    const id = moveGate.pending?.data.job.id;
    moveGate.cancelPending();
    if (id) settle(id, "reject", new Error("kept its dates"));
  };

  // ── The two verbs ──
  const announce = (done: string, out: BulkOutcome<ScheduleJob>, undo: () => Promise<string | void>) =>
    announceListWrite({
      title: listWriteTitle(done, out.skipped),
      undoneTitle: `Undone · ${plural(out.done.length, "job")} restored`,
      performUndo: out.done.length > 0 ? undo : undefined,
    });

  async function confirmMany(rows: ScheduleJob[]) {
    const out = await runBulk(rows, { name: numberOf, gate: confirmSkipReason, apply: confirmRow });
    announce(`Confirmed ${plural(out.done.length, "job")}`, out, restoreStatuses(out.done, "CONFIRMED"));
  }

  async function moveMany(rows: ScheduleJob[], days: number) {
    const out = await runBulk(rows, { name: numberOf, gate: moveSkipReason, apply: (j) => moveRow(j, days) });
    const done = out.done.flatMap((j) => (audits.current.get(j.id) ? [{ job: j, auditId: audits.current.get(j.id)! }] : []));
    const undo = async (): Promise<string | void> => {
      let kept = 0;
      for (const d of done) {
        try {
          await projectWrites.undoUpdate(d.job.id, d.auditId);
        } catch {
          kept++;
        }
      }
      return kept > 0 ? `${plural(kept, "job")} had changed since, left as ${kept === 1 ? "it is" : "they are"}` : undefined;
    };
    announce(`Moved ${plural(out.done.length, "job")} by ${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`, out, undo);
  }

  return { confirmGate, cancelConfirm, moveGate, cancelMove, confirmMany, moveMany };
}
