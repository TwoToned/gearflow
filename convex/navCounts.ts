import { v } from "convex/values";
import { literals } from "convex-helpers/validators";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { callerMayRead, requireOrgReadFor } from "./lib/auth";
import type { Resource } from "./lib/permissionsCore";
import { readCounterValues } from "./dashboardCounters";
import { overdueReturnsForOrg } from "./lib/overdueReturns";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { deriveTestTagState } from "./lib/testTagListState";
import { OPEN_MAINTENANCE_STATUSES, OVERDUE_MAINTENANCE_STATUSES, overdueCutoff, type OpenMaintenanceStatus } from "./lib/maintenanceOpen";

/**
 * The phone More sheet's row counts (UX Phase 11, §6d.6, S4): `Assets 605`,
 * `Test & tag 4 overdue`, `Maintenance 20 open · 5 overdue`, `Returns 2 overdue`,
 * `Clients 26`… ONE query, one `source` per row. Finance (`1 overdue`) and
 * Overbookings (`5 overbooked`) reuse their own existing counts queries
 * (`financeOrg.counts`, `overbookingBoard.counts`) rather than a second copy here.
 *
 * Every source is:
 *   • org-guarded on its own resource (`requireOrgReadFor`, literal per case so the
 *     registry knows each scope), and ROLE-checked on it (`callerMayRead`, Q3 —
 *     `requireOrgReadFor` alone does not check a human's role): a role that can't
 *     read the resource gets `null`, never a number;
 *   • read org-index-first, then capped at `NAV_COUNT_CAP + 1`, with `truncated`
 *     set when the cap was hit (the row prints `200+`, never a wrong exact number).
 * No new index (Q5): Clients / Suppliers / Locations / Crew filter on the org index.
 */

export const NAV_COUNT_CAP = 200;
const MIN_TS = -8_640_000_000_000_000;

export const NAV_COUNT_SOURCES = [
  "assets",
  "testTagOverdue",
  "maintenance",
  "returnsOverdue",
  "clients",
  "suppliers",
  "locations",
  // The Crew row (UX Phase 15 owns it, Q10) carries `count: "crew"`.
  "crew",
] as const;
export type NavCountServerSource = (typeof NAV_COUNT_SOURCES)[number];

export type NavCount = {
  value: number;
  /** Maintenance only: how many of the open records are past their date. */
  secondary?: number;
  truncated: boolean;
};

/** `rows` from a `take(NAV_COUNT_CAP + 1)`, kept by `keep`, as a capped count. */
function capped<T>(rows: T[], keep: (r: T) => boolean = () => true): NavCount {
  // Filter FIRST, then cap: an inactive row inside the first CAP must not hide a
  // kept one at CAP + 1 (the read takes CAP + 1, so that row is in hand).
  const kept = rows.filter(keep);
  return { value: Math.min(kept.length, NAV_COUNT_CAP), truncated: rows.length > NAV_COUNT_CAP };
}

async function byOrg<T extends "clients" | "suppliers" | "locations" | "crewMembers">(ctx: QueryCtx, table: T, orgId: string): Promise<Doc<T>[]> {
  const q = ctx.db.query(table) as unknown as {
    withIndex: (n: "by_organizationId", f: (b: { eq: (k: "organizationId", v: string) => unknown }) => unknown) => { take: (n: number) => Promise<Doc<T>[]> };
  };
  return q.withIndex("by_organizationId", (b) => b.eq("organizationId", orgId)).take(NAV_COUNT_CAP + 1);
}

/** Assets: the live counters, O(1) — the same figure as Home's Gear total. Null until seeded. */
async function assetsCount(ctx: QueryCtx, orgId: string): Promise<NavCount | null> {
  const row = await ctx.db
    .query("dashboardCounters")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  if (row?.shardsSeededAt == null) return null;
  const c = await readCounterValues(ctx, orgId);
  return { value: c.activeAssets + c.bulkQuantity, truncated: false };
}

/**
 * Overdue = THE derived definition (`convex/lib/testTagListState.ts`), the Test and tag list's own Overdue word,
 * never the stored OVERDUE the cron writes (it lags). A due date in the past, not retired, not failed.
 */
async function testTagOverdueCount(ctx: QueryCtx, orgId: string, now: number): Promise<NavCount> {
  const rows = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_nextDueDate", (q) => q.eq("organizationId", orgId).gt("nextDueDate", MIN_TS).lt("nextDueDate", now))
    .take(NAV_COUNT_CAP + 1);
  return capped(rows, (r) => deriveTestTagState(r, now, 0) === "OVERDUE");
}

/** Open and overdue = the ONE definitions (lib/maintenanceOpen.ts), the Maintenance page's own Open and Overdue tiles. */
async function maintenanceCount(ctx: QueryCtx, orgId: string, now: number): Promise<NavCount> {
  const open = (status: OpenMaintenanceStatus) =>
    ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId_status_scheduledDate", (q) => q.eq("organizationId", orgId).eq("status", status))
      .take(NAV_COUNT_CAP + 1);
  const late = (status: OpenMaintenanceStatus) =>
    ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId_status_scheduledDate", (q) =>
        q.eq("organizationId", orgId).eq("status", status).gt("scheduledDate", MIN_TS).lt("scheduledDate", overdueCutoff(now)),
      )
      .take(NAV_COUNT_CAP + 1);
  const [opens, lates] = await Promise.all([Promise.all(OPEN_MAINTENANCE_STATUSES.map(open)), Promise.all(OVERDUE_MAINTENANCE_STATUSES.map(late))]);
  const sum = (lists: unknown[][]) => lists.reduce((n, rows) => n + Math.min(rows.length, NAV_COUNT_CAP), 0);
  return {
    value: sum(opens),
    secondary: sum(lates),
    truncated: [...opens, ...lates].some((rows) => rows.length > NAV_COUNT_CAP),
  };
}

/** Returns: overdue-return JOBS, the shared rule (`lib/overdueReturns.ts`, the Home tile's). */
async function returnsOverdueCount(ctx: QueryCtx, orgId: string, now: number): Promise<NavCount> {
  const r = await overdueReturnsForOrg(ctx, orgId, now);
  return { value: r.projectIds.size, truncated: r.truncated };
}

/** The role check on top of the org guard: a role that can't read `resource` gets null. */
async function counted(ctx: QueryCtx, orgId: string, resource: Resource, read: () => Promise<NavCount | null>): Promise<NavCount | null> {
  return (await callerMayRead(ctx, orgId, resource)) ? read() : null;
}

export const get = query({
  args: {
    orgId: v.string(),
    source: literals(...NAV_COUNT_SOURCES),
    /** A stable clock for the date-derived sources (a caller snapshot, never a fresh Date.now()). */
    now: v.number(),
  },
  handler: async (ctx, { orgId, source, now }): Promise<NavCount | null> => {
    switch (source) {
      case "assets":
        await requireOrgReadFor(ctx, orgId, "asset");
        return counted(ctx, orgId, "asset", () => assetsCount(ctx, orgId));
      case "testTagOverdue":
        await requireOrgReadFor(ctx, orgId, "testTag");
        return counted(ctx, orgId, "testTag", () => testTagOverdueCount(ctx, orgId, now));
      case "maintenance":
        await requireOrgReadFor(ctx, orgId, "maintenance");
        return counted(ctx, orgId, "maintenance", () => maintenanceCount(ctx, orgId, now));
      case "returnsOverdue":
        await requireOrgReadFor(ctx, orgId, "warehouse");
        return counted(ctx, orgId, "warehouse", () => returnsOverdueCount(ctx, orgId, now));
      case "clients":
        await requireOrgReadFor(ctx, orgId, "client");
        return counted(ctx, orgId, "client", async () => capped(await byOrg(ctx, "clients", orgId), (c) => c.isActive !== false));
      case "suppliers":
        await requireOrgReadFor(ctx, orgId, "supplier");
        return counted(ctx, orgId, "supplier", async () => capped(await byOrg(ctx, "suppliers", orgId), (s) => s.isActive !== false));
      case "locations":
        await requireOrgReadFor(ctx, orgId, "location");
        return counted(ctx, orgId, "location", async () => capped(await byOrg(ctx, "locations", orgId)));
      case "crew":
        await requireOrgReadFor(ctx, orgId, "crew");
        return counted(ctx, orgId, "crew", async () => capped(await byOrg(ctx, "crewMembers", orgId), (c) => c.status !== "ARCHIVED"));
    }
  },
});

export const agentOps: AgentOpsAnnotations = {
  get: {
    summary: "Count one phone-More-sheet row (assets, overdue test & tag, open/overdue maintenance, overdue returns, clients, suppliers, locations or crew), capped with a truncated flag.",
    danger: "low",
    mcpTier: 3,
  },
};
