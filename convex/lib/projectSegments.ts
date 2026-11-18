import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { hardOverbookedProjectIds } from "../overbookingBoard";

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
export const BLOCKING_THREAD_CAP = 1000;
/** Bound on QUOTED jobs whose quotes are read for the stale-quote rule. */
export const STALE_QUOTE_JOB_CAP = 200;

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

/** The project a thread belongs to, or null for a thread on any other entity. */
export function threadProjectId(t: Pick<Doc<"commentThreads">, "projectId" | "entityType" | "entityId">): string | null {
  if (t.projectId) return t.projectId;
  return t.entityType === "project" ? t.entityId : null;
}

/**
 * Projects with an open blocking discussion. Newest threads first, so the cap is
 * deterministic. The cap (1000 simultaneously OPEN blocking threads in one org)
 * is not realistically reachable: a blocking thread is resolved to unblock prep,
 * so the open set stays tiny; if it were hit, the oldest threads would drop.
 */
async function blockedProjectIds(ctx: QueryCtx, orgId: string): Promise<Set<string>> {
  const threads = await ctx.db
    .query("commentThreads")
    .withIndex("by_orgId_isBlocking_status", (q) => q.eq("orgId", orgId).eq("isBlocking", true).eq("status", "open"))
    .order("desc")
    .take(BLOCKING_THREAD_CAP);
  const ids = new Set<string>();
  for (const t of threads) {
    const pid = threadProjectId(t);
    if (pid) ids.add(pid);
  }
  return ids;
}

/** The newest time a QUOTED job's quote was touched: its newest quote's sent/updated time, else the job's own edit time. */
async function lastQuoteTouch(ctx: QueryCtx, orgId: string, p: Project): Promise<number> {
  // by_projectId_version is global: the org check is part of the read.
  const newest = await ctx.db
    .query("quotes")
    .withIndex("by_projectId_version", (q) => q.eq("projectId", p.id))
    .order("desc")
    .filter((q) => q.eq(q.field("organizationId"), orgId))
    .first();
  const touch = newest ? (newest.sentAt ?? newest.updatedAt ?? newest.createdAt ?? 0) : 0;
  return Math.max(p.updatedAt ?? 0, touch);
}

/**
 * QUOTED jobs whose quote has sat untouched. A job edited inside the window
 * cannot be stale, so only the rest are candidates; at most `STALE_QUOTE_JOB_CAP`
 * of those (most recently edited first) are checked, one bounded read each.
 */
async function staleQuotedIds(ctx: QueryCtx, orgId: string, rows: Project[], now: number): Promise<string[]> {
  const cutoff = now - STALE_QUOTE_DAYS * DAY_MS;
  const candidates = rows
    .filter((p) => p.status === "QUOTED" && (p.updatedAt ?? 0) < cutoff)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, STALE_QUOTE_JOB_CAP);
  const touches = await Promise.all(candidates.map((p) => lastQuoteTouch(ctx, orgId, p)));
  return candidates.filter((_, i) => touches[i] < cutoff).map((p) => p.id);
}

/**
 * Ids of the org's jobs that need a human, derived on read (D13): an unresolved
 * blocking discussion, an `out` job past its end date, a quote untouched for
 * `STALE_QUOTE_DAYS`, or a hard-overbooked job (the Overbookings board's
 * `gear.hard` over its default 30-day horizon, via `hardOverbookedProjectIds`,
 * so the math lives once). The overbooking read only runs for callers of this
 * function, i.e. when `needs` is asked for or counted. `rows` is the caller's
 * already-loaded, org-checked project set (templates and cancelled excluded here).
 */
export async function needsYouProjectIds(
  ctx: QueryCtx,
  orgId: string,
  rows: Project[],
  now: number,
): Promise<Set<string>> {
  const live = rows.filter((p) => !p.isTemplate && p.status !== "CANCELLED");
  const [blocked, stale, overbooked] = await Promise.all([
    blockedProjectIds(ctx, orgId),
    staleQuotedIds(ctx, orgId, live, now),
    hardOverbookedProjectIds(ctx, orgId, now),
  ]);
  const ids = new Set<string>(stale);
  for (const p of live) {
    if (blocked.has(p.id) || overbooked.has(p.id) || isOutPastEnd(p, now)) ids.add(p.id);
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
