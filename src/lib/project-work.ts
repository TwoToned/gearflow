/**
 * The shared shaping rules for a project's work (work-layer v2 §4.3/§4.4).
 *
 * Three surfaces ask different questions of the same rows — the rail asks
 * "what is outstanding", the Overview card asks "is this job in trouble", the
 * Work tab asks "who is doing what" — but they must agree on what *open*,
 * *late* and *unowned* mean, and on the stage meter's arithmetic. A second
 * copy of "late" is a defect even while it agrees (R-3.1): the first time one
 * surface counts an overdue row the other doesn't, the header and the list
 * contradict each other on the same screen.
 *
 * Plain module, no React/Convex — the same discipline as
 * `project-work-card.ts`, which builds on these.
 */

import { bucketForDueDate } from "./today-buckets";
import { WORK_STAGES, WORK_STAGE_LABELS, type WorkStage } from "../../convex/lib/workVocabulary";

/** The subset of a task row these rules need. Structural rather than the full
 *  `ProjectTaskRow`, so the plain module never depends on the read's shape. */
export interface WorkTaskLike {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  stage?: WorkStage | null;
  /** ISO string, as the project-scoped composite read returns it. */
  dueDate?: string | null;
  assigneeUserId?: string | null;
  assigneeCrewId?: string | null;
}

/** How many rows the rail shows before deferring to the Work tab. The rail is
 *  a working set, not a list view — if it needs a scrollbar it has failed. */
export const WORK_RAIL_VISIBLE_LIMIT = 5;

export const isOpenWork = (t: WorkTaskLike): boolean => t.status === "TODO" || t.status === "IN_PROGRESS";

/** Cancelled work is not "open" and not counted toward the job's totals —
 *  it isn't outstanding and it isn't an achievement. Module-local: callers
 *  read the counts off `summariseProjectWork` rather than re-deriving them. */
const isCountedWork = (t: WorkTaskLike): boolean => t.status !== "CANCELLED";

export const isUnownedWork = (t: WorkTaskLike): boolean => !t.assigneeUserId && !t.assigneeCrewId;

const dueMs = (t: WorkTaskLike): number | null => {
  if (!t.dueDate) return null;
  const ms = new Date(t.dueDate).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** Late = open AND past the org's start-of-today. Same boundary Today buckets
 *  by, so a row that reads "1d late" on a job reads overdue on Today too. */
export function isLateWork(t: WorkTaskLike, nowMs: number, timezone?: string): boolean {
  if (!isOpenWork(t)) return false;
  const ms = dueMs(t);
  return ms != null && bucketForDueDate(ms, nowMs, timezone) === "overdue";
}

/**
 * Open work, most-pressing first: overdue, then by due date ascending, then
 * undated. One ascending sort on the due date with undated as +Infinity
 * already produces all three — an overdue date is the smallest value there is,
 * and undated sorts last by construction. Title breaks ties so the order is
 * stable between renders rather than left to the read's arrival order.
 */
export function sortOpenWork<T extends WorkTaskLike>(tasks: T[]): T[] {
  return [...tasks].filter(isOpenWork).sort((a, b) => {
    const da = dueMs(a) ?? Number.POSITIVE_INFINITY;
    const db = dueMs(b) ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });
}

interface WorkStageMeterSegment {
  stage: WorkStage | "unstaged";
  label: string;
  done: number;
  total: number;
  /** 0–100, and 0 for an empty stage — never NaN from a 0/0. */
  pct: number;
}

export interface ProjectWorkSummary {
  openCount: number;
  doneCount: number;
  /** Everything not cancelled — the denominator the tab header's "9 of 14" uses. */
  totalCount: number;
  lateCount: number;
  unownedCount: number;
  /** One segment per stage that HAS work, plus a trailing `unstaged` segment
   *  when rows carry no stage. A stage with nothing in it draws nothing —
   *  six empty bars say less than three full ones. */
  meter: WorkStageMeterSegment[];
}

export function summariseProjectWork(
  tasks: WorkTaskLike[],
  nowMs: number,
  timezone?: string,
): ProjectWorkSummary {
  const counted = tasks.filter(isCountedWork);
  const open = counted.filter(isOpenWork);

  // `unstaged` is a real segment, not a skipped row. Dropping stage-less work
  // is what made the Overview card's total disagree with the Work tab's
  // header (work-layer v2 §2 D2) — every pre-#1243 row has no stage.
  const buckets = new Map<WorkStage | "unstaged", { done: number; total: number }>();
  for (const t of counted) {
    const key: WorkStage | "unstaged" = t.stage ?? "unstaged";
    const b = buckets.get(key) ?? { done: 0, total: 0 };
    b.total += 1;
    if (t.status === "DONE") b.done += 1;
    buckets.set(key, b);
  }

  const order: (WorkStage | "unstaged")[] = [...WORK_STAGES, "unstaged"];
  const meter: WorkStageMeterSegment[] = order
    .filter((key) => buckets.has(key))
    .map((key) => {
      const b = buckets.get(key)!;
      return {
        stage: key,
        label: key === "unstaged" ? "No stage" : WORK_STAGE_LABELS[key],
        done: b.done,
        total: b.total,
        pct: b.total === 0 ? 0 : Math.round((b.done / b.total) * 100),
      };
    });

  return {
    openCount: open.length,
    doneCount: counted.filter((t) => t.status === "DONE").length,
    totalCount: counted.length,
    lateCount: open.filter((t) => isLateWork(t, nowMs, timezone)).length,
    unownedCount: open.filter(isUnownedWork).length,
    meter,
  };
}
