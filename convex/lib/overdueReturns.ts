import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Overdue returns: ONE definition (UX Phase 11, D85/D86, R-3.1).
 *
 * A job is an overdue return when ALL of the following hold:
 * - it is not a template;
 * - its status is not terminal (RETURNED, COMPLETED, INVOICED or CANCELLED);
 * - its end date, `rentalEndDate ?? projectEndDate`, has passed;
 * - at least one line on its LIVE version is still CHECKED_OUT.
 *
 * Three surfaces read it:
 * - Home's Overdue returns tile (`dashboardStats.bundle`): jobs, with the line count as its sub-line;
 * - the Jobs list's `overdue=1` filter (`projects.listPage`);
 * - the Jobs "Needs you" set (`needsYouProjectIds`).
 * So the number a tile shows is the list it opens.
 *
 * Gear is checked, not status: a part-deployed PREPPING job with gear out past
 * its end is overdue. An `Out` job whose gear is all back is not.
 *
 * Bounded twice:
 * - at most `OVERDUE_PROBE_CAP` past-end candidates are probed for out lines,
 *   most recently ended first;
 * - each probe reads at most `OVERDUE_LINE_CAP` lines.
 * Either cap being hit sets `truncated`, so a caller can print `n+`, never a
 * wrong exact number.
 */

/** Statuses that end the gear's time out; a job in one of them is never an overdue return. */
export const RETURN_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["RETURNED", "COMPLETED", "INVOICED", "CANCELLED"]);

/** Every non-terminal status, read one index range at a time (org + status in the index). */
const OPEN_STATUSES = [
  "ENQUIRY",
  "QUOTING",
  "QUOTED",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
] as const;

/** Per-status bound on open jobs read (open work is small by nature; stale enquiries are the long tail). */
export const OVERDUE_STATUS_CAP = 1000;
/** Bound on past-end candidates probed for CHECKED_OUT lines. */
export const OVERDUE_PROBE_CAP = 500;
/** Bound on CHECKED_OUT lines counted per job. */
export const OVERDUE_LINE_CAP = 1000;

type Project = Doc<"projects">;

export interface OverdueReturns {
  /** Overdue-return job ids. */
  projectIds: Set<string>;
  /** CHECKED_OUT live lines across those jobs (the tile's sub-line). */
  lineCount: number;
  /** A cap was hit: the counts are a lower bound. */
  truncated: boolean;
}

/** The end date the gear is due back by. */
export function returnDueAt(p: Pick<Project, "rentalEndDate" | "projectEndDate">): number | undefined {
  return p.rentalEndDate ?? p.projectEndDate ?? undefined;
}

/** Pure: could `p` be an overdue return at `now` (everything but the line check)? */
export function isOverdueCandidate(
  p: Pick<Project, "isTemplate" | "status" | "rentalEndDate" | "projectEndDate" | "liveVersionId">,
  now: number,
): boolean {
  if (p.isTemplate === true || RETURN_TERMINAL_STATUSES.has(p.status ?? "")) return false;
  const due = returnDueAt(p);
  // A job with no live version has no version-scoped lines to be out (pre-#1228 backfill).
  return due != null && due < now && !!p.liveVersionId;
}

/**
 * From an org's already-loaded, org-checked project rows (the Jobs list loads them
 * anyway): probe the candidates' live versions for CHECKED_OUT lines.
 */
export async function overdueReturnsFromRows(ctx: QueryCtx, rows: readonly Project[], now: number): Promise<OverdueReturns> {
  const candidates = rows
    .filter((p) => isOverdueCandidate(p, now))
    .sort((a, b) => (returnDueAt(b) ?? 0) - (returnDueAt(a) ?? 0) || (a.id < b.id ? -1 : 1));
  const probed = candidates.slice(0, OVERDUE_PROBE_CAP);
  let truncated = candidates.length > OVERDUE_PROBE_CAP;

  const outLines = await Promise.all(
    probed.map((p) =>
      ctx.db
        .query("projectLineItems")
        .withIndex("by_versionId_status", (q) => q.eq("versionId", p.liveVersionId as string).eq("status", "CHECKED_OUT"))
        .take(OVERDUE_LINE_CAP + 1),
    ),
  );

  const projectIds = new Set<string>();
  let lineCount = 0;
  probed.forEach((p, i) => {
    const lines = outLines[i];
    if (lines.length === 0) return;
    if (lines.length > OVERDUE_LINE_CAP) truncated = true;
    projectIds.add(p.id);
    lineCount += Math.min(lines.length, OVERDUE_LINE_CAP);
  });
  return { projectIds, lineCount, truncated };
}

/**
 * The org's overdue returns, reading only its OPEN jobs: one `by_organizationId_status`
 * range per non-terminal status (org and status in the index, then the cap), never
 * the org's whole project history.
 */
export async function overdueReturnsForOrg(ctx: QueryCtx, orgId: string, now: number): Promise<OverdueReturns> {
  const perStatus = await Promise.all(
    OPEN_STATUSES.map((status) =>
      ctx.db
        .query("projects")
        .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status))
        .take(OVERDUE_STATUS_CAP + 1),
    ),
  );
  const statusTruncated = perStatus.some((rows) => rows.length > OVERDUE_STATUS_CAP);
  const rows = perStatus.flatMap((r) => r.slice(0, OVERDUE_STATUS_CAP));
  const result = await overdueReturnsFromRows(ctx, rows, now);
  return { ...result, truncated: result.truncated || statusTruncated };
}
