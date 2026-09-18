/**
 * The Overview tab's Work card (#1244, design §8.3) — readiness checks and
 * work items merged into ONE list grouped by stage, each stage with a
 * progress bar. Replaces the standalone Readiness panel (deleted, per the
 * issue's guardrail: "two surfaces showing the same checks is exactly the
 * duplication this program exists to remove").
 *
 * `project-readiness-checks.ts`'s pure check logic is UNCHANGED — this
 * module only decides which STAGE a failing check's system row belongs
 * under, and merges it with real `projectTasks` rows. A passing check
 * contributes no row (design §9's derived-signal philosophy: only a problem
 * is worth a row — the card's progress bar already carries the reassurance
 * a clean project needs).
 *
 * Plain module, no React/Convex — unit-testable on its own, same discipline
 * as `project-readiness-checks.ts` itself.
 */

import type { ReadinessCheck, ReadinessSeverity } from "./project-readiness-checks";
import { WORK_STAGES, WORK_STAGE_LABELS, type WorkStage } from "../../convex/lib/workVocabulary";

export interface WorkCardTaskInput {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  stage?: WorkStage | null;
}

export interface WorkCardRow {
  id: string;
  title: string;
  detail?: string;
  done: boolean;
  /** A derived readiness signal, not a real projectTasks row — renders the
   *  "auto" badge and (for gear/crew/services) the existing deep-link. */
  system: boolean;
  checkId?: ReadinessCheck["id"];
  /** Only set on a system row — lets the card distinguish "not checked yet"
   *  (needs dates) from an actual failing check (needs the org board). */
  severity?: ReadinessSeverity;
  actionLabel?: string;
}

export interface WorkCardStage {
  stage: WorkStage;
  label: string;
  rows: WorkCardRow[];
  doneCount: number;
  totalCount: number;
}

/** Which stage a failing readiness check's system row surfaces under.
 *  Pricing is a QUOTE-phase concern (money agreed before it's a prep
 *  problem); gear/conflicts/crew/services are all "is this job ready to go
 *  out" — PREP. */
const STAGE_FOR_CHECK: Record<ReadinessCheck["id"], WorkStage> = {
  pricing: "quote",
  gear: "prep",
  conflicts: "prep",
  crew: "prep",
  services: "prep",
};

export function buildWorkCardStages(
  checks: ReadinessCheck[],
  tasks: WorkCardTaskInput[],
): WorkCardStage[] {
  const byStage = new Map<WorkStage, WorkCardRow[]>(WORK_STAGES.map((s) => [s, []]));

  for (const check of checks) {
    if (check.severity === "pass") continue; // only a problem earns a row
    const stage = STAGE_FOR_CHECK[check.id];
    byStage.get(stage)!.push({
      id: `check:${check.id}`,
      title: check.title,
      detail: check.detail,
      done: false,
      system: true,
      checkId: check.id,
      severity: check.severity,
      actionLabel: check.actionLabel,
    });
  }

  for (const task of tasks) {
    if (!task.stage) continue; // no stage bucket to render it in on this card
    if (task.status === "CANCELLED") continue; // cancelled work isn't tracked toward the bar
    byStage.get(task.stage)!.push({
      id: task.id,
      title: task.title,
      done: task.status === "DONE",
      system: false,
    });
  }

  return WORK_STAGES.map((stage) => {
    const rows = byStage.get(stage)!;
    const doneCount = rows.filter((r) => r.done).length;
    return { stage, label: WORK_STAGE_LABELS[stage], rows, doneCount, totalCount: rows.length };
  }).filter((s) => s.totalCount > 0);
}

export interface WorkCardSummary {
  done: number;
  total: number;
}

export function summariseWorkCard(stages: WorkCardStage[]): WorkCardSummary {
  return stages.reduce(
    (acc, s) => ({ done: acc.done + s.doneCount, total: acc.total + s.totalCount }),
    { done: 0, total: 0 },
  );
}
