"use client";

import type { MutableRefObject } from "react";
import { toast } from "sonner";

import { MAX_TAGS } from "../../../convex/lib/tagLimits";

import { useRestoreJobStatuses } from "@/components/projects/use-restore-job-statuses";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { useNativeProjectStatus, useProjectWrites } from "@/hooks/use-native-project-writes";
import { runBulk, type BulkOutcome } from "@/lib/bulk-run";
import { jobStatusLabel, jobsCsv, type JobSource } from "@/lib/list-views/jobs";
import { announceListWrite, listWriteTitle, plural } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

type Seen = MutableRefObject<Map<string, JobSource>>;

const statusOf = (r: JobSource) => r.status ?? "ENQUIRY";
const numberOf = (r: JobSource) => r.projectNumber;

/** ` · 2 jobs already have 25 tags (P-1, P-2)`: jobs a tag could not be added to are NAMED, never silent. */
function fullTagsNote(rows: JobSource[], full: string[]): string {
  if (full.length === 0) return "";
  const names = rows.filter((r) => full.includes(r.id)).slice(0, 4).map(numberOf).join(", ");
  const more = full.length > 4 ? ` +${full.length - 4} more` : "";
  return ` · ${plural(full.length, "job")} already ${full.length === 1 ? "has" : "have"} ${MAX_TAGS} tags (${names}${more})`;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Every write behind the Jobs list's row and bulk menus. Each is an EXISTING
 * mutation (`updateStatusNative`, `archiveNative`, `updateNative`,
 * `deleteNative`); nothing here is a new write. A reversible one toasts with
 * Undo from a single guarded closure (`announceListWrite`).
 */
export function useJobListWrites(orgId: string | undefined, seen: Seen) {
  const statusWrites = useNativeProjectStatus(orgId);
  const projectWrites = useProjectWrites(orgId);
  const pick = (ids: string[]) => ids.map((id) => seen.current.get(id)).filter((r): r is JobSource => !!r);

  // The ONE status Undo (shared with the Schedule's Confirm n): exact rows, live-status guarded.
  const restoreStatuses = useRestoreJobStatuses(orgId);

  function summarise(done: string, out: BulkOutcome<JobSource>, undo?: () => Promise<string | void>) {
    announceListWrite({
      title: listWriteTitle(done, out.skipped),
      undoneTitle: `Undone · ${plural(out.done.length, "job")} restored`,
      performUndo: out.done.length > 0 ? undo : undefined,
    });
  }

  async function moveOne(id: string, next: string) {
    const row = seen.current.get(id);
    try {
      await statusWrites.updateStatus(id, next);
      announceListWrite({
        title: `${row?.name ?? "Job"} set to ${jobStatusLabel(next)}`,
        undoneTitle: `Undone · back to ${jobStatusLabel(row ? statusOf(row) : "ENQUIRY")}`,
        performUndo: row ? restoreStatuses([row], next) : undefined,
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not update status" });
    }
  }

  // Confirming a job previews overbooking first (non-blocking); every other move proceeds at once.
  const gate = useConfirmStatusGate(orgId, (id, next) => void moveOne(id, next));
  const setStatusOne = (id: string, next: string) => gate.requestStatusChange(id, seen.current.get(id)?.status ?? undefined, next);

  async function cancelOne(id: string) {
    const row = seen.current.get(id);
    try {
      await projectWrites.archive(id);
      announceListWrite({
        title: `${row?.name ?? "Job"} cancelled`,
        undoneTitle: "Undone · job restored",
        performUndo: row ? restoreStatuses([row], "CANCELLED") : undefined,
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not cancel the job" });
    }
  }

  async function deleteOne(id: string) {
    try {
      await projectWrites.remove(id);
      toast.success("Job deleted");
    } catch (e) {
      showError(e, { fallbackTitle: "Could not delete the job" });
    }
  }

  async function bulkStatus(ids: string[], next: string) {
    const out = await runBulk(pick(ids), {
      name: numberOf,
      gate: (r) => (statusOf(r) === next ? `already ${jobStatusLabel(next)}` : null),
      apply: (r) => statusWrites.updateStatus(r.id, next),
    });
    summarise(`Set ${plural(out.done.length, "job")} to ${jobStatusLabel(next)}`, out, restoreStatuses(out.done, next));
  }

  /** ONE server call; the server reads each job's current tags and returns the ids it newly tagged. */
  async function bulkTag(ids: string[], tag: string) {
    const rows = pick(ids);
    let result: { changed: string[]; full: string[] };
    try {
      result = await projectWrites.addTag(rows.map((r) => r.id), tag);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not tag the jobs" });
      return;
    }
    const { changed, full } = result;
    const done = rows.filter((r) => changed.includes(r.id));
    const skipped = rows.filter((r) => !changed.includes(r.id) && !full.includes(r.id)).map((r) => ({ name: numberOf(r), why: `already tagged ${tag}` }));
    summarise(`Tagged ${plural(done.length, "job")} ${tag}${fullTagsNote(rows, full)}`, { done, skipped }, async () => {
      await projectWrites.removeTag(changed, tag);
    });
  }

  async function bulkCancel(ids: string[]) {
    const out = await runBulk(pick(ids), {
      name: numberOf,
      gate: (r) => (statusOf(r) === "CANCELLED" ? "already cancelled" : null),
      apply: (r) => projectWrites.archive(r.id),
    });
    summarise(`Cancelled ${plural(out.done.length, "job")}`, out, restoreStatuses(out.done, "CANCELLED"));
  }

  function bulkExport(ids: string[]) {
    const rows = pick(ids);
    downloadCsv(jobsCsv(rows), "jobs.csv");
    toast.success(`Exported ${plural(rows.length, "job")}`);
  }

  return { gate, setStatusOne, cancelOne, deleteOne, bulkStatus, bulkTag, bulkCancel, bulkExport };
}
