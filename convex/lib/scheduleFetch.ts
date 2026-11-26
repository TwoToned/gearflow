/**
 * The Schedule's bounded reads (UX Phase 18, spec §9o.7). EVERY document the
 * Schedule reads (projects, lines, models, units) is drawn from ONE
 * `ReadBudget`, so the whole call is bounded however big the org is, and a
 * read the budget could not cover surfaces instead of vanishing:
 *
 * - `truncated`  — ANY part of the read was incomplete: a finished older job may
 *   be missing from the timeline, a job's lines or a model's stock were not read
 *   in full, or the alive scan was cut. The page says so.
 * - `claimsComplete` — false when the budget cut the scan of jobs that hold or
 *   pencil gear; then no job is "none" and no Gear cell is a number (unknown).
 * - a job whose lines (or a model's stock) were beyond the budget reports
 *   clash state `unknown`, never `none` (`deriveJobFacts`).
 *
 * Gear claims never depend on history: every ALIVE job (enquiry through on
 * site) is read through the status index, so a long-running job that started
 * years ago still counts. Only the display of FINISHED jobs reads by start
 * date: first every job that STARTS inside the window (complete, in index
 * order), then older jobs nearest-first under their own allowance. So a cut
 * can only hide a finished job that started before the window AND before every
 * older job already read.
 * No whole-set read anywhere: a `take` or an iterator, always under the budget.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { getProjectWindow } from "./projectWindow";
import { HARD_PROJECT_STATUSES, PENCILLED_PROJECT_STATUSES } from "./availabilityCore";
import { candidateBoardProjects, type DateRange } from "./overbookingBoard";
import { ReadBudget } from "./readBudget";
import { deriveJobFacts, type JobFacts, type ScheduleFlagInput } from "./scheduleBoard";

/** The floor `undefined` sorts to in an index range (see `overbookingFetch.ts`). */
const MIN_TS = -8_640_000_000_000_000;

export interface ScheduleLimits {
  /** Total documents the whole call may read (Convex caps a query at 16,384). */
  reads: number;
  /** Of those, how many older jobs (starting before the window) may be scanned. */
  older: number;
  /** A job with more live lines than this is `unknown`. */
  perProjectLines: number;
  /** A model with more units than this is `unknown`. */
  perModelUnits: number;
}

export const SCHEDULE_LIMITS: ScheduleLimits = { reads: 14_000, older: 1_500, perProjectLines: 1_500, perModelUnits: 2_000 };

export interface ScheduleRead {
  /** The jobs to draw: rental window overlaps the range, not a template, not cancelled. */
  visible: Doc<"projects">[];
  facts: Map<string, JobFacts>;
  models: Doc<"models">[];
  /** clientId → name, for the visible jobs (a client the budget could not cover is absent: the job prints no client). */
  clientNames: Map<string, string>;
  truncated: boolean;
  /** Every alive job was read: the clash words and the Gear numbers are exact. */
  claimsComplete: boolean;
  /** What the clash words and the Gear grid are both derived from: one read, two readings. */
  inputs: ScheduleFlagInput;
}

/** Calendar rule (unchanged from `projectMatchesCalendarWindow`): the bar is the RENTAL window. */
function isVisible(p: Doc<"projects">, range: DateRange): boolean {
  if (p.isTemplate === true || p.status === "CANCELLED") return false;
  if (p.rentalStartDate == null || p.rentalEndDate == null) return false;
  return p.rentalStartDate <= range.end && p.rentalEndDate >= range.start;
}

function hasWindow(p: Doc<"projects">): boolean {
  const { start, end } = getProjectWindow(p);
  return start != null && end != null;
}

function overlapsWindow(p: Doc<"projects">, range: DateRange): boolean {
  const { start, end } = getProjectWindow(p);
  return start != null && end != null && start <= range.end && end >= range.start;
}

type ProjectStatus = NonNullable<Doc<"projects">["status"]>;

interface Scan {
  budget: ReadBudget;
  orgId: string;
  range: DateRange;
  found: Map<string, Doc<"projects">>;
  olderLeft: number;
  /** The display scan is incomplete. */
  truncated: boolean;
  /** The budget cut a scan: gear claims may be missing. */
  claimsCut: boolean;
}

/** Take one document from the shared budget; false (and `truncated`) when it is spent. */
function spend(s: Scan, older: boolean): boolean {
  if (!s.budget.hasRoom) {
    s.truncated = true;
    s.claimsCut = true;
    return false;
  }
  if (older && s.olderLeft <= 0) {
    s.truncated = true;
    return false;
  }
  s.budget.take(1);
  if (older) s.olderLeft -= 1;
  return true;
}

/** Spend the budget on each row of one index scan; false when it ran out (the rest of the scan is cut). */
async function drain(s: Scan, rows: AsyncIterable<Doc<"projects">>, older: boolean, keep: (p: Doc<"projects">) => boolean): Promise<boolean> {
  for await (const p of rows) {
    if (!spend(s, older)) return false;
    if (keep(p)) s.found.set(p.id, p);
  }
  return true;
}

async function scanProjects(ctx: QueryCtx, s: Scan): Promise<void> {
  const { orgId, range } = s;
  const rental = ctx.db.query("projects").withIndex("by_organizationId_rentalStartDate", (q) => q.eq("organizationId", orgId).gte("rentalStartDate", range.start).lte("rentalStartDate", range.end));
  const project = ctx.db.query("projects").withIndex("by_organizationId_projectStartDate", (q) => q.eq("organizationId", orgId).gte("projectStartDate", range.start).lte("projectStartDate", range.end));
  const olderRental = ctx.db
    .query("projects")
    .withIndex("by_organizationId_rentalStartDate", (q) => q.eq("organizationId", orgId).gt("rentalStartDate", MIN_TS).lt("rentalStartDate", range.start))
    .order("desc");
  const olderProject = ctx.db
    .query("projects")
    .withIndex("by_organizationId_projectStartDate", (q) => q.eq("organizationId", orgId).gt("projectStartDate", MIN_TS).lt("projectStartDate", range.start))
    .order("desc");
  // 0. Every alive job overlapping the window (claims); 1. everything that STARTS inside the window, by either date (complete first); 2. older jobs, nearest first, under their own allowance.
  const all = () => true;
  const aliveStatuses = [...HARD_PROJECT_STATUSES, ...PENCILLED_PROJECT_STATUSES] as ProjectStatus[];
  const alive = aliveStatuses.map((status) => () =>
    drain(s, ctx.db.query("projects").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)), false, (p) => p.isTemplate !== true && hasWindow(p)),
  );
  const steps: (() => Promise<boolean>)[] = [
    ...alive,
    () => drain(s, rental, false, all),
    () => drain(s, project, false, all),
    () => drain(s, olderRental, true, (p) => isVisible(p, range) || overlapsWindow(p, range)),
    () => drain(s, olderProject, true, (p) => overlapsWindow(p, range)),
  ];
  for (const step of steps) if (!(await step())) return;
}

/** One project's live lines, or null when they cannot be read in full (no live version, over the cap, budget spent). */
async function readLines(ctx: QueryCtx, orgId: string, p: Doc<"projects">, budget: ReadBudget, cap: number): Promise<Doc<"projectLineItems">[] | null> {
  const versionId = p.liveVersionId;
  const want = Math.min(cap + 1, budget.left);
  if (!versionId || want <= 0) return null;
  const rows = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).take(want);
  budget.take(rows.length);
  if (rows.length > cap || rows.length === want) return null;
  return rows.filter((r) => r.organizationId === orgId);
}

interface Stock {
  models: Doc<"models">[];
  assets: Doc<"assets">[];
  bulkAssets: Doc<"bulkAssets">[];
  unknown: Set<string>;
}

/** The models the lines reference, with their units; a model the budget cannot cover is `unknown`. */
async function readStock(ctx: QueryCtx, orgId: string, modelIds: string[], budget: ReadBudget, cap: number): Promise<Stock> {
  const out: Stock = { models: [], assets: [], bulkAssets: [], unknown: new Set() };
  for (const modelId of modelIds) {
    const want = Math.min(cap + 1, Math.floor((budget.left - 1) / 2));
    if (want <= 0) {
      out.unknown.add(modelId);
      continue;
    }
    budget.take(1);
    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique();
    if (!model || model.organizationId !== orgId) {
      out.unknown.add(modelId);
      continue;
    }
    const assets = await ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).take(want);
    const bulks = await ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).take(want);
    budget.take(assets.length + bulks.length);
    if (assets.length === want || bulks.length === want) {
      out.unknown.add(modelId);
      continue;
    }
    out.models.push(model);
    out.assets.push(...assets.filter((a) => a.organizationId === orgId));
    out.bulkAssets.push(...bulks.filter((b) => b.organizationId === orgId));
  }
  return out;
}

async function readClientNames(ctx: QueryCtx, orgId: string, jobs: Doc<"projects">[], budget: ReadBudget): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(jobs.map((p) => p.clientId).filter((c): c is string => !!c))];
  for (const cid of ids) {
    if (budget.take(1) === 0) break;
    const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", cid)).unique();
    if (c && c.organizationId === orgId) names.set(cid, c.name);
  }
  return names;
}

/**
 * The range the clash words are computed over: the view's range widened to the
 * whole project window of every alive job drawn in it. A job's word is then the
 * same in Week, Month and a deep link: it never depends on how much of the job
 * the view happens to show.
 */
function widen(range: DateRange, jobs: Doc<"projects">[]): DateRange {
  let { start, end } = range;
  for (const p of jobs) {
    const w = getProjectWindow(p);
    if (w.start != null && w.start < start) start = w.start;
    if (w.end != null && w.end > end) end = w.end;
  }
  return { start, end };
}

const ALIVE: ReadonlySet<string> = new Set([...HARD_PROJECT_STATUSES, ...PENCILLED_PROJECT_STATUSES]);

const byWindowStart = (a: Doc<"projects">, b: Doc<"projects">) => (getProjectWindow(a).start ?? 0) - (getProjectWindow(b).start ?? 0);

export async function loadSchedule(ctx: QueryCtx, orgId: string, range: DateRange, limits: ScheduleLimits = SCHEDULE_LIMITS): Promise<ScheduleRead> {
  const budget = new ReadBudget(limits.reads);
  const scan: Scan = { budget, orgId, range, found: new Map(), olderLeft: limits.older, truncated: false, claimsCut: false };
  await scanProjects(ctx, scan);

  const all = [...scan.found.values()];
  const visible = all.filter((p) => isVisible(p, range)).sort(byWindowStart);
  const wide = widen(range, visible.filter((p) => ALIVE.has(p.status ?? "")));
  const alive = candidateBoardProjects(all, wide);
  const aliveDocs = alive.map((b) => scan.found.get(b.id)!).sort(byWindowStart);

  const lines: Doc<"projectLineItems">[] = [];
  const unread = new Set<string>();
  for (const p of aliveDocs) {
    const rows = await readLines(ctx, orgId, p, budget, limits.perProjectLines);
    if (rows) lines.push(...rows);
    else unread.add(p.id);
  }

  const modelIds = [...new Set(lines.map((l) => l.modelId).filter((m): m is string => !!m))];
  const stock = await readStock(ctx, orgId, modelIds, budget, limits.perModelUnits);
  const inputs: ScheduleFlagInput = {
    range: wide, projects: all, lines, unreadProjectIds: unread,
    models: stock.models, assets: stock.assets, bulkAssets: stock.bulkAssets, unknownModelIds: stock.unknown,
    claimsComplete: !scan.claimsCut,
  };
  const clientNames = await readClientNames(ctx, orgId, visible, budget);
  return { visible, facts: deriveJobFacts(inputs), models: stock.models, clientNames, truncated: scan.truncated || unread.size > 0 || stock.unknown.size > 0 || scan.claimsCut, claimsComplete: inputs.claimsComplete, inputs };
}
