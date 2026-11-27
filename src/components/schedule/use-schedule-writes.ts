"use client";

import * as React from "react";

import { useRestoreJobStatuses } from "@/components/projects/use-restore-job-statuses";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { useDateMoveGate } from "@/hooks/use-date-move-gate";
import { useNativeProjectStatus, useProjectWrites } from "@/hooks/use-native-project-writes";
import { runBulk, type BulkOutcome } from "@/lib/bulk-run";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import type { ScheduleJob } from "@/lib/schedule";
import { confirmSkipReason, moveDates, moveSkipReason, type DateMove } from "@/lib/schedule-move";

/** A request the gate's single onProceed (or its Cancel) settles. */
interface Waiter {
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface MovePayload {
  job: ScheduleJob;
  move: DateMove;
}

const numberOf = (j: ScheduleJob) => j.projectNumber;

/** Requests raised through a gate, settled by that gate's one onProceed: what lets `runBulk` await a dialog. */
function useWaiters() {
  const waiters = React.useRef(new Map<string, Waiter>());
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
  return { settle, wait };
}

type Waiters = ReturnType<typeof useWaiters>;

/**
 * ` · skipped #2370, #2337: not Quoted; #2351: kept as Quoted`. Skipped rows are NAMED, grouped by
 * their own reason (a batch can skip for several), never one reason for all of them.
 */
function skippedNote(skipped: BulkOutcome<ScheduleJob>["skipped"]): string {
  const byReason = new Map<string, string[]>();
  for (const s of skipped) byReason.set(s.why.replace(/\.$/, ""), [...(byReason.get(s.why.replace(/\.$/, "")) ?? []), s.name]);
  const parts = [...byReason].map(([why, names]) => `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` +${names.length - 4} more` : ""}: ${why}`);
  return parts.length > 0 ? ` · skipped ${parts.join("; ")}` : "";
}

/** One toast for the whole batch: skipped rows named with why, ONE Undo closure. */
function announce(done: string, out: BulkOutcome<ScheduleJob>, undo: () => Promise<string | void>) {
  announceListWrite({
    title: done + skippedNote(out.skipped),
    undoneTitle: `Undone · ${plural(out.done.length, "job")} restored`,
    performUndo: out.done.length > 0 ? undo : undefined,
  });
}

/**
 * `Confirm n`: `useConfirmStatusGate`, whose ONE `onProceed` runs
 * `updateStatus(id, "CONFIRMED")` (the same `updateStatusNative` the job header
 * calls, with its own server gates). Undo is `useRestoreJobStatuses`, the Jobs
 * list's closure: exact rows, live-status guarded.
 */
function useConfirmBatch(orgId: string | undefined, w: Waiters) {
  const statusWrites = useNativeProjectStatus(orgId);
  const restoreStatuses = useRestoreJobStatuses(orgId);
  const gate = useConfirmStatusGate(orgId, async (id, next) => {
    try {
      await statusWrites.updateStatus(id, next);
      w.settle(id, "resolve");
    } catch (e) {
      w.settle(id, "reject", e);
    }
  });
  const confirmRow = (job: ScheduleJob) => w.wait(job.id, () => void gate.requestStatusChange(job.id, job.status, "CONFIRMED"));
  const cancel = () => {
    const id = gate.pending?.projectId;
    gate.cancelPending();
    if (id) w.settle(id, "reject", new Error("kept as Quoted"));
  };
  const run = async (rows: ScheduleJob[]) => {
    const out = await runBulk(rows, { name: numberOf, gate: confirmSkipReason, apply: confirmRow });
    announce(`Confirmed ${plural(out.done.length, "job")}`, out, restoreStatuses(out.done, "CONFIRMED"));
  };
  return { gate, cancel, run };
}

/**
 * `Move dates…`: `useDateMoveGate`, whose ONE `onProceed` runs
 * `updateSchedule(id, patch, { lockDates: true })` (the same `updateNative`; the
 * SERVER refuses a job whose gear is out or that is finished). Undo is
 * `undoUpdate` per recorded audit id (`undoUpdateNative`: restores exactly the
 * fields that edit changed, refusing if any changed since).
 */
function useMoveBatch(orgId: string | undefined, w: Waiters) {
  const projectWrites = useProjectWrites(orgId);
  const audits = React.useRef(new Map<string, string>());
  const gate = useDateMoveGate<MovePayload>(orgId, "", undefined, { start: null, end: null }, async ({ job, move }) => {
    try {
      const { auditId } = await projectWrites.updateSchedule(job.id, move.patch, { lockDates: true });
      audits.current.set(job.id, auditId);
      w.settle(job.id, "resolve");
    } catch (e) {
      w.settle(job.id, "reject", e);
    }
  });
  const moveRow = (job: ScheduleJob, days: number) => {
    const move = moveDates(job, days);
    const target = { projectId: job.id, status: job.status, window: move.before };
    return w.wait(job.id, () => void gate.requestSave(move.after, { job, move }, target));
  };
  const cancel = () => {
    const id = gate.pending?.data.job.id;
    gate.cancelPending();
    if (id) w.settle(id, "reject", new Error("kept its dates"));
  };
  const run = async (rows: ScheduleJob[], days: number) => {
    const out = await runBulk(rows, { name: numberOf, gate: moveSkipReason, apply: (j) => moveRow(j, days) });
    const done = out.done.flatMap((j) => (audits.current.has(j.id) ? [{ id: j.id, auditId: audits.current.get(j.id)! }] : []));
    const undo = async (): Promise<string | void> => {
      let kept = 0;
      for (const d of done) {
        try {
          await projectWrites.undoUpdate(d.id, d.auditId);
        } catch {
          kept++;
        }
      }
      return kept > 0 ? `${plural(kept, "job")} had changed since, left as ${kept === 1 ? "it is" : "they are"}` : undefined;
    };
    announce(`Moved ${plural(out.done.length, "job")} by ${days > 0 ? "+" : ""}${days} ${Math.abs(days) === 1 ? "day" : "days"}`, out, undo);
  };
  return { gate, cancel, run };
}

/**
 * The Schedule's two bulk writes (UX Phase 18, spec §9o.5). Each is a loop over
 * the EXISTING per-job write behind the EXISTING non-blocking gate, so the
 * Schedule has no write path the job page does not. `runBulk` gates each row,
 * applies in order and names every skipped row and why; ONE `announceListWrite`
 * toast carries ONE Undo closure for the whole batch. A gate that finds a clash
 * raises its dialog for that row; Cancel skips that row only (named in the
 * toast) and the batch carries on.
 */
export function useScheduleWrites(orgId: string | undefined) {
  const waiters = useWaiters();
  const confirm = useConfirmBatch(orgId, waiters);
  const move = useMoveBatch(orgId, waiters);
  return {
    confirmGate: confirm.gate,
    cancelConfirm: confirm.cancel,
    confirmMany: confirm.run,
    moveGate: move.gate,
    cancelMove: move.cancel,
    moveMany: move.run,
  };
}
