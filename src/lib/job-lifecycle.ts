/**
 * The job lifecycle as the header's progress line reads it (spec §6b, D92).
 *
 * Eight stages over eleven statuses. `AWAITING_PAYMENT` is ONE stage. Its three
 * sub-steps are derived facts on invoice and payment rows
 * (`project-payment-progress.ts`, FEATUREDOCS/77), never statuses. A two-status
 * stage shows which status it is in as a sub-label (`Quote · quoted`).
 * `CANCELLED` is off the pipeline: it has no stage and no next stage.
 *
 * A plain module (no React), so the stage table and the "what does Advance move
 * to" rule are unit-tested. It replaces the table inside the deleted
 * `project-lifecycle.tsx`.
 */
import { projectStatusLabels } from "@/lib/status-labels";

export type LifecycleStageKey =
  | "enquiry" | "quote" | "payment" | "confirmed" | "prep" | "onsite" | "return" | "completed";

interface LifecycleStage {
  key: LifecycleStageKey;
  label: string;
  statuses: readonly string[];
  /** The status a move INTO this stage writes. */
  entry: string;
}

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  { key: "enquiry", label: "Enquiry", statuses: ["ENQUIRY"], entry: "ENQUIRY" },
  { key: "quote", label: "Quote", statuses: ["QUOTING", "QUOTED"], entry: "QUOTING" },
  { key: "payment", label: "Awaiting payment", statuses: ["AWAITING_PAYMENT"], entry: "AWAITING_PAYMENT" },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"], entry: "CONFIRMED" },
  { key: "prep", label: "Prep", statuses: ["PREPPING"], entry: "PREPPING" },
  { key: "onsite", label: "On site", statuses: ["CHECKED_OUT", "ON_SITE"], entry: "CHECKED_OUT" },
  { key: "return", label: "Return", statuses: ["RETURNED"], entry: "RETURNED" },
  { key: "completed", label: "Completed", statuses: ["COMPLETED", "INVOICED"], entry: "COMPLETED" },
];

/** Every status, in the order the `Set status ▾` menu lists them. */
export const ALL_PROJECT_STATUSES = [
  "ENQUIRY", "QUOTING", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "PREPPING",
  "CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED", "CANCELLED",
] as const;

/** The shared label map; a status the map misses falls back to the raw value. */
export function projectStatusLabel(status: string): string {
  return projectStatusLabels[status] ?? status;
}

/** -1 for `CANCELLED` or an unknown status. */
export function stageIndexForStatus(status: string): number {
  return LIFECYCLE_STAGES.findIndex((s) => s.statuses.includes(status));
}

/** What `Advance to …` moves to, or null at the end of the pipeline or off it. */
export function nextStage(status: string): { label: string; status: string } | null {
  const i = stageIndexForStatus(status);
  if (i < 0 || i >= LIFECYCLE_STAGES.length - 1) return null;
  const next = LIFECYCLE_STAGES[i + 1];
  return { label: next.label, status: next.entry };
}

/**
 * The `DetailHeader.progress` shape, or null when the job is off the pipeline
 * (cancelled: the page shows the off-pipeline notice instead). The sub-label
 * is the status word, shown only on a two-status stage: `Quote · quoted`.
 */
export function progressFor(status: string) {
  const currentIndex = stageIndexForStatus(status);
  if (currentIndex < 0) return null;
  const stage = LIFECYCLE_STAGES[currentIndex];
  const subLabel = stage.statuses.length > 1 ? projectStatusLabel(status).toLowerCase() : undefined;
  return {
    steps: LIFECYCLE_STAGES.map((s) => ({ key: s.key, label: s.label })),
    currentIndex,
    subLabel,
  };
}

/** Statuses whose arrival fires the confetti (a real transition only). */
export const CELEBRATED_STATUSES: ReadonlySet<string> = new Set(["CONFIRMED", "COMPLETED"]);
