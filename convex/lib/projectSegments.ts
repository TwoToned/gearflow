import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { listProjectQuotes } from "./quoteState";

/**
 * Jobs list segments (UX unification §9b.3). ONE definition of which statuses a
 * segment means, read by `projects.listPage` (to filter) and
 * `projects.segmentCounts` (to count) so the strip and the table can never
 * disagree. The client only knows the segment KEYS (`src/lib/list-views/jobs.ts`).
 *
 * `all` is every status except CANCELLED; `needs` is DERIVED on read, never a
 * stored flag (D13).
 */
export const JOB_SEGMENT_STATUSES = {
  quoting: ["ENQUIRY", "QUOTING", "QUOTED"],
  booked: ["AWAITING_PAYMENT", "CONFIRMED", "PREPPING"],
  out: ["CHECKED_OUT", "ON_SITE"],
  done: ["RETURNED", "COMPLETED", "INVOICED"],
} as const;

export type JobSegmentKey = "all" | "needs" | keyof typeof JOB_SEGMENT_STATUSES;

export const JOB_SEGMENT_KEYS: readonly JobSegmentKey[] = ["all", "quoting", "booked", "out", "done", "needs"];

const DAY_MS = 24 * 60 * 60 * 1000;
/** A quote sent this long ago with no movement needs a nudge. */
export const STALE_QUOTE_DAYS = 12;
/** Bound on open blocking threads read for the derived segment (rare by nature). */
const BLOCKING_THREAD_CAP = 1000;

type Project = Doc<"projects">;

/** Pure: does `p` belong in `segment` (not `needs`, which needs the derived id set)? */
export function inStatusSegment(p: Pick<Project, "status">, segment: Exclude<JobSegmentKey, "needs">): boolean {
  if (segment === "all") return p.status !== "CANCELLED";
  return (JOB_SEGMENT_STATUSES[segment] as readonly string[]).includes(p.status ?? "");
}

/** Pure: a CHECKED_OUT / ON_SITE job whose end date has passed. */
export function isOutPastEnd(p: Pick<Project, "status" | "rentalEndDate" | "projectEndDate">, now: number): boolean {
  if (p.status !== "CHECKED_OUT" && p.status !== "ON_SITE") return false;
  const end = p.rentalEndDate ?? p.projectEndDate;
  return end != null && end < now;
}

async function blockedProjectIds(ctx: QueryCtx, orgId: string): Promise<Set<string>> {
  const threads = await ctx.db
    .query("commentThreads")
    .withIndex("by_orgId_isBlocking_status", (q) => q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"))
    .take(BLOCKING_THREAD_CAP);
  return new Set(threads.map((t) => t.projectId ?? t.entityId));
}

/** The newest time a QUOTED job's quote was touched: latest sent/updated quote, else the job's own edit time. */
async function lastQuoteTouch(ctx: QueryCtx, orgId: string, p: Project): Promise<number> {
  const quotes = await listProjectQuotes(ctx, orgId, p.id);
  const touches = quotes.map((q) => q.sentAt ?? q.updatedAt ?? q.createdAt ?? 0);
  return Math.max(p.updatedAt ?? 0, ...touches);
}

async function staleQuotedIds(ctx: QueryCtx, orgId: string, rows: Project[], now: number): Promise<string[]> {
  const quoted = rows.filter((p) => p.status === "QUOTED");
  const touches = await Promise.all(quoted.map((p) => lastQuoteTouch(ctx, orgId, p)));
  return quoted.filter((_, i) => touches[i] < now - STALE_QUOTE_DAYS * DAY_MS).map((p) => p.id);
}

/**
 * Ids of the org's jobs that need a human, derived on read (D13): an unresolved
 * blocking discussion, an `out` job past its end date, or a quote untouched for
 * `STALE_QUOTE_DAYS`. Overbooked / reduced-stock jobs are NOT included: that
 * flag is computed by `computeOverbookedStatus` in `src/lib`, which Convex
 * cannot import, so the job row still shows it as a flag but the segment does
 * not count it (known gap; see the Phase 6b handoff). `rows` is the caller's
 * already-loaded, org-checked project set (templates and cancelled excluded here).
 */
export async function needsYouProjectIds(
  ctx: QueryCtx,
  orgId: string,
  rows: Project[],
  now: number,
): Promise<Set<string>> {
  const live = rows.filter((p) => !p.isTemplate && p.status !== "CANCELLED");
  const [blocked, stale] = await Promise.all([blockedProjectIds(ctx, orgId), staleQuotedIds(ctx, orgId, live, now)]);
  const ids = new Set<string>(stale);
  for (const p of live) {
    if (blocked.has(p.id) || isOutPastEnd(p, now)) ids.add(p.id);
  }
  return ids;
}

export interface JobListFilter {
  statusIn?: string[];
  typeIn?: string[];
  clientIn?: string[];
  pmIn?: string[];
  dateFrom?: number;
  dateTo?: number;
  segment?: JobSegmentKey;
  includeCancelled?: boolean;
}

function matchesList(values: string[] | undefined, v: string | undefined | null): boolean {
  return !values || values.length === 0 || (v != null && values.includes(v));
}

/** Does the job's rental window overlap [from, to]? Open ends match. */
export function overlapsWindow(p: Pick<Project, "rentalStartDate" | "rentalEndDate">, from?: number, to?: number): boolean {
  if (from == null && to == null) return true;
  const start = p.rentalStartDate ?? p.rentalEndDate;
  const end = p.rentalEndDate ?? p.rentalStartDate;
  if (start == null || end == null) return false;
  return (from == null || end >= from) && (to == null || start <= to);
}

/**
 * Pure row filter for `projects.listPage`. With no `segment` it behaves as
 * before (every non-template row, cancelled included); with one, `all` hides
 * CANCELLED unless asked for (`includeCancelled`, or CANCELLED in `statusIn`).
 */
export function matchesJobFilter(p: Project, f: JobListFilter, needsYou: ReadonlySet<string>): boolean {
  if (p.isTemplate) return false;
  if (!matchesList(f.statusIn, p.status) || !matchesList(f.typeIn, p.type)) return false;
  if (!matchesList(f.clientIn, p.clientId) || !matchesList(f.pmIn, p.projectManagerId)) return false;
  if (!overlapsWindow(p, f.dateFrom, f.dateTo)) return false;
  return matchesSegment(p, f, needsYou);
}

function matchesSegment(p: Project, f: JobListFilter, needsYou: ReadonlySet<string>): boolean {
  const seg = f.segment;
  if (!seg) return true;
  if (seg === "needs") return needsYou.has(p.id);
  if (p.status === "CANCELLED") return seg === "all" && (!!f.includeCancelled || !!f.statusIn?.includes("CANCELLED"));
  return inStatusSegment(p, seg);
}
