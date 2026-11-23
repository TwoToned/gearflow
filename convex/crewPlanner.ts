import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { computeServicesMissingCrew, type BoardAssignment } from "./lib/overbookingBoard";
import { isLiveVersionRow } from "./lib/projectLocks";
import { serviceTypeToPhase } from "./lib/serviceSchedule";

/**
 * Crew planner reads (UX Phase 15, spec §9h). The planner grid itself still
 * reads `crewAvailability.plannerData`; this module holds what the grid has no
 * row for — the calls nobody is on yet (`Needs crew`).
 */

const DAY_MS = 86_400_000;
/** The planner shows one week (D46); a fortnight of headroom covers the phone's week-step. */
const OPEN_CALLS_MAX_RANGE_DAYS = 14;
/** Services read per call — far above one org's week; past it the result says `truncated`. */
const OPEN_CALLS_SERVICE_CAP = 500;
/** How far back a multi-day service may start and still run into the window (a month-long install). */
const MULTI_DAY_LOOKBACK_DAYS = 31;

/** Does the service's [date, endDate] reach the window (its start is already ≤ the window's end)? */
function overlapsWindow(s: Doc<"projectServices">, startMs: number): boolean {
  return Math.max(s.date ?? 0, s.endDate ?? 0) >= startMs;
}

export const agentOps: AgentOpsAnnotations = {
  openCalls: { summary: "Crew calls still short of people over a date range (the planner's Needs crew list): live-version services whose filled crew is below crewCountRequired.", danger: "low", mcpTier: 2 },
};

function assertRange(startMs: number, endMs: number): void {
  if (endMs < startMs) throw new ConvexError("crewPlanner.openCalls: endMs must be >= startMs");
  if (endMs - startMs > OPEN_CALLS_MAX_RANGE_DAYS * DAY_MS) {
    throw new ConvexError(`crewPlanner.openCalls: range exceeds ${OPEN_CALLS_MAX_RANGE_DAYS} days`);
  }
}

/** The in-org, non-template, non-cancelled projects the services point at (by_cuid is GLOBAL — org-checked). */
async function liveProjects(ctx: QueryCtx, orgId: string, projectIds: string[]): Promise<Map<string, Doc<"projects">>> {
  const docs = await Promise.all(projectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first()));
  const out = new Map<string, Doc<"projects">>();
  for (const p of docs) {
    if (p && p.organizationId === orgId && !p.isTemplate && p.status !== "CANCELLED") out.set(p.id, p);
  }
  return out;
}

/** A service counts only on a live job, and only in that job's LIVE version (versions copy every service). */
function onLiveJob(s: Doc<"projectServices">, projects: Map<string, Doc<"projects">>): boolean {
  const p = projects.get(s.projectId);
  return !!p && isLiveVersionRow(p, s.versionId);
}

/** Calls read per service — a service's crew is a handful; far past any real `crewCountRequired`. */
const ASSIGNMENTS_PER_SERVICE_CAP = 200;

async function assignmentsByService(ctx: QueryCtx, orgId: string, services: Doc<"projectServices">[]): Promise<Map<string, BoardAssignment[]>> {
  const groups = await Promise.all(
    services.map((s) => ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", s.id)).take(ASSIGNMENTS_PER_SERVICE_CAP)),
  );
  return new Map(services.map((s, i) => [s.id, groups[i].filter((a) => a.organizationId === orgId)]));
}

/**
 * Calls still short of people in [startMs, endMs]: every live-version service
 * on a live job whose filled crew (DECLINED/CANCELLED excluded) is below its
 * `crewCountRequired`. The gap rule is the Overbookings board's own
 * (`computeServicesMissingCrew`), not a second one. Bounded both ends on
 * `by_organizationId_date`, capped, and `truncated` says when the cap bit.
 */
export const openCalls = query({
  args: { orgId: v.string(), startMs: v.number(), endMs: v.number() },
  handler: async (ctx, { orgId, startMs, endMs }) => {
    await requireOrgReadFor(ctx, orgId, "crew");
    assertRange(startMs, endMs);
    // VERSION-SCOPE: an org-wide date-range scan across every version's services
    // by design; `onLiveJob` below keeps only each job's LIVE-version rows.
    // A multi-day service that STARTED before the window but runs into it is
    // still open in it, so the scan reaches back `MULTI_DAY_LOOKBACK_DAYS` and
    // keeps every service whose [date, endDate] overlaps the window.
    const scanFrom = startMs - MULTI_DAY_LOOKBACK_DAYS * DAY_MS;
    const ranged = await ctx.db
      .query("projectServices")
      .withIndex("by_organizationId_date", (q) => q.eq("organizationId", orgId).gte("date", scanFrom).lte("date", endMs))
      .take(OPEN_CALLS_SERVICE_CAP + 1);
    const truncated = ranged.length > OPEN_CALLS_SERVICE_CAP;
    const capped = ranged
      .slice(0, OPEN_CALLS_SERVICE_CAP)
      .filter((s) => (s.crewCountRequired ?? 0) > 0 && overlapsWindow(s, startMs));

    const projects = await liveProjects(ctx, orgId, [...new Set(capped.map((s) => s.projectId))]);
    const services = capped.filter((s) => onLiveJob(s, projects));
    const byService = await assignmentsByService(ctx, orgId, services);
    const refs = new Map([...projects.values()].map((p) => [p.id, { id: p.id, name: p.name, projectNumber: p.projectNumber }]));
    // The board's gap rule, over the scanned span (the window overlap is already applied above).
    const rows = computeServicesMissingCrew({ start: scanFrom, end: endMs }, services, byService, refs);

    const serviceById = new Map(services.map((s) => [s.id, s]));
    const roleIds = [...new Set(services.map((s) => s.crewRoleId).filter((x): x is string => !!x))];
    const roles = await Promise.all(roleIds.map((id) => ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", id)).first()));
    const roleName = new Map(roles.filter((r) => r && r.organizationId === orgId).map((r) => [r!.id, r!.name]));

    const calls = rows.map((r) => {
      const s = serviceById.get(r.serviceId)!;
      return {
        ...r,
        endDate: s.endDate ?? null,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        crewRoleId: s.crewRoleId ?? null,
        crewRoleName: s.crewRoleId ? roleName.get(s.crewRoleId) ?? null : null,
        // The phase a call on this service staffs: the planner's Offer a call
        // creates the assignment with it (the service write path's own mapping).
        phase: serviceTypeToPhase(s.type),
      };
    });
    return { calls, truncated };
  },
});
