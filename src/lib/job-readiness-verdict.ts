import { isPastPrep } from "@/lib/job-lifecycle";
import { OUT_LABEL } from "@/lib/vocabulary";
import type { ReadinessCheck } from "@/lib/project-readiness-checks";

/**
 * The Overview's readiness section as words (spec §6b, UX Phase 7): a verdict
 * headline, a lead sentence carrying the first blocker and its one link, the
 * remaining failing checks as rows (the first {@link READINESS_VISIBLE_ROWS}
 * shown, `and n more` expands), and the checks that are clear.
 *
 * From Out onward the checklist has done its job: the section becomes a
 * one-line state sentence, and only the checks that still matter once the gear
 * has left (open incidents, a blocking discussion) list under it when failing.
 *
 * Pure: the rules live in `project-readiness-checks.ts`; this only decides how
 * they read. `unknown` is never clear (it sits with the things to sort).
 */
export const READINESS_VISIBLE_ROWS = 3;

export interface ReadinessVerdict {
  mode: "checklist" | "state";
  tone: "held" | "todo" | "clear" | "state";
  headline: string;
  lead: string | null;
  /** The blocker the lead names; its fix is the lead's link. */
  leadCheck: ReadinessCheck | null;
  /** Failing checks after the lead's, worst first. */
  rows: ReadinessCheck[];
  clear: ReadinessCheck[];
}

const SEVERITY_ORDER = { blocking: 0, unknown: 1, warning: 2, pass: 3 } as const;
const STILL_MATTERS_WHEN_OUT: ReadonlySet<ReadinessCheck["id"]> = new Set(["incidents", "discussions"]);

const STATE_SENTENCE: Record<string, string> = {
  CHECKED_OUT: `${OUT_LABEL} — the gear has left the warehouse.`,
  ON_SITE: "On site — the gear is with the job.",
  RETURNED: "Returned — the gear is back in the warehouse.",
  COMPLETED: "Completed — this job is closed out.",
  INVOICED: "Invoiced — this job is closed out.",
  CANCELLED: "Cancelled — off the pipeline; its reservations are released.",
};

function failingWorstFirst(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks
    .filter((c) => c.severity !== "pass")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SEVERITY_ORDER[a.c.severity] - SEVERITY_ORDER[b.c.severity] || a.i - b.i)
    .map(({ c }) => c);
}

function stateVerdict(status: string, failing: ReadinessCheck[]): ReadinessVerdict {
  return {
    mode: "state",
    tone: "state",
    headline: STATE_SENTENCE[status] ?? status,
    lead: null,
    leadCheck: null,
    rows: failing.filter((c) => STILL_MATTERS_WHEN_OUT.has(c.id)),
    clear: [],
  };
}

function leadSentence(c: ReadinessCheck): string {
  return c.detail ? `${c.title}. ${c.detail}` : `${c.title}.`;
}

export function readinessVerdict(checks: ReadinessCheck[], status: string): ReadinessVerdict {
  const failing = failingWorstFirst(checks);
  if (isPastPrep(status)) return stateVerdict(status, failing);

  const clear = checks.filter((c) => c.severity === "pass");
  const first = failing[0];
  if (first?.severity === "blocking") {
    return { mode: "checklist", tone: "held", headline: "Prep is held", lead: leadSentence(first), leadCheck: first, rows: failing.slice(1), clear };
  }
  if (failing.length > 0) {
    const n = failing.length;
    return {
      mode: "checklist",
      tone: "todo",
      headline: "Not ready for prep yet",
      lead: `${n} ${n === 1 ? "thing" : "things"} to sort before the gear leaves.`,
      leadCheck: null,
      rows: failing,
      clear,
    };
  }
  return { mode: "checklist", tone: "clear", headline: "Ready for prep", lead: "Every check is clear.", leadCheck: null, rows: [], clear };
}
