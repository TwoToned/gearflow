import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import { requireClientInOrg, listClientProjects } from "./lib/clientScope";
import { effectiveQuoteStatus, quoteLabel } from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Unified client timeline read model (#1245, design §8.4/§13): "quote sent /
 * accepted / declined / expired; invoice issued / paid; job confirmed /
 * completed; comments and mentions; work done; logged calls / emails /
 * notes" — one chronological stream, unioning `quotes`/`invoices`/`payments`
 * (finance events, read directly off the domain rows rather than parsed out
 * of the audit log — those rows ARE the source of truth for "when was this
 * quote sent"), `activityLogs` (project lifecycle transitions), `activityEvents`
 * (comments/mentions AND human-logged touches — `clientTimelineWrites.ts`
 * stores logged entries there too), and `workItemLinks` (work done).
 *
 * Every read here is either a direct indexed lookup (`invoices.by_clientId`,
 * `activityEvents.by_orgId_clientId_createdAt`) or a bounded fan-out over
 * the client's own (capped) project list — never an org-wide scan.
 */

const TIMELINE_LIMIT = 200;

export type TimelineCategory = "money" | "work" | "comment" | "logged";

export interface TimelineRow {
  id: string;
  at: number;
  category: TimelineCategory;
  action: string;
  summary: string;
  actorName?: string;
  projectId?: string;
  projectNumber?: string;
}

function projectLabelFor(projects: Map<string, Doc<"projects">>, projectId?: string) {
  if (!projectId) return undefined;
  return projects.get(projectId)?.projectNumber;
}

type MoneyRowBase = Pick<TimelineRow, "id" | "at" | "category" | "action" | "summary"> & { projectId?: string; projectNumber?: string };

/** One quote's own event rows (sent/accepted/declined/recalled/expired) —
 *  split out of `quoteRows` (R-3.6) purely to keep that loop's own
 *  complexity down; each event is an independent, easily-read fact about
 *  ONE quote row. EXPIRED is derived, never stored (CLAUDE.md /
 *  quoteState.ts) — only synthesised when the quote reads as expired RIGHT
 *  NOW and hasn't been superseded by an outcome that already has its own row. */
function quoteEventRows(q: Doc<"quotes">, label: string, common: { projectId: string; projectNumber?: string }, now: number): MoneyRowBase[] {
  const rows: MoneyRowBase[] = [];
  if (q.sentAt != null) rows.push({ id: `quote:${q.id}:sent`, at: q.sentAt, category: "money", action: "quote_sent", summary: `Quote ${label} sent` });
  if (q.acceptedAt != null) rows.push({ id: `quote:${q.id}:accepted`, at: q.acceptedAt, category: "money", action: "quote_accepted", summary: `Quote ${label} accepted` });
  if (q.declinedAt != null) {
    rows.push({ id: `quote:${q.id}:declined`, at: q.declinedAt, category: "money", action: "quote_declined", summary: `Quote ${label} declined${q.declineReason ? `: ${q.declineReason}` : ""}` });
  }
  if (q.recalledAt != null) rows.push({ id: `quote:${q.id}:recalled`, at: q.recalledAt, category: "money", action: "quote_recalled", summary: `Quote ${label} recalled` });
  const isLive = q.acceptedAt == null && q.declinedAt == null;
  if (isLive && q.validUntil != null && effectiveQuoteStatus(q, now) === "EXPIRED") {
    rows.push({ id: `quote:${q.id}:expired`, at: q.validUntil, category: "money", action: "quote_expired", summary: `Quote ${label} expired` });
  }
  return rows.map((r) => ({ ...r, ...common }));
}

/** Quote sent/accepted/declined/recalled/expired rows, read directly off the
 *  `quotes` table (the row that stamped each timestamp), not parsed out of
 *  an audit-log summary string. */
function quoteRows(quotes: Doc<"quotes">[], projects: Map<string, Doc<"projects">>, now: number): TimelineRow[] {
  return quotes.flatMap((q) => {
    const project = projects.get(q.projectId);
    const label = quoteLabel(project?.projectNumber ?? q.projectId, q.version);
    return quoteEventRows(q, label, { projectId: q.projectId, projectNumber: project?.projectNumber }, now);
  });
}

function invoiceRows(invoices: Doc<"invoices">[], projects: Map<string, Doc<"projects">>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const inv of invoices) {
    const common = { projectId: inv.projectId, projectNumber: projectLabelFor(projects, inv.projectId) };
    const label = inv.invoiceNumber ?? "invoice";
    if (inv.issuedAt != null) {
      rows.push({ id: `invoice:${inv.id}:issued`, at: inv.issuedAt, category: "money", action: "invoice_issued", summary: `Invoice ${label} issued`, ...common });
    }
    if (inv.voidedAt != null) {
      rows.push({ id: `invoice:${inv.id}:voided`, at: inv.voidedAt, category: "money", action: "invoice_voided", summary: `Invoice ${label} voided${inv.voidReason ? `: ${inv.voidReason}` : ""}`, ...common });
    }
  }
  return rows;
}

function paymentRows(payments: Doc<"payments">[], projects: Map<string, Doc<"projects">>): TimelineRow[] {
  return payments
    .filter((p) => p.voidedAt == null)
    .map((p) => ({
      id: `payment:${p.id}`,
      at: p.paidAt,
      category: "money" as const,
      action: "payment_recorded",
      summary: "Payment recorded",
      projectId: p.projectId,
      projectNumber: projectLabelFor(projects, p.projectId),
    }));
}

type LifecycleLog = { entityType: string; action: string; details?: unknown; createdAt?: number; projectId?: string };

/** The status a STATUS_CHANGE log entry moved TO, or `null` when this log
 *  isn't a project status change to a lifecycle status this timeline cares
 *  about — split out purely to keep `lifecycleRows`'s own complexity down. */
function lifecycleStatusReached(log: LifecycleLog): "CONFIRMED" | "COMPLETED" | null {
  if (log.entityType !== "project" || log.action !== "STATUS_CHANGE") return null;
  const changes = (log.details as { changes?: { field: string; to?: string }[] } | undefined)?.changes;
  const to = changes?.find((c) => c.field === "status")?.to;
  return to === "CONFIRMED" || to === "COMPLETED" ? to : null;
}

/** Job confirmed/completed rows off `activityLogs`' STATUS_CHANGE entries
 *  (the only record of "when did this project reach CONFIRMED/COMPLETED"). */
function lifecycleRows(logs: LifecycleLog[], projects: Map<string, Doc<"projects">>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const log of logs) {
    const to = lifecycleStatusReached(log);
    if (!to) continue;
    rows.push({
      id: `lifecycle:${log.projectId}:${to}:${log.createdAt}`,
      at: log.createdAt ?? 0,
      category: "work",
      action: to === "CONFIRMED" ? "job_confirmed" : "job_completed",
      summary: to === "CONFIRMED" ? "Job confirmed" : "Job completed",
      projectId: log.projectId,
      projectNumber: projectLabelFor(projects, log.projectId),
    });
  }
  return rows;
}

const LOGGED_ACTIONS = new Set(["call_logged", "email_logged", "note_added"]);
const WORK_ACTIONS = new Set(["next_step_set", "next_step_completed"]);

/** Comments/mentions AND human-logged touches — both live in `activityEvents`,
 *  split by `action` into the right filter-chip category. */
function activityEventRows(events: Doc<"activityEvents">[]): TimelineRow[] {
  return events.map((e) => ({
    id: `event:${e._id}`,
    at: e.createdAt,
    category: LOGGED_ACTIONS.has(e.action) ? "logged" : WORK_ACTIONS.has(e.action) ? "work" : "comment",
    action: e.action,
    summary: e.summary,
    actorName: e.actorName,
  }));
}

/** Completed work items (not `follow_up` — those are covered by the
 *  `next_step_completed` activity row above, so counting them again here
 *  would double the same touch on the timeline) linked to the client. */
function workDoneRows(items: Doc<"projectTasks">[]): TimelineRow[] {
  return items
    .filter((t) => t.status === "DONE" && t.completedAt != null && t.kind !== "follow_up")
    .map((t) => ({
      id: `work:${t.id}`,
      at: t.completedAt as number,
      category: "work" as const,
      action: "work_done",
      summary: `Completed "${t.title}"`,
    }));
}

async function loadClientLinkedWorkItems(ctx: QueryCtx, orgId: string, clientId: string): Promise<Doc<"projectTasks">[]> {
  const links = await ctx.db
    .query("workItemLinks")
    .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "client").eq("entityId", clientId))
    .collect();
  const items = await Promise.all(
    links.map((l) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", l.workItemId)).first()),
  );
  return items.filter((t): t is Doc<"projectTasks"> => t != null);
}

export const forClient = query({
  args: { orgId: v.string(), clientId: v.string(), now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, clientId, now, limit }) => {
    await requireOrgReadFor(ctx, orgId, "client");
    await requireClientInOrg(ctx, clientId, orgId);

    const projectDocs = await listClientProjects(ctx, clientId, orgId);
    const projects = new Map(projectDocs.map((p) => [p.id, p]));
    const projectIds = [...projects.keys()];

    const [quoteLists, invoices, paymentLists, logLists, events, linkedWorkItems] = await Promise.all([
      Promise.all(projectIds.map((pid) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", pid)).collect())),
      ctx.db.query("invoices").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).collect(),
      Promise.all(projectIds.map((pid) => ctx.db.query("payments").withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", pid)).collect())),
      Promise.all(projectIds.map((pid) => ctx.db.query("activityLogs").withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", pid)).collect())),
      ctx.db.query("activityEvents").withIndex("by_orgId_clientId_createdAt", (q) => q.eq("orgId", orgId).eq("clientId", clientId)).collect(),
      loadClientLinkedWorkItems(ctx, orgId, clientId),
    ]);

    const rows: TimelineRow[] = [
      ...quoteRows(quoteLists.flat().filter((q) => q.organizationId === orgId), projects, now),
      ...invoiceRows(invoices.filter((i) => i.organizationId === orgId), projects),
      ...paymentRows(paymentLists.flat(), projects),
      ...lifecycleRows(logLists.flat(), projects),
      ...activityEventRows(events),
      ...workDoneRows(linkedWorkItems),
    ];

    rows.sort((a, b) => b.at - a.at);
    const cap = limit ?? TIMELINE_LIMIT;
    return { rows: rows.slice(0, cap), total: rows.length, capped: rows.length > cap };
  },
});

/** The single open `follow_up` linked to this client with the soonest due
 *  date (design §8.4), plus whether ANY of the client's quotes is currently
 *  `SENT` — the rule that makes a next step REQUIRED, not merely useful. */
export const nextStep = query({
  args: { orgId: v.string(), clientId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, clientId, now }) => {
    await requireOrgReadFor(ctx, orgId, "client");
    await requireClientInOrg(ctx, clientId, orgId);

    const [workItems, projectDocs] = await Promise.all([
      loadClientLinkedWorkItems(ctx, orgId, clientId),
      listClientProjects(ctx, clientId, orgId),
    ]);

    const openFollowUps = workItems
      .filter((t) => t.kind === "follow_up" && t.status !== "DONE" && t.status !== "CANCELLED" && t.dueDate != null)
      .sort((a, b) => (a.dueDate as number) - (b.dueDate as number));
    const next = openFollowUps[0] ?? null;

    const quoteLists = await Promise.all(
      projectDocs.map((p) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", p.id)).collect()),
    );
    const requiresNextStep = quoteLists
      .flat()
      .filter((q) => q.organizationId === orgId)
      .some((q) => effectiveQuoteStatus(q, now) === "SENT");

    return {
      nextStep: next
        ? { id: next.id, title: next.title, dueDate: next.dueDate ?? null, description: next.description ?? null, projectId: next.projectId ?? null }
        : null,
      requiresNextStep,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  forClient: { summary: "The unified activity timeline for a client (quotes, invoices, comments, logged touches, work done).", danger: "low", mcpTier: 2 },
  nextStep: { summary: "A client's soonest open next-step and whether one is currently required.", danger: "low", mcpTier: 2 },
};
