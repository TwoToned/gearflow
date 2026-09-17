/**
 * Isomorphic work-item vocabulary — the pure status/priority/kind/stage
 * definitions shared by the Convex validators, the Zod schemas and the UI
 * (work-layer phase 1, #1243, design doc §10.1/§10.6).
 *
 * This file MUST stay import-free / side-effect-free so it bundles cleanly
 * into the Next build, the Convex deployment AND plain Zod schema files —
 * same rule as `convex/lib/permissionsCore.ts`, which proves the pattern. Do
 * NOT add `convex/values`, Prisma, Node, browser, or `@/`-aliased imports
 * here.
 *
 * REPLACES the two hand-synced copies this program found at
 * `convex/lib/validators.ts`'s `ProjectTaskStatus`/`ProjectTaskPriority` and
 * `src/lib/project-tasks.ts` — both now re-export from here rather than
 * declaring their own literals, so a status/priority/stage rename is a
 * compile error everywhere at once instead of a silent three-way drift
 * (R-3.1). Nothing else may re-declare these unions.
 */

// ─── Status ───────────────────────────────────────────────────────────────
// Phase 1 adds "cancelled" — a work item can be called off without pretending
// it was ever "done".
export const WORK_ITEM_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

// ─── Priority ─────────────────────────────────────────────────────────────
export const WORK_ITEM_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
};

// ─── Kind ─────────────────────────────────────────────────────────────────
// Design §8.2: three CONCEPTUAL kinds (task / follow_up / system), but
// "system" work is DERIVED and never stored as a projectTasks row (§9) — so
// only two kinds are ever written. Absent on a row means "task" (every
// pre-phase-1 row, and the common case going forward).
export const WORK_ITEM_KINDS = ["task", "follow_up"] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export const WORK_ITEM_KIND_LABELS: Record<WorkItemKind, string> = {
  task: "Task",
  follow_up: "Follow-up",
};

// ─── Stage ────────────────────────────────────────────────────────────────
// Groups work on a project by where the job is. Distinct from the crew
// ProjectPhase enum, which describes SHIFTS, not work (design §8.2).
export const WORK_STAGES = ["quote", "prep", "load_in", "show", "return", "close"] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

export const WORK_STAGE_LABELS: Record<WorkStage, string> = {
  quote: "Quote",
  prep: "Prep",
  load_in: "Load-in",
  show: "Show",
  return: "Return",
  close: "Close",
};

/**
 * Default stage from the project's lifecycle status, per design §10.1's
 * table. `AWAITING_PAYMENT` is not in that table (the design doc predates
 * #1236) — its own schema comment is explicit that "the job isn't ours to
 * prep yet" while payment is outstanding, so it stays in `quote` alongside
 * ENQUIRY/QUOTING/QUOTED rather than jumping to `prep` early.
 *
 * Returns `undefined` for `CANCELLED` and any status not listed — callers
 * keep the work item's EXISTING stage rather than overwrite it (§10.1: "none
 * — an existing stage is kept").
 */
const STATUS_TO_STAGE: Record<string, WorkStage> = {
  ENQUIRY: "quote",
  QUOTING: "quote",
  QUOTED: "quote",
  AWAITING_PAYMENT: "quote",
  CONFIRMED: "prep",
  PREPPING: "prep",
  CHECKED_OUT: "load_in",
  ON_SITE: "show",
  RETURNED: "return",
  COMPLETED: "close",
  INVOICED: "close",
};

export function defaultStageForProjectStatus(projectStatus: string): WorkStage | undefined {
  return STATUS_TO_STAGE[projectStatus];
}
