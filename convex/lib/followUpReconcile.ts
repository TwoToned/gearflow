import { createId } from "@paralleldrive/cuid2";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resolveOrgFollowUpConfig } from "./orgSettings";
import { effectiveQuoteStatus, listProjectQuotes, quoteTargetsLiveVersion } from "./quoteState";
import {
  planQuoteLoop,
  resolutionForHumanDone,
  type DesiredFollowUp,
  type FollowUpConfig,
  type FollowUpResolution,
  type FollowUpRow,
  type FollowUpRuleKey,
  type QuoteLoopFacts,
  type QuoteLoopPlan,
} from "./followUpRules";
import { planInvoiceLoop, planUnraisedLoop } from "./followUpInvoiceRules";

/**
 * Follow-up automation — the reconciler (docs/designs/follow-up-automation.md
 * §8.2, FEATUREDOCS/82). Loads ONE project's facts, asks the pure rules
 * (`followUpRules.ts` for quotes, `followUpInvoiceRules.ts` for invoices) what
 * should exist, and makes it so: closes rows whose loop ended, updates the one
 * open row per loop, or creates it. Idempotent — running it twice in a row is a
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
type Automation = NonNullable<TaskDoc["automation"]>;
const OPEN_STATUSES = new Set(["TODO", "IN_PROGRESS"]);
const LIVE_HELD = new Set(["SENT", "EXPIRED", "ACCEPTED"]);
/** Per-read bounds (R-9.8): links/PMs/signal states per item, members per org,
 *  tasks and invoices per project. Generous for real data; they only exist to
 *  keep every read bounded. */
const MAX_LINKS = 100;
const MAX_MEMBERS = 1000;
const MAX_PROJECT_TASKS = 2000;
const MAX_PROJECT_INVOICES = 200;

interface ReconcileArgs {
  orgId: string;
  projectId: string;
  now: number;
}

/** Everything a created row needs beyond the plan: which rule owns it, its
 *  stage, its deterministic key, who owns it and what it links to. */
interface LoopSpec {
  ruleKey: FollowUpRuleKey;
  stage: "quote" | "close";
  sourceKey: string;
  links: { entityType: "client" | "quote" | "invoice"; entityId: string }[];
  owner: () => Promise<string | undefined>;
  /** A hand-promoted signal row to adopt instead of creating (quotes only). */
  adopt?: () => Promise<TaskDoc | null>;
}

function isOpen(t: TaskDoc): boolean {
  return OPEN_STATUSES.has(t.status ?? "TODO");
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

// ─── Owners and links ─────────────────────────────────────────────────────

async function isActiveMember(ctx: MutationCtx, orgId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const m = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  return !!m;
}

/** Owner chain (§8.1): the preferred person (quote sender / invoice issuer) →
 *  the project's PM → the earliest `projectManagers` row → an org owner. Each
 *  checked against live membership, so someone who has left falls through.
 *  Never unassigned. */
async function resolveOwner(ctx: MutationCtx, orgId: string, project: Doc<"projects">, preferred: string | undefined): Promise<string | undefined> {
  if (await isActiveMember(ctx, orgId, preferred)) return preferred;
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

async function ensureLink(ctx: MutationCtx, orgId: string, workItemId: string, entityType: "client" | "quote" | "invoice", entityId: string, now: number) {
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

// ─── Applying a plan (rule-agnostic) ─────────────────────────────────────

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

function automationFor(ruleKey: FollowUpRuleKey, d: DesiredFollowUp, prior: Automation | undefined): Automation {
  return {
    ruleKey,
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
  return x.ruleKey === y.ruleKey && x.rung === y.rung && x.subjectId === y.subjectId && x.urgent === y.urgent && x.why === y.why && x.loopStartAt === y.loopStartAt;
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
function patchFor(existing: TaskDoc, d: DesiredFollowUp, ruleKey: FollowUpRuleKey, projectId: string): Partial<TaskDoc> | null {
  const automation = automationFor(ruleKey, d, existing.automation);
  const patch: Partial<TaskDoc> = ownedFieldChanges(existing, d);
  // An adopted (hand-promoted) row gains the engine's shape.
  if (existing.projectId !== projectId) patch.projectId = projectId;
  if (existing.kind !== "follow_up") patch.kind = "follow_up";
  if (!sameAutomation(existing.automation, automation)) patch.automation = automation;
  return Object.keys(patch).length ? patch : null;
}

async function createRow(ctx: MutationCtx, a: ReconcileArgs, spec: LoopSpec, d: DesiredFollowUp) {
  const id = createId();
  await ctx.db.insert("projectTasks", {
    id,
    organizationId: a.orgId,
    projectId: a.projectId,
    title: d.title,
    status: "TODO",
    priority: d.priority,
    kind: "follow_up",
    stage: spec.stage,
    dueDate: d.dueDate,
    assigneeUserId: await spec.owner(),
    sourceKey: spec.sourceKey,
    automation: automationFor(spec.ruleKey, d, undefined),
    sortOrder: 0,
    createdAt: a.now,
    updatedAt: a.now,
  });
  for (const l of spec.links) await ensureLink(ctx, a.orgId, id, l.entityType, l.entityId, a.now);
}

async function applyPlan(ctx: MutationCtx, a: ReconcileArgs, plan: QuoteLoopPlan, rows: TaskDoc[], spec: LoopSpec) {
  const byId = new Map(rows.map((t) => [t.id, t]));
  await applyCloses(ctx, plan, byId, a.now);
  const d = plan.desired;
  if (!d) return;
  const existing = (d.existingId ? byId.get(d.existingId) : undefined) ?? (spec.adopt ? await spec.adopt() : null);
  if (!existing) return createRow(ctx, a, spec, d);
  const patch = patchFor(existing, d, spec.ruleKey, a.projectId);
  if (patch) await ctx.db.patch(existing._id, { ...patch, updatedAt: a.now });
  const subjectLink = spec.links.find((l) => l.entityType !== "client");
  if (subjectLink && existing.automation?.subjectId !== d.subjectId) {
    await ensureLink(ctx, a.orgId, existing.id, subjectLink.entityType, subjectLink.entityId, a.now);
  }
}

function clientLinks(project: Doc<"projects">): LoopSpec["links"] {
  return project.clientId ? [{ entityType: "client", entityId: project.clientId }] : [];
}

// ─── Quote loop ───────────────────────────────────────────────────────────

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

function quoteFacts(project: Doc<"projects">, quote: Doc<"quotes"> | null, rows: TaskDoc[], config: FollowUpConfig, now: number): QuoteLoopFacts {
  return {
    now,
    config,
    project: { status: project.status, eventStart: project.eventStartDate ?? project.rentalStartDate, projectNumber: project.projectNumber },
    quote: quote
      ? { id: quote.id, version: quote.version, effectiveStatus: effectiveQuoteStatus(quote, now), sentAt: quote.sentAt, validUntil: quote.validUntil }
      : null,
    rows: rows.map(toRow),
  };
}

async function reconcileQuoteLoop(ctx: MutationCtx, a: ReconcileArgs, project: Doc<"projects">, config: FollowUpConfig, tasks: TaskDoc[]) {
  const rows = tasks.filter((t) => t.automation?.ruleKey === "quote");
  const quote = pickLoopQuote(await listProjectQuotes(ctx, a.orgId, a.projectId), project, a.now);
  const plan = planQuoteLoop(quoteFacts(project, quote, rows, config, a.now));
  if (!quote) return applyCloses(ctx, plan, new Map(rows.map((t) => [t.id, t])), a.now);
  await applyPlan(ctx, a, plan, rows, {
    ruleKey: "quote",
    stage: "quote",
    sourceKey: `${QUOTE_LOOP_SOURCE_PREFIX}${quote.id}`,
    links: [...clientLinks(project), { entityType: "quote", entityId: quote.id }],
    owner: () => resolveOwner(ctx, a.orgId, project, quote.sentById),
    adopt: () => findPromotedRow(ctx, a.orgId, quote.id),
  });
}

// ─── Invoice loops ────────────────────────────────────────────────────────

/** Credit issued in Flow against each invoice (a CREDIT invoice stores
 *  `-original.total`, so its magnitude is what it takes off). */
function flowCreditsByInvoice(invoices: Doc<"invoices">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of invoices) {
    if (c.kind !== "CREDIT" || c.status !== "ISSUED" || !c.creditForInvoiceId) continue;
    out.set(c.creditForInvoiceId, (out.get(c.creditForInvoiceId) ?? 0) + Math.abs(Number(c.total) || 0));
  }
  return out;
}

function invoiceFacts(invoice: Doc<"invoices">, flowCredit: number) {
  return {
    id: invoice.id,
    number: invoice.invoiceNumber,
    kind: invoice.kind,
    status: invoice.status,
    paymentStatus: invoice.paymentStatus,
    xeroStatus: invoice.xeroStatus,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    total: Number(invoice.total) || 0,
    amountPaid: invoice.amountPaid ?? 0,
    // Xero and Flow may both record the same credit note; take the larger.
    amountCredited: Math.max(invoice.xeroAmountCredited ?? 0, flowCredit),
  };
}

async function reconcileOneInvoice(
  ctx: MutationCtx,
  a: ReconcileArgs,
  project: Doc<"projects">,
  config: FollowUpConfig,
  invoice: Doc<"invoices"> | undefined,
  rows: TaskDoc[],
  flowCredit: number,
) {
  if (!invoice) {
    // The invoice is gone (a deleted draft): close anything still open on it.
    const close = rows.filter(isOpen).map((t) => ({ id: t.id, resolution: "voided" as const, status: "CANCELLED" as const }));
    return applyCloses(ctx, { close, desired: null }, new Map(rows.map((t) => [t.id, t])), a.now);
  }
  const plan = planInvoiceLoop({
    now: a.now,
    config,
    eventStart: project.eventStartDate ?? project.rentalStartDate,
    invoice: invoiceFacts(invoice, flowCredit),
    rows: rows.map(toRow),
  });
  await applyPlan(ctx, a, plan, rows, {
    ruleKey: "invoice",
    stage: "close",
    sourceKey: `invoice:chase:${invoice.id}`,
    links: [...clientLinks(project), { entityType: "invoice", entityId: invoice.id }],
    owner: () => resolveOwner(ctx, a.orgId, project, invoice.issuedById),
  });
}

async function reconcileUnraised(ctx: MutationCtx, a: ReconcileArgs, project: Doc<"projects">, config: FollowUpConfig, tasks: TaskDoc[], invoices: Doc<"invoices">[]) {
  const rows = tasks.filter((t) => t.automation?.ruleKey === "invoice_unraised");
  const plan = planUnraisedLoop({
    now: a.now,
    config,
    project: {
      id: project.id,
      status: project.status,
      projectNumber: project.projectNumber,
      endedAt: project.eventEndDate ?? project.rentalEndDate,
      total: Number(project.total) || 0,
    },
    hasIssuedInvoice: invoices.some((i) => i.status === "ISSUED" && i.kind !== "CREDIT"),
    rows: rows.map(toRow),
  });
  await applyPlan(ctx, a, plan, rows, {
    ruleKey: "invoice_unraised",
    stage: "close",
    sourceKey: `invoice:unraised:${project.id}`,
    links: clientLinks(project),
    owner: () => resolveOwner(ctx, a.orgId, project, undefined),
  });
}

async function reconcileInvoiceLoops(ctx: MutationCtx, a: ReconcileArgs, project: Doc<"projects">, config: FollowUpConfig, tasks: TaskDoc[], invoices: Doc<"invoices">[]) {
  const chaseRows = tasks.filter((t) => t.automation?.ruleKey === "invoice");
  const subjects = new Set([...invoices.map((i) => i.id), ...chaseRows.map((t) => t.automation!.subjectId)]);
  const credits = flowCreditsByInvoice(invoices);
  for (const invoiceId of subjects) {
    const rows = chaseRows.filter((t) => t.automation!.subjectId === invoiceId);
    await reconcileOneInvoice(ctx, a, project, config, invoices.find((i) => i.id === invoiceId), rows, credits.get(invoiceId) ?? 0);
  }
  await reconcileUnraised(ctx, a, project, config, tasks, invoices);
}

// ─── Entry point ──────────────────────────────────────────────────────────

/** Every follow-up rule for one project. The single entry point write paths
 *  call — a new rule joins here, never at a call site. */
export async function reconcileFollowUps(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string | undefined; now: number },
): Promise<void> {
  if (!a.projectId) return;
  const args: ReconcileArgs = { orgId: a.orgId, projectId: a.projectId, now: a.now };
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", args.projectId)).first();
  if (!project || project.organizationId !== a.orgId || project.isTemplate) return;
  const config = await resolveOrgFollowUpConfig(ctx, a.orgId);
  const tasks = (await ctx.db
    .query("projectTasks")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", a.orgId).eq("projectId", args.projectId))
    .take(MAX_PROJECT_TASKS)).filter((t) => t.automation);
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", a.orgId).eq("projectId", args.projectId))
    .take(MAX_PROJECT_INVOICES);

  await reconcileQuoteLoop(ctx, args, project, config, tasks);
  await reconcileInvoiceLoops(ctx, args, project, config, tasks, invoices);
}

// ─── Human edits of automated rows ───────────────────────────────────────

type HumanChange = { status?: string; dueDate?: boolean; title?: boolean; assignee?: boolean; deleted?: boolean };

function lockEdited(auto: Automation, change: HumanChange): string[] {
  const locked = new Set(auto.lockedFields);
  if (change.dueDate) locked.add("dueDate");
  if (change.title) locked.add("title");
  if (change.assignee) locked.add("assignee");
  return [...locked];
}

/** How the close (or re-open) should be recorded; undefined = leave as is. */
function closeRecord(doc: TaskDoc, change: HumanChange, userId: string): Pick<Automation, "resolution" | "resolvedBy"> | undefined {
  const wasOpen = isOpen(doc);
  if (change.deleted) return { resolution: "deleted", resolvedBy: userId };
  if (!change.status) return undefined;
  if (wasOpen && change.status === "CANCELLED") return { resolution: "deleted", resolvedBy: userId };
  if (wasOpen && change.status === "DONE") return { resolution: resolutionForHumanDone(doc.automation!.rung, doc.automation!.ruleKey), resolvedBy: userId };
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
