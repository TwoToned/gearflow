import { createId } from "@paralleldrive/cuid2";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveOrgFollowUpConfig } from "./orgSettings";
import { effectiveQuoteStatus, listProjectQuotes, quoteTargetsLiveVersion } from "./quoteState";
import {
  planQuoteLoop,
  resolutionForHumanDone,
  type DesiredFollowUp,
  type FollowUpResolution,
  type FollowUpRow,
  type QuoteLoopFacts,
  type QuoteLoopPlan,
} from "./followUpRules";

/**
 * Follow-up automation — the reconciler (docs/designs/follow-up-automation.md
 * §8.2). Loads ONE project's facts, asks the pure rule (`followUpRules.ts`)
 * what should exist, and makes it so: closes rows whose loop ended, updates the
 * one open row, or creates it. Idempotent — running it twice in a row is a
 * no-op — so it is safe to call from every write path AND from the hourly tick.
 *
 * Call-site discipline, same as `maybeAutoAdvanceProjectStatus`: call ONCE at
 * the end of a mutation, after the writes it should see have landed, never in a
 * loop. Never call it from a query.
 *
 * Human edits win: a field listed in `automation.lockedFields` (a human set the
 * due date, title or assignee) is never written here again.
 */

export const QUOTE_LOOP_SOURCE_PREFIX = "quote:nonext:";

type TaskDoc = Doc<"projectTasks">;
const OPEN_STATUSES = new Set(["TODO", "IN_PROGRESS"]);
const LIVE_HELD = new Set(["SENT", "EXPIRED", "ACCEPTED"]);
/** Per-read bounds (R-9.8): links/PMs/signal states per item, members per org,
 *  tasks per project. Generous for real data; they only exist to keep every
 *  read bounded. */
const MAX_LINKS = 100;
const MAX_MEMBERS = 1000;
const MAX_PROJECT_TASKS = 2000;

function isOpen(t: TaskDoc): boolean {
  return OPEN_STATUSES.has(t.status ?? "TODO");
}

/** The quote the loop is about: the one the client is holding on the live
 *  version, else the most recently sent one (so a decline/recall closes it). */
function pickLoopQuote(quotes: Doc<"quotes">[], project: Doc<"projects">, now: number): Doc<"quotes"> | null {
  const sentEver = quotes.filter((q) => q.sentAt != null);
  if (!sentEver.length) return null;
  const held = sentEver
    .filter((q) => LIVE_HELD.has(effectiveQuoteStatus(q, now)))
    .sort((a, b) => {
      const live = Number(quoteTargetsLiveVersion(b, project)) - Number(quoteTargetsLiveVersion(a, project));
      return live !== 0 ? live : (b.sentAt ?? 0) - (a.sentAt ?? 0);
    });
  if (held.length) return held[0];
  return [...sentEver].sort((a, b) => (b.updatedAt ?? b.sentAt ?? 0) - (a.updatedAt ?? a.sentAt ?? 0))[0];
}

function toRow(t: TaskDoc): FollowUpRow {
  const a = t.automation!;
  return {
    id: t.id,
    open: isOpen(t),
    createdAt: t.createdAt ?? t._creationTime,
    completedAt: t.completedAt ?? (isOpen(t) ? undefined : t.updatedAt),
    dueDate: t.dueDate,
    rung: a.rung,
    loopStartAt: a.loopStartAt,
    subjectId: a.subjectId,
    resolution: a.resolution,
    nextDate: a.nextDate,
    lockedFields: a.lockedFields,
  };
}

async function isActiveMember(ctx: MutationCtx, orgId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const m = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  return !!m;
}

/** Owner chain (§8.1): who sent the quote → the project's PM → the earliest
 *  `projectManagers` row → an org owner. Each checked against live membership,
 *  so someone who has left the org falls through. Never unassigned. */
async function resolveOwner(ctx: MutationCtx, orgId: string, project: Doc<"projects">, quote: Doc<"quotes">): Promise<string | undefined> {
  if (await isActiveMember(ctx, orgId, quote.sentById)) return quote.sentById;
  if (await isActiveMember(ctx, orgId, project.projectManagerId)) return project.projectManagerId;
  const pms = (await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).take(MAX_LINKS))
    .filter((p) => p.organizationId === orgId) // by_projectId is global — re-check
    .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  for (const pm of pms) if (await isActiveMember(ctx, orgId, pm.userId)) return pm.userId;
  const owner = (await ctx.db.query("members").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).take(MAX_MEMBERS))
    .filter((m) => m.role === "owner")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
  return owner?.userId;
}

async function ensureLink(ctx: MutationCtx, orgId: string, workItemId: string, entityType: "client" | "quote", entityId: string, now: number) {
  const existing = await ctx.db
    .query("workItemLinks")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", workItemId))
    .take(MAX_LINKS);
  if (existing.some((l) => l.organizationId === orgId && l.entityType === entityType && l.entityId === entityId)) return;
  await ctx.db.insert("workItemLinks", { id: createId(), organizationId: orgId, workItemId, entityType, entityId, createdAt: now });
}

/** A signal someone already promoted by hand for this quote — adopted rather
 *  than duplicated (design §8.2, R3's escape hatch). */
async function findPromotedRow(ctx: MutationCtx, orgId: string, quoteId: string): Promise<TaskDoc | null> {
  const states = await ctx.db
    .query("workSignalStates")
    .withIndex("by_organizationId_sourceKey", (q) => q.eq("organizationId", orgId).eq("sourceKey", `${QUOTE_LOOP_SOURCE_PREFIX}${quoteId}`))
    .take(MAX_LINKS);
  for (const s of states) {
    if (s.state !== "promoted" || !s.promotedWorkItemId) continue;
    const t = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", s.promotedWorkItemId!)).first();
    if (t && t.organizationId === orgId && isOpen(t) && !t.automation) return t;
  }
  return null;
}

function toFacts(project: Doc<"projects">, quote: Doc<"quotes"> | null, tasks: TaskDoc[], config: QuoteLoopFacts["config"], now: number): QuoteLoopFacts {
  return {
    now,
    config,
    project: {
      status: project.status,
      eventStart: project.eventStartDate ?? project.rentalStartDate,
      projectNumber: project.projectNumber,
    },
    quote: quote
      ? { id: quote.id, version: quote.version, effectiveStatus: effectiveQuoteStatus(quote, now), sentAt: quote.sentAt, validUntil: quote.validUntil }
      : null,
    rows: tasks.map(toRow),
  };
}

async function applyCloses(ctx: MutationCtx, plan: QuoteLoopPlan, byId: Map<string, TaskDoc>, now: number) {
  for (const c of plan.close) {
    const t = byId.get(c.id);
    if (!t?.automation) continue;
    await ctx.db.patch(t._id, {
      status: c.status,
      completedAt: now,
      updatedAt: now,
      automation: { ...t.automation, resolution: c.resolution as FollowUpResolution, resolvedBy: "system" },
    });
  }
}

function automationFor(d: DesiredFollowUp, prior: Automation | undefined): Automation {
  return {
    ruleKey: "quote",
    subjectId: d.subjectId,
    rung: d.rung,
    loopStartAt: d.loopStartAt,
    urgent: d.urgent,
    why: d.why,
    lockedFields: prior?.lockedFields ?? [],
    nextDate: prior?.nextDate,
  };
}

function sameAutomation(x: Automation | undefined, y: Automation): boolean {
  if (!x) return false;
  return x.rung === y.rung && x.subjectId === y.subjectId && x.urgent === y.urgent && x.why === y.why && x.loopStartAt === y.loopStartAt;
}

/** Fields the engine may overwrite, skipping any a human has locked. */
function ownedFieldChanges(existing: TaskDoc, d: DesiredFollowUp): Partial<TaskDoc> {
  const locked = new Set(existing.automation?.lockedFields ?? []);
  const patch: Partial<TaskDoc> = {};
  if (!locked.has("title") && existing.title !== d.title) patch.title = d.title;
  if (!locked.has("dueDate") && existing.dueDate !== d.dueDate) patch.dueDate = d.dueDate;
  if (existing.priority !== d.priority) patch.priority = d.priority;
  return patch;
}

/** The patch that brings an existing row to `d`. Null when nothing changes. */
function patchFor(existing: TaskDoc, d: DesiredFollowUp, projectId: string): Partial<TaskDoc> | null {
  const automation = automationFor(d, existing.automation);
  const patch: Partial<TaskDoc> = ownedFieldChanges(existing, d);
  // An adopted (hand-promoted) row gains the engine's shape.
  if (existing.projectId !== projectId) patch.projectId = projectId;
  if (existing.kind !== "follow_up") patch.kind = "follow_up";
  if (!sameAutomation(existing.automation, automation)) patch.automation = automation;
  return Object.keys(patch).length ? patch : null;
}

async function loadQuoteLoopTasks(ctx: MutationCtx, orgId: string, projectId: string): Promise<TaskDoc[]> {
  const rows = await ctx.db
    .query("projectTasks")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
    .take(MAX_PROJECT_TASKS);
  return rows.filter((t) => t.automation?.ruleKey === "quote");
}

async function applyDesired(ctx: MutationCtx, a: { orgId: string; projectId: string; now: number }, project: Doc<"projects">, quote: Doc<"quotes">, d: DesiredFollowUp & { existingId?: string }, byId: Map<string, TaskDoc>) {
  const existing = (d.existingId ? byId.get(d.existingId) : undefined) ?? (await findPromotedRow(ctx, a.orgId, quote.id));
  if (!existing) return createRow(ctx, a, project, quote, d);
  const patch = patchFor(existing, d, a.projectId);
  if (patch) await ctx.db.patch(existing._id, { ...patch, updatedAt: a.now });
  if (existing.automation?.subjectId !== d.subjectId) await ensureLink(ctx, a.orgId, existing.id, "quote", d.subjectId, a.now);
}

async function createRow(ctx: MutationCtx, a: { orgId: string; now: number }, project: Doc<"projects">, quote: Doc<"quotes">, d: DesiredFollowUp) {
  const id = createId();
  await ctx.db.insert("projectTasks", {
    id,
    organizationId: a.orgId,
    projectId: project.id,
    title: d.title,
    status: "TODO",
    priority: d.priority,
    kind: "follow_up",
    stage: "quote",
    dueDate: d.dueDate,
    assigneeUserId: await resolveOwner(ctx, a.orgId, project, quote),
    sourceKey: `${QUOTE_LOOP_SOURCE_PREFIX}${quote.id}`,
    automation: automationFor(d, undefined),
    sortOrder: 0,
    createdAt: a.now,
    updatedAt: a.now,
  });
  if (project.clientId) await ensureLink(ctx, a.orgId, id, "client", project.clientId, a.now);
  await ensureLink(ctx, a.orgId, id, "quote", quote.id, a.now);
}

export async function reconcileQuoteFollowUps(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; now: number },
): Promise<void> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
  if (!project || project.organizationId !== a.orgId || project.isTemplate) return;

  const config = await resolveOrgFollowUpConfig(ctx, a.orgId);
  const quote = pickLoopQuote(await listProjectQuotes(ctx, a.orgId, a.projectId), project, a.now);
  const tasks = await loadQuoteLoopTasks(ctx, a.orgId, a.projectId);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const plan = planQuoteLoop(toFacts(project, quote, tasks, config, a.now));
  await applyCloses(ctx, plan, byId, a.now);
  if (plan.desired && quote) await applyDesired(ctx, a, project, quote, plan.desired, byId);
}

/** Every follow-up rule for one project. The single entry point write paths
 *  call; phase 2's invoice rule joins here, not at each call site. */
export async function reconcileFollowUps(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; now: number },
): Promise<void> {
  if (!a.projectId) return;
  await reconcileQuoteFollowUps(ctx, { orgId: a.orgId, projectId: a.projectId, now: a.now });
}

// ─── Human edits of automated rows ───────────────────────────────────────

type Automation = NonNullable<TaskDoc["automation"]>;

function lockEdited(auto: Automation, change: HumanChange): string[] {
  const locked = new Set(auto.lockedFields);
  if (change.dueDate) locked.add("dueDate");
  if (change.title) locked.add("title");
  if (change.assignee) locked.add("assignee");
  return [...locked];
}

type HumanChange = { status?: string; dueDate?: boolean; title?: boolean; assignee?: boolean; deleted?: boolean };

/** How the close (or re-open) should be recorded; undefined = leave as is. */
function closeRecord(doc: TaskDoc, change: HumanChange, userId: string): Pick<Automation, "resolution" | "resolvedBy"> | undefined {
  const wasOpen = isOpen(doc);
  if (change.deleted) return { resolution: "deleted", resolvedBy: userId };
  if (!change.status) return undefined;
  if (wasOpen && change.status === "CANCELLED") return { resolution: "deleted", resolvedBy: userId };
  if (wasOpen && change.status === "DONE") return { resolution: resolutionForHumanDone(doc.automation!.rung), resolvedBy: userId };
  if (!wasOpen && OPEN_STATUSES.has(change.status)) return { resolution: undefined, resolvedBy: undefined };
  return undefined;
}

/**
 * The `automation` patch for a HUMAN change to an automated row (design §8.2
 * "Human edits win"): edited fields are locked so the reconciler never writes
 * them again; a close records how it was closed so the ladder knows whether to
 * advance ("no reply") or stop ("decided"); re-opening clears the close.
 * Returns undefined for a row the engine doesn't own.
 */
export function automationForHumanChange(doc: TaskDoc, change: HumanChange, userId: string): Automation | undefined {
  const auto = doc.automation;
  if (!auto) return undefined;
  return { ...auto, lockedFields: lockEdited(auto, change), ...closeRecord(doc, change, userId) };
}
