import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import { findLiveQuote } from "./lib/quoteState";
import { resolveOrgWorkConfig } from "./lib/orgSettings";
import { daysSinceInTimezone, rottingLevel, type RottingLevel } from "./lib/rottingDates";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Pipeline view (#1245, design §8.4/§13): "the project board filtered to
 * ENQUIRY → QUOTING → QUOTED → CONFIRMED, sorted by next-step date, reachable
 * as Clients → Pipeline. No new object — the project is the deal."
 *
 * Phase 2's revived, drag-drop `project-board.tsx` had not merged at the
 * time this shipped (checked against `origin/main` — see the PR body), so
 * this is a standalone read-only query + page rather than a mode of that
 * component. Re-point this at the Phase 2 board once it lands, if that
 * board grows a "pipeline" filter preset of its own — the data shape here
 * (rotting level + next-step date per project) is exactly what a board card
 * needs either way.
 */

const PIPELINE_STATUSES = new Set(["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED"]);
// Bounds the scan the same way every other org-wide dashboard read does
// (dashboardLists.ts's MANAGED_PROJECTS_LIMIT) — newest-first, capped.
const PIPELINE_LIMIT = 200;

export interface PipelineCard {
  projectId: string;
  projectNumber: string;
  projectName: string;
  status: string;
  clientId: string | null;
  clientName: string | null;
  nextStepDate: number | null;
  nextStepTitle: string | null;
  daysSinceTouch: number | null;
  rotting: RottingLevel;
}

/** The soonest open `follow_up` linked to `clientId`, if any — mirrors
 *  `clientTimeline.ts`'s `nextStep` query but returns just the bit a board
 *  card needs, for a bounded set of clients in one pass. */
async function loadNextStepsByClient(ctx: QueryCtx, orgId: string, clientIds: string[]) {
  const result = new Map<string, { title: string; dueDate: number } | null>();
  await Promise.all(
    [...new Set(clientIds)].map(async (clientId) => {
      const links = await ctx.db
        .query("workItemLinks")
        .withIndex("by_organizationId_entityType_entityId", (q) =>
          q.eq("organizationId", orgId).eq("entityType", "client").eq("entityId", clientId),
        )
        .collect();
      const items = await Promise.all(
        links.map((l) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", l.workItemId)).first()),
      );
      const open = items
        .filter((t): t is NonNullable<typeof t> => t != null && t.kind === "follow_up" && t.status !== "DONE" && t.status !== "CANCELLED" && t.dueDate != null)
        .sort((a, b) => (a.dueDate as number) - (b.dueDate as number));
      result.set(clientId, open[0] ? { title: open[0].title, dueDate: open[0].dueDate as number } : null);
    }),
  );
  return result;
}

/** The latest of a client's own quotes' sent/accepted/declined timestamps —
 *  split out of `loadLastTouchByClient` (R-3.6) purely to keep that
 *  function's own complexity down. */
function latestQuoteTouch(quotes: { organizationId: string; sentAt?: number; acceptedAt?: number; declinedAt?: number }[], orgId: string): number {
  let latest = 0;
  for (const q of quotes) {
    if (q.organizationId !== orgId) continue;
    latest = Math.max(latest, q.sentAt ?? 0, q.acceptedAt ?? 0, q.declinedAt ?? 0);
  }
  return latest;
}

/** One client's last-touch computation — split out of `loadLastTouchByClient`
 *  so the `Promise.all(...)` map callback itself stays simple. */
async function clientLastTouch(ctx: QueryCtx, orgId: string, clientId: string, projectIds: string[]): Promise<number> {
  const [client, quoteLists, events] = await Promise.all([
    ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first(),
    Promise.all(projectIds.map((pid) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", pid)).collect())),
    ctx.db.query("activityEvents").withIndex("by_orgId_clientId_createdAt", (q) => q.eq("orgId", orgId).eq("clientId", clientId)).order("desc").take(1),
  ]);
  const latest = Math.max(
    client?.updatedAt ?? client?.createdAt ?? 0,
    latestQuoteTouch(quoteLists.flat(), orgId),
    events[0]?.createdAt ?? 0,
  );
  return latest;
}

/** Last timeline touch per client — the max of its clients' own row plus its
 *  projects' most recent quote send (the two cheapest, always-present
 *  signals; a full `clientTimeline.forClient` union per card would be far
 *  more read than a board needs). Falls back to the client's `updatedAt`
 *  when neither is present, so a brand-new client isn't misread as "ancient". */
async function loadLastTouchByClient(
  ctx: QueryCtx,
  orgId: string,
  entries: { clientId: string; projectId: string }[],
): Promise<Map<string, number>> {
  const byClient = new Map<string, string[]>();
  for (const e of entries) {
    byClient.set(e.clientId, [...(byClient.get(e.clientId) ?? []), e.projectId]);
  }
  const result = new Map<string, number>();
  await Promise.all(
    [...byClient.entries()].map(async ([clientId, projectIds]) => {
      result.set(clientId, await clientLastTouch(ctx, orgId, clientId, projectIds));
    }),
  );
  return result;
}

/** A deal whose OWN quote is out but no next step is logged falls back to the
 *  quote's `sentAt` — its next-step date isn't available, and surfacing it
 *  as overdue-since-send is closer to the design intent ("sorted by
 *  next-step date") than silently sorting it last. */
async function resolveNextStepDate(
  ctx: QueryCtx,
  orgId: string,
  projectId: string,
  now: number,
  next: { dueDate: number } | null,
): Promise<number | null> {
  if (next) return next.dueDate;
  const liveQuote = await findLiveQuote(ctx, orgId, projectId, now);
  return liveQuote?.sentAt ?? null;
}

type PipelineClientData = {
  nextSteps: Map<string, { title: string; dueDate: number } | null>;
  lastTouches: Map<string, number>;
  clientNames: Map<string, string>;
  work: { timezone: string | undefined; rottingAmberDays: number; rottingErrorDays: number };
};

/** The client-dependent lookups a card needs, resolved once — split out of
 *  `buildPipelineCard` (R-3.6) so a clientless deal (a personal/unassigned
 *  project, rare but possible) is one guard instead of three repeated
 *  ternaries. */
function resolveClientContext(
  clientId: string | null,
  data: PipelineClientData,
): { next: { title: string; dueDate: number } | null; lastTouch: number | undefined; clientName: string | null } {
  if (!clientId) return { next: null, lastTouch: undefined, clientName: null };
  return {
    next: data.nextSteps.get(clientId) ?? null,
    lastTouch: data.lastTouches.get(clientId),
    clientName: data.clientNames.get(clientId) ?? null,
  };
}

/** One project's pipeline card — split out of `forOrg` (R-3.6) to keep the
 *  per-deal `Promise.all(...)` map callback simple. */
async function buildPipelineCard(
  ctx: QueryCtx,
  orgId: string,
  now: number,
  p: Doc<"projects">,
  data: PipelineClientData,
): Promise<PipelineCard> {
  const clientId = p.clientId ?? null;
  const { next, lastTouch, clientName } = resolveClientContext(clientId, data);
  const daysSinceTouch = lastTouch != null ? daysSinceInTimezone(lastTouch, now, data.work.timezone) : null;
  const nextStepDate = await resolveNextStepDate(ctx, orgId, p.id, now, next);
  return {
    projectId: p.id,
    projectNumber: p.projectNumber,
    projectName: p.name,
    status: p.status ?? "ENQUIRY",
    clientId,
    clientName,
    nextStepDate,
    nextStepTitle: next?.title ?? null,
    daysSinceTouch,
    rotting: daysSinceTouch != null ? rottingLevel(daysSinceTouch, data.work.rottingAmberDays, data.work.rottingErrorDays) : "none",
  };
}

export const forOrg = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "project");

    const rows = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(PIPELINE_LIMIT);
    const deals = rows.filter((p) => p.isTemplate !== true && PIPELINE_STATUSES.has(p.status ?? ""));

    const clientIds = [...new Set(deals.map((p) => p.clientId).filter((x): x is string => !!x))];
    const [clients, nextSteps, lastTouches, work] = await Promise.all([
      Promise.all(clientIds.map((id) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
      loadNextStepsByClient(ctx, orgId, clientIds),
      loadLastTouchByClient(ctx, orgId, deals.map((p) => ({ clientId: p.clientId as string, projectId: p.id })).filter((e) => e.clientId)),
      resolveOrgWorkConfig(ctx, orgId),
    ]);
    const clientNames = new Map(clients.filter((c): c is NonNullable<typeof c> => c != null).map((c) => [c.id, c.name]));

    const cards: PipelineCard[] = await Promise.all(
      deals.map((p) => buildPipelineCard(ctx, orgId, now, p, { nextSteps, lastTouches, clientNames, work })),
    );

    cards.sort((a, b) => {
      if (a.nextStepDate == null && b.nextStepDate == null) return 0;
      if (a.nextStepDate == null) return 1;
      if (b.nextStepDate == null) return -1;
      return a.nextStepDate - b.nextStepDate;
    });
    return cards;
  },
});

export const agentOps: AgentOpsAnnotations = {
  forOrg: { summary: "The client pipeline: ENQUIRY/QUOTING/QUOTED/CONFIRMED deals sorted by next-step date, with rotting shading.", danger: "low", mcpTier: 2 },
};
