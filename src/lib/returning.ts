/**
 * Returning mode's pure client logic (spec §9c.4, D26, D29): outcome totals,
 * the outcome / job filters, the late rule's clock half, and the row text.
 * The board itself is `warehouseFloor.returning` (bounded, org-checked); the
 * late-BACK count comes from there, and the late-still-OUT half needs `now`, so
 * it is derived here with the ONE `isLate` from `convex/lib/warehouseStage.ts`.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { isLate } from "../../convex/lib/warehouseStage";
import { formatWeekdayDayMonth } from "@/lib/formatters";
import { RETURN_OUTCOME_LABELS } from "@/lib/vocabulary";

type ReturningBoard = FunctionReturnType<typeof api.warehouseFloor.returning>;
export type ReturningGroup = ReturningBoard["groups"][number];
export type ReturningLine = ReturningGroup["lines"][number];

/** A return's recorded condition (the server's `returnCond` union). */
export type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

export const RETURN_OUTCOMES =["out", "returned", "damaged", "missing", "late"] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

const DAY = 86_400_000;

/** A job's gear still out is late once its end day has passed (D29). */
function outIsLate(group: Pick<ReturningGroup, "windowEnd">, now: number): boolean {
  return isLate({ status: "CHECKED_OUT" }, group.windowEnd, now);
}

/** Late units on a line: came back late (server) + still out past the end day. */
export function lineLate(line: ReturningLine, group: Pick<ReturningGroup, "windowEnd">, now: number): number {
  return line.lateBack + (outIsLate(group, now) ? line.out : 0);
}

/** Whole days the job's gear is overdue (0 when nothing is out or it isn't late). */
export function overdueDays(group: ReturningGroup, now: number): number {
  if (group.windowEnd == null || group.totals.out === 0 || !outIsLate(group, now)) return 0;
  return Math.max(1, Math.floor((now - group.windowEnd) / DAY));
}

const OUTCOME_COUNT: Record<ReturnOutcome, (l: ReturningLine, g: ReturningGroup, now: number) => number> = {
  out: (l) => l.out,
  returned: (l) => l.back,
  damaged: (l) => l.damaged,
  missing: (l) => l.missing,
  late: (l, g, now) => lineLate(l, g, now),
};

/** The outcome strip's counts, over every listed line. */
export function outcomeTotals(groups: readonly ReturningGroup[], now: number): Record<ReturnOutcome, number> {
  const t = { out: 0, returned: 0, damaged: 0, missing: 0, late: 0 };
  for (const g of groups) {
    for (const l of g.lines) {
      for (const k of RETURN_OUTCOMES) t[k] += OUTCOME_COUNT[k](l, g, now);
    }
  }
  return t;
}

/** Keep only lines with the chosen outcome (and only the chosen job); drop empty groups. */
export function filterReturning(
  groups: readonly ReturningGroup[],
  f: { outcome: ReturnOutcome | null; job: string | null; now: number },
): ReturningGroup[] {
  return groups
    .filter((g) => !f.job || g.projectId === f.job)
    .map((g) => (f.outcome ? { ...g, lines: g.lines.filter((l) => OUTCOME_COUNT[f.outcome!](l, g, f.now) > 0) } : g))
    .filter((g) => g.lines.length > 0);
}

/** `3 out · 5 of 8 back`. */
export function lineProgressText(line: ReturningLine): string {
  const total = line.out + line.back;
  return [line.out > 0 ? `${line.out} out` : null, `${line.back} of ${total} back`].filter(Boolean).join(" · ");
}

/** The outcome dot-words after a line: `2 damaged · 1 missing · 1 late`. */
export function lineOutcomeWords(line: ReturningLine, group: ReturningGroup, now: number): string[] {
  const words: string[] = [];
  const late = lineLate(line, group, now);
  if (line.damaged) words.push(`${line.damaged} ${RETURN_OUTCOME_LABELS.damaged.toLowerCase()}`);
  if (line.missing) words.push(`${line.missing} ${RETURN_OUTCOME_LABELS.missing.toLowerCase()}`);
  if (late) words.push(`${late} ${RETURN_OUTCOME_LABELS.late.toLowerCase()}`);
  return words;
}

/** The group row: `#2341 Gala · due back Tue 17 Nov · 12 out · 1d overdue`. */
export function groupHeadText(group: ReturningGroup, now: number): string {
  const late = overdueDays(group, now);
  return [
    `#${group.projectNumber} ${group.projectName}`,
    group.windowEnd == null ? null : `due back ${formatWeekdayDayMonth(group.windowEnd)}`,
    `${group.totals.out} out`,
    late ? `${late}d overdue` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The first `limit` lines across groups, in order (the phone's `Show 25 more`). */
export function pageGroups(groups: readonly ReturningGroup[], limit: number): ReturningGroup[] {
  const out: ReturningGroup[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    const lines = g.lines.slice(0, left);
    left -= lines.length;
    out.push({ ...g, lines });
  }
  return out;
}

/** Lines a Return verb can act on: scannable, with something still out. */
export function returnableLines(lines: readonly ReturningLine[]): ReturningLine[] {
  return lines.filter((l) => l.scannable && l.out > 0);
}
