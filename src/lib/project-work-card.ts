/**
 * The Overview tab's Work card (work-layer v2 §4.4).
 *
 * The card used to be the project's whole work list, grouped by stage. It is
 * not any more: the **rail** carries the list on every working tab
 * (`project-work-rail-section.tsx`), and the **Work tab** owns the full view.
 * What is left for Overview is the question the other two can't answer at a
 * glance — *is this job in trouble?* So the card keeps the job's shape (the
 * stage meter, from `project-work.ts`) and the rows that need a decision, and
 * nothing else. A clean job collapses to three rows.
 *
 * "Needs a decision" is deliberately narrow. Work that is merely open and on
 * track is not a decision — it's the rail's business. Only three things earn
 * a row:
 *   1. a failing readiness check (the derived system rows, unchanged —
 *      `project-readiness-checks.ts` is untouched and keeps its deep links),
 *   2. work that is actually late,
 *   3. work nobody owns, as ONE summary row rather than one row each — the
 *      decision is "assign these", not "read these".
 *
 * Plain module, no React/Convex — unit-testable on its own.
 */

import type { ReadinessCheck, ReadinessSeverity } from "./project-readiness-checks";
import { isLateWork, isOpenWork, isUnownedWork, sortOpenWork, type WorkTaskLike } from "./project-work";

export interface WorkDecisionRow {
  id: string;
  title: string;
  detail?: string;
  /** A derived signal rather than a real `projectTasks` row — renders the
   *  "auto" badge, has no checkbox, and resolves itself when the underlying
   *  condition clears. */
  system: boolean;
  checkId?: ReadinessCheck["id"];
  /** Only on a system row — distinguishes "not checked yet" (a dateless
   *  project) from a check that actually failed. */
  severity?: ReadinessSeverity;
  actionLabel?: string;
  /** Set on a late row: how the lateness reads, e.g. "1d late". */
  lateLabel?: string;
}

function lateLabel(dueDate: string, nowMs: number): string {
  const days = Math.max(1, Math.round((nowMs - new Date(dueDate).getTime()) / 86_400_000));
  return `${days}d late`;
}

/**
 * The card's rows, most structural problem first: failing checks (they can
 * stop the job going out), then late work, then the unowned summary.
 */
export function buildWorkDecisionRows(
  checks: ReadinessCheck[],
  tasks: WorkTaskLike[],
  nowMs: number,
  timezone?: string,
): WorkDecisionRow[] {
  const rows: WorkDecisionRow[] = [];

  for (const check of checks) {
    if (check.severity === "pass") continue; // only a problem earns a row
    rows.push({
      id: `check:${check.id}`,
      title: check.title,
      detail: check.detail,
      system: true,
      checkId: check.id,
      severity: check.severity,
      actionLabel: check.actionLabel,
    });
  }

  // Note: no `if (!task.stage) continue` here. The old stage-grouped card
  // dropped stage-less rows, which is why its own total disagreed with the
  // Work tab header directly above it (§2 D2). Lateness has nothing to do
  // with whether someone set a stage.
  for (const task of sortOpenWork(tasks)) {
    if (!isLateWork(task, nowMs, timezone)) continue;
    rows.push({
      id: task.id,
      title: task.title,
      system: false,
      lateLabel: lateLabel(task.dueDate!, nowMs),
    });
  }

  const unowned = tasks.filter((t) => isOpenWork(t) && isUnownedWork(t));
  if (unowned.length > 0) {
    rows.push({
      id: "unowned",
      title: `${unowned.length} ${unowned.length === 1 ? "item has" : "items have"} no owner`,
      detail: "They show on this job, but on nobody’s Today.",
      system: true,
      actionLabel: "Assign",
    });
  }

  return rows;
}
