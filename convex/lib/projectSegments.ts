import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { hardOverbookedProjectIds } from "../overbookingBoard";
import { overdueReturnsFromRows } from "./overdueReturns";

/**
 * Jobs list segments (UX unification §9b.3). ONE definition of which statuses a
 * segment means, read by `projects.listPage` (to filter) and
 * `projects.segmentCounts` (to count) so the strip and the table can never
 * disagree. The client only knows the segment KEYS (`src/lib/list-views/jobs.ts`).
 *
 * `all` is every status except CANCELLED; `needs` is DERIVED on read, never a
 * stored flag (D13).
 */
const BOOKED = ["AWAITING_PAYMENT", "CONFIRMED", "PREPPING"] as const;
const OUT = ["CHECKED_OUT", "ON_SITE"] as const;

export const JOB_SEGMENT_STATUSES = {
  // D86: Active = Booked + Out, derived from the two lists (the Active jobs tile's
  // counter, `ACTIVE_PROJECT_STATUSES` in lib/counters.ts, is the same set).
  active: [...BOOKED, ...OUT],
  quoting: ["ENQUIRY", "QUOTING", "QUOTED"],
  booked: BOOKED,
  out: OUT,
  done: ["RETURNED", "COMPLETED", "INVOICED"],
} as const;

export type JobSegmentKey = "all" | "needs" | keyof typeof JOB_SEGMENT_STATUSES;

export const JOB_SEGMENT_KEYS: readonly JobSegmentKey[] = ["all", "active", "quoting", "booked", "out", "done", "needs"];

const DAY_MS = 24 * 60 * 60 * 1000;
/** A quote sent this long ago with no movement needs a nudge. */
export const STALE_QUOTE_DAYS = 12;
/** Bound on open blocking threads read for the derived segment (rare by nature). */
export const BLOCKING_THREAD_CAP = 1000;
/** Bound on QUOTED jobs whose quotes are read for the stale-quote rule. */
export const STALE_QUOTE_JOB_CAP = 200;

type Project = Doc<"projects">;

const NOW_SKEW_MS = 48 * 60 * 60 * 1000;

/**
 * The clock the derived `needs` set reads. Callers pass a mount-time snapshot (a
 * fresh `Date.now()` in query args would re-key the subscription), but a client
 * must not steer the overbooking board's read window with it: the caller's value
 * is used only within ±48 h of the server clock, otherwise the server's own.
 */
export function resolveNow(now: number | undefined): number {
  const server = Date.now();
  return now != null && Number.isFinite(now) && Math.abs(now - server) <= NOW_SKEW_MS ? now : server;
}

/** Pure: does `p` belong in `segment` (not `needs`, which needs the derived id set)? */
export function inStatusSegment(p: Pick<Project, "status">, segment: Exclude<JobSegmentKey, "needs">): boolean {
  if (segment === "all") return p.status !== "CANCELLED";
  return (JOB_SEGMENT_STATUSES[segment] as readonly string[]).includes(p.status ?? "");
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
 * blocking discussion, an overdue return (`lib/overdueReturns.ts`, the same
 * definition as Home's tile and the `overdue=1` filter), a quote untouched for
 * `STALE_QUOTE_DAYS`, or a hard-overbooked job (the Overbookings board's
 * `gear.hard` over its default 30-day horizon, via `hardOverbookedProjectIds`,
 * so the math lives once). The overbooking read only runs for callers of this
 * function, i.e. when `needs` is asked for or counted. That is the same bounded
 * work `overbookingBoard.counts` already does for Home's chips; `listPage` calls
 * it only for the `needs` segment and the Jobs page subscribes to
 * `segmentCounts` once with `{ orgId, now }` (filters never re-key it).
 * `callerNow` is clamped by `resolveNow` here, so every caller (`segmentCounts`,
 * `needsYouIds`, `listPage`) is covered. `rows` is the caller's already-loaded,
 * org-checked project set (templates and cancelled excluded here).
 */
export async function needsYouProjectIds(
  ctx: QueryCtx,
  orgId: string,
  rows: Project[],
  callerNow: number | undefined,
): Promise<Set<string>> {
  const now = resolveNow(callerNow);
  const live = rows.filter((p) => !p.isTemplate && p.status !== "CANCELLED");
  const [blocked, stale, overbooked, overdue] = await Promise.all([
    blockedProjectIds(ctx, orgId),
    staleQuotedIds(ctx, orgId, live, now),
    hardOverbookedProjectIds(ctx, orgId, now),
    overdueReturnsFromRows(ctx, live, now),
  ]);
  const ids = new Set<string>(stale);
  for (const p of live) {
    if (blocked.has(p.id) || overbooked.has(p.id) || overdue.projectIds.has(p.id)) ids.add(p.id);
  }
  return ids;
}

/**
 * The jobs behind the Jobs list's `overdue=1` filter (D86): the shared overdue-return
 * set over the caller's already-loaded, org-checked rows. `callerNow` is clamped by
 * `resolveNow`, same as the Needs-you set.
 */
export async function overdueReturnProjectIds(ctx: QueryCtx, rows: Project[], callerNow: number | undefined): Promise<Set<string>> {
  return (await overdueReturnsFromRows(ctx, rows, resolveNow(callerNow))).projectIds;
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
  /** Set only when the `overdue=1` filter is on: the overdue-return ids a row must be in. */
  overdueIds?: ReadonlySet<string>;
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
  if (f.overdueIds && !f.overdueIds.has(p.id)) return false;
  return matchesSegment(p, f, needsYou);
}

function matchesSegment(p: Project, f: JobListFilter, needsYou: ReadonlySet<string>): boolean {
  const seg = f.segment;
  if (!seg) return true;
  if (seg === "needs") return needsYou.has(p.id);
  if (p.status === "CANCELLED") return seg === "all" && (!!f.includeCancelled || !!f.statusIn?.includes("CANCELLED"));
  return inStatusSegment(p, seg);
}
