import { v, ConvexError } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { deriveGearGrid } from "./lib/gearGrid";
import { callerMayRead, requireOrgReadFor } from "./lib/auth";
import { isConfirmedOrLater } from "./lib/availabilityCore";
import type { Doc } from "./_generated/dataModel";
import { loadSchedule } from "./lib/scheduleFetch";
import type { JobFacts } from "./lib/scheduleBoard";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * The Schedule's Jobs read (UX Phase 18, spec §9o.7, FEATUREDOCS/11): the jobs
 * whose RENTAL window overlaps `[startMs, endMs]`, each with the derived
 * `clash` / `would clash` word from the Overbookings board's own claim math
 * (`convex/lib/scheduleBoard.ts`), and its gear summary. ONE-SHOT-sized and
 * bounded: every document comes from one `ReadBudget` (`scheduleFetch.ts`), a
 * cut is reported as `truncated`, and a job whose check could not run says
 * `unknown`, never "no clash". The range is bounded (two months at most) and
 * comes from the URL's week or month, so the args are a stable subscription key.
 */
const MAX_RANGE_DAYS = 62;

/** What a job reads as when no facts exist for it: not checked (never "no clash"). */
const UNCHECKED: JobFacts = { state: "unknown", rows: [], modelCount: null, modelIds: [], lineCount: null, unitCount: null };

function jobRow(p: Doc<"projects">, f: JobFacts, clientNames: Map<string, string>) {
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? "ENQUIRY",
    // Held = holds its gear (confirmed or later); pencilled holds nothing (availabilityCore).
    holds: isConfirmedOrLater(p.status),
    clientId: p.clientId ?? null,
    clientName: clientNames.get(p.clientId ?? "") ?? null,
    projectManagerId: p.projectManagerId ?? null,
    rentalStart: p.rentalStartDate!,
    rentalEnd: p.rentalEndDate!,
    // The stored job window sides (null = same as rental, R-3.1): a date move carries a SET window by the same offset.
    windowStart: p.projectStartDate ?? null,
    windowEnd: p.projectEndDate ?? null,
    clash: f.state,
    clashes: f.rows,
    modelCount: f.modelCount,
    modelIds: f.modelIds,
    lineCount: f.lineCount,
    unitCount: f.unitCount,
  };
}

const DAY_MS = 86_400_000;

/** The shared guard: org read, the caller's own role, and a bounded range. */
async function authorise(ctx: QueryCtx, orgId: string, startMs: number, endMs: number): Promise<void> {
  await requireOrgReadFor(ctx, orgId, "project");
  if (!(await callerMayRead(ctx, orgId, "project"))) {
    throw new ConvexError({ code: "FORBIDDEN", message: "You do not have access to jobs." });
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > MAX_RANGE_DAYS * DAY_MS) {
    throw new ConvexError({ code: "INVALID_RANGE", message: `The schedule range must be 1 to ${MAX_RANGE_DAYS} days.` });
  }
}

/**
 * The Gear view (D81, spec §9o.4): the free count per model per day over the
 * range, for every model a job holds or pencils in it. Same read, same budget
 * and same claim math as `jobs` (`convex/lib/gearGrid.ts`); a cell the read could
 * not cover in full is `unknown`, never a number.
 */
export const grid = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await authorise(ctx, orgId, startMs, endMs);
    const read = await loadSchedule(ctx, orgId, { start: startMs, end: endMs });
    const dayStarts: number[] = [];
    for (let d = Math.floor(startMs / DAY_MS) * DAY_MS; d <= endMs; d += DAY_MS) dayStarts.push(d);
    return { truncated: read.truncated, claimsComplete: read.claimsComplete, dayStarts, rows: deriveGearGrid(read.inputs, dayStarts) };
  },
});

export const jobs = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await authorise(ctx, orgId, startMs, endMs);
    const { visible, facts, models, clientNames, truncated } = await loadSchedule(ctx, orgId, { start: startMs, end: endMs });
    return {
      truncated,
      models: models.map((m) => ({ id: m.id, name: m.name, categoryId: m.categoryId ?? null })),
      jobs: visible.map((p) => jobRow(p, facts.get(p.id) ?? UNCHECKED, clientNames)),
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  grid: {
    summary: "The free gear count per model per day over a date range (held and pencilled demand, from the overbooking engine claims).",
    danger: "low",
    mcpTier: 3,
  },
  jobs: {
    summary: "The jobs whose rental window overlaps a date range, each with a clash / would-clash flag derived from the overbooking engine.",
    danger: "low",
    mcpTier: 3,
  },
};
