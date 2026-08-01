import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import { effectiveQuoteStatus, projectLiveRevision } from "./lib/quoteState";
import { QUOTE_EXPIRING_SOON_DAYS, daysUntilValidUntil } from "./lib/quoteDates";
import type { Doc } from "./_generated/dataModel";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * The org-level Finance section (#992, Phase F) — "what's chaseable across
 * every project, without opening them one at a time": quotes out, expiring,
 * never sent, confirmed-but-uninvoiced, deposit due, outstanding.
 *
 * Perf constraint (design doc §6.7, learned from #942's 77%-of-org-I/O
 * incident): this MUST be a bounded, indexed aggregation, never a per-project
 * loop. Every read here is either an `organizationId_status` index scan
 * (capped at `SECTION_CAP`) or a referenced-only fan-out sized by the
 * candidate set those scans produce — same shape as `overbookingBoard.ts`'s
 * `computeBoardBundle` and `dashboardStats.ts`'s `bundle`.
 *
 * `QUOTE_EXPIRING_SOON_DAYS` comes from `convex/lib/quoteDates.ts` — the
 * SAME "expiring soon" threshold the per-project Finance tab uses (R-3.1;
 * see that file's own comment, which was written anticipating this query).
 */

const DAY_MS = 86_400_000;

/** Defensive ceiling per index scan. Each of these buckets is bounded by
 *  BUSINESS STATE, not time — a real org has dozens of SENT quotes or
 *  CONFIRMED-uninvoiced projects at once, not thousands, because rows leave
 *  the bucket the moment they're accepted/invoiced/paid. This cap exists so a
 *  runaway org can never turn the read into an unbounded scan; `capped` in the
 *  response tells the UI (and the regression test) when it was hit. */
export const SECTION_CAP = 200;

/** Statuses at or after CONFIRMED (excluding CANCELLED) — the candidate set
 *  for "confirmed but uninvoiced" and "deposit due". Includes INVOICED
 *  deliberately: a project marked INVOICED with no actual ISSUED invoice is
 *  exactly the inconsistency this screen exists to surface, not hide. */
const CONFIRMED_OR_LATER_STATUSES = [
  "CONFIRMED",
  "PREPPING",
  "CHECKED_OUT",
  "ON_SITE",
  "RETURNED",
  "COMPLETED",
  "INVOICED",
] as const;
const CONFIRMED_OR_LATER_SET = new Set<string>(CONFIRMED_OR_LATER_STATUSES);

interface OrgFinanceProjectRef {
  id: string;
  projectNumber: string;
  name: string;
  status: string | null;
  clientId: string | null;
  clientName: string | null;
}

function projectRef(p: Doc<"projects">, clientsById: Map<string, Doc<"clients">>): OrgFinanceProjectRef {
  const client = p.clientId ? clientsById.get(p.clientId) : undefined;
  return {
    id: p.id,
    projectNumber: p.projectNumber,
    name: p.name,
    status: p.status ?? null,
    clientId: p.clientId ?? null,
    clientName: client?.name ?? null,
  };
}

/** Quote `snapshot` is `v.any()` (frozen at send) — the only field this
 *  screen needs out of it is the total already computed by `buildFinanceLines`
 *  + recalc at send time (R-9.3: never recomputed here). */
function snapshotTotal(snapshot: unknown): number | null {
  if (snapshot && typeof snapshot === "object" && "total" in (snapshot as Record<string, unknown>)) {
    const t = (snapshot as { total?: unknown }).total;
    return typeof t === "number" ? t : null;
  }
  return null;
}

async function fetchQuotesByRawStatus(ctx: QueryCtx, orgId: string, status: "SENT" | "PUBLISHED" | "DRAFT") {
  return await ctx.db
    .query("quotes")
    .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status))
    .take(SECTION_CAP);
}

/** Projects at CONFIRMED-or-later, one capped scan per status (same idiom as
 *  dashboardStats.ts's OPEN_MAINTENANCE_STATUSES loop) — feeds "confirmed
 *  but uninvoiced" and "deposit due", plus seeds the shared project map. */
async function fetchConfirmedOrLaterProjects(ctx: QueryCtx, orgId: string) {
  const projectDocsById = new Map<string, Doc<"projects">>();
  let hitCap = false;
  for (const status of CONFIRMED_OR_LATER_STATUSES) {
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status))
      .take(SECTION_CAP);
    if (rows.length >= SECTION_CAP) hitCap = true;
    for (const p of rows) {
      if (p.isTemplate !== true) projectDocsById.set(p.id, p);
    }
  }
  return { projectDocsById, hitCap };
}

/** Referenced-only projects for any quote/invoice whose project isn't already
 *  in `projectDocsById` (mutated in place), sized by the candidate set those
 *  scans produced — not an org-wide scan. */
async function fillReferencedProjects(
  ctx: QueryCtx,
  orgId: string,
  projectDocsById: Map<string, Doc<"projects">>,
  neededProjectIds: Set<string>,
) {
  const missingIds = [...neededProjectIds].filter((id) => !projectDocsById.has(id));
  const missingDocs = await Promise.all(
    missingIds.map((pid) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique()),
  );
  for (const p of missingDocs) {
    if (p && p.organizationId === orgId) projectDocsById.set(p.id, p);
  }
}

/** Referenced-only clients for every project now in scope. */
async function fetchReferencedClients(ctx: QueryCtx, orgId: string, projectDocsById: Map<string, Doc<"projects">>) {
  const clientIds = new Set<string>();
  for (const p of projectDocsById.values()) {
    if (p.clientId) clientIds.add(p.clientId);
  }
  const clientDocs = await Promise.all(
    [...clientIds].map((cid) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", cid)).unique()),
  );
  return new Map(clientDocs.filter((c): c is NonNullable<typeof c> => !!c && c.organizationId === orgId).map((c) => [c.id, c]));
}

function groupByProjectId(invoices: Doc<"invoices">[]): Map<string, Doc<"invoices">[]> {
  const byProjectId = new Map<string, Doc<"invoices">[]>();
  for (const inv of invoices) {
    const list = byProjectId.get(inv.projectId) ?? [];
    list.push(inv);
    byProjectId.set(inv.projectId, list);
  }
  return byProjectId;
}

/** Quotes out: SENT, not yet accepted/declined, oldest (longest outstanding) first. */
function buildQuotesOut(
  liveQuotes: Doc<"quotes">[],
  now: number,
  projectDocsById: Map<string, Doc<"projects">>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return liveQuotes
    .map((quote) => ({ quote, status: effectiveQuoteStatus(quote, now) }))
    .filter((r) => r.status === "SENT")
    .map(({ quote, status }) => {
      const project = projectDocsById.get(quote.projectId);
      if (!project) return null;
      return {
        quoteId: quote.id,
        version: quote.version,
        status,
        sentAt: quote.sentAt ?? quote.publishedAt ?? null,
        validUntil: quote.validUntil ?? null,
        total: snapshotTotal(quote.snapshot),
        project: projectRef(project, clientsById),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
}

/** Expiring: validUntil inside QUOTE_EXPIRING_SOON_DAYS, plus already expired
 *  (derived on read, never stored — same rule as quoteState.ts). */
function buildExpiring(
  liveQuotes: Doc<"quotes">[],
  now: number,
  projectDocsById: Map<string, Doc<"projects">>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return liveQuotes
    .map((quote) => ({ quote, status: effectiveQuoteStatus(quote, now) }))
    .filter((r) => {
      if (r.status !== "SENT" && r.status !== "EXPIRED") return false;
      if (r.quote.validUntil == null) return false;
      return r.quote.validUntil - now <= QUOTE_EXPIRING_SOON_DAYS * DAY_MS;
    })
    .map(({ quote, status }) => {
      const project = projectDocsById.get(quote.projectId);
      if (!project) return null;
      return {
        quoteId: quote.id,
        version: quote.version,
        status,
        validUntil: quote.validUntil ?? null,
        daysLeft: daysUntilValidUntil(quote.validUntil, now),
        total: snapshotTotal(quote.snapshot),
        project: projectRef(project, clientsById),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.validUntil ?? 0) - (b.validUntil ?? 0));
}

/** Never sent: DRAFT revisions on active (non-template, non-cancelled)
 *  projects — work sitting unfinished. Scoped to each project's LIVE
 *  revision (#1085) — a non-live `DRAFT` (one `saveVersionNative` left
 *  behind: a saved-but-never-sent version, or a recalled one) is a version
 *  the operator deliberately moved past, not unfinished work. */
function buildNeverSent(
  draftQuotes: Doc<"quotes">[],
  projectDocsById: Map<string, Doc<"projects">>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return draftQuotes
    .map((quote) => {
      const project = projectDocsById.get(quote.projectId);
      if (!project || project.isTemplate === true || project.status === "CANCELLED") return null;
      if (quote.version !== projectLiveRevision(project)) return null;
      return {
        quoteId: quote.id,
        version: quote.version,
        createdAt: quote.createdAt ?? null,
        total: Number(project.total) || 0,
        project: projectRef(project, clientsById),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** Confirmed but uninvoiced: CONFIRMED+ with no ISSUED (non-void by
 *  definition — VOID is a separate status) invoice at all. */
function buildConfirmedUninvoiced(
  projectDocsById: Map<string, Doc<"projects">>,
  issuedByProjectId: Map<string, Doc<"invoices">[]>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return [...projectDocsById.values()]
    .filter((p) => CONFIRMED_OR_LATER_SET.has(p.status ?? "") && !issuedByProjectId.get(p.id)?.length)
    .map((p) => ({
      project: projectRef(p, clientsById),
      rentalEndDate: p.rentalEndDate ?? null,
      total: Number(p.total) || 0,
    }))
    .sort((a, b) => (a.rentalEndDate ?? 0) - (b.rentalEndDate ?? 0));
}

/** Deposit due: DEPOSIT_BALANCE clients whose deposit invoice hasn't issued —
 *  the per-project nudge chip (project-finance-panel.tsx), lifted to org
 *  scope over the same CONFIRMED+ candidate set. */
function buildDepositDue(
  projectDocsById: Map<string, Doc<"projects">>,
  issuedByProjectId: Map<string, Doc<"invoices">[]>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return [...projectDocsById.values()]
    .filter((p) => {
      if (!CONFIRMED_OR_LATER_SET.has(p.status ?? "")) return false;
      const client = p.clientId ? clientsById.get(p.clientId) : undefined;
      if (client?.paymentProfile !== "DEPOSIT_BALANCE") return false;
      const issued = issuedByProjectId.get(p.id) ?? [];
      return !issued.some((inv) => inv.kind === "DEPOSIT");
    })
    .map((p) => {
      const client = p.clientId ? clientsById.get(p.clientId) : undefined;
      return {
        project: projectRef(p, clientsById),
        depositPercent: client?.profileDepositPercent ?? 25,
        total: Number(p.total) || 0,
      };
    })
    .sort((a, b) => a.project.projectNumber.localeCompare(b.project.projectNumber));
}

/** Outstanding: issued invoices not (yet) marked PAID. `paymentStatus` is now
 *  real for any org recording payments in Flow (#1055, paymentsWrites.ts) —
 *  the remaining gap is Xero-side payments Flow doesn't know about, since the
 *  Xero payment-status poll itself (FEATUREDOCS/66 "Deferred") was never
 *  built. */
function buildOutstanding(
  issuedInvoices: Doc<"invoices">[],
  projectDocsById: Map<string, Doc<"projects">>,
  clientsById: Map<string, Doc<"clients">>,
) {
  return issuedInvoices
    .filter((inv) => (inv.paymentStatus ?? "UNPAID") !== "PAID")
    .map((inv) => {
      const project = projectDocsById.get(inv.projectId);
      if (!project) return null;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        kind: inv.kind,
        total: inv.total,
        paymentStatus: inv.paymentStatus ?? "UNPAID",
        issuedAt: inv.issuedAt ?? null,
        dueDate: inv.dueDate ?? null,
        project: projectRef(project, clientsById),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.dueDate ?? a.issuedAt ?? 0) - (b.dueDate ?? b.issuedAt ?? 0));
}

/**
 * The shared read+aggregate core behind `bundle` (the full page) and `counts`
 * (the cheap dashboard-chip query) — identical reads, different return shape,
 * same reasoning as `overbookingBoard.ts`'s `computeBoardBundle`.
 */
async function computeFinanceBundle(ctx: QueryCtx, orgId: string, now: number) {
  // ── Quotes: two raw-status scans (PUBLISHED is the pre-#986 legacy value
  // that reads as SENT — see quoteState.ts) + DRAFT ──
  const [sentRaw, publishedLegacyRaw, draftQuotes] = await Promise.all([
    fetchQuotesByRawStatus(ctx, orgId, "SENT"),
    fetchQuotesByRawStatus(ctx, orgId, "PUBLISHED"),
    fetchQuotesByRawStatus(ctx, orgId, "DRAFT"),
  ]);
  const liveQuotes = [...sentRaw, ...publishedLegacyRaw];

  const { projectDocsById, hitCap: confirmedScansHitCap } = await fetchConfirmedOrLaterProjects(ctx, orgId);

  // ── Invoices: one capped ISSUED scan feeds Outstanding, Confirmed-uninvoiced
  // AND Deposit-due — one read serving three sections, not three reads ──
  const issuedInvoices = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "ISSUED"))
    .take(SECTION_CAP);

  const neededProjectIds = new Set<string>();
  for (const q of liveQuotes) neededProjectIds.add(q.projectId);
  for (const q of draftQuotes) neededProjectIds.add(q.projectId);
  for (const inv of issuedInvoices) neededProjectIds.add(inv.projectId);
  await fillReferencedProjects(ctx, orgId, projectDocsById, neededProjectIds);

  const clientsById = await fetchReferencedClients(ctx, orgId, projectDocsById);
  const issuedByProjectId = groupByProjectId(issuedInvoices);

  const capped =
    sentRaw.length >= SECTION_CAP ||
    publishedLegacyRaw.length >= SECTION_CAP ||
    draftQuotes.length >= SECTION_CAP ||
    issuedInvoices.length >= SECTION_CAP ||
    confirmedScansHitCap;

  return {
    quotesOut: buildQuotesOut(liveQuotes, now, projectDocsById, clientsById),
    expiring: buildExpiring(liveQuotes, now, projectDocsById, clientsById),
    neverSent: buildNeverSent(draftQuotes, projectDocsById, clientsById),
    confirmedUninvoiced: buildConfirmedUninvoiced(projectDocsById, issuedByProjectId, clientsById),
    depositDue: buildDepositDue(projectDocsById, issuedByProjectId, clientsById),
    outstanding: buildOutstanding(issuedInvoices, projectDocsById, clientsById),
    capped,
  };
}

/**
 * The `/finance` page's one aggregation query (#992, Phase F). Permission-
 * gated on `invoice` read — same resource the per-project Finance tab and its
 * PDF routes already use (no new RBAC resource).
 */
export const bundle = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    return await computeFinanceBundle(ctx, orgId, now);
  },
});

/**
 * Cheap dashboard-chip counts — same bounded reads `bundle` uses, small
 * return shape, so the dashboard doesn't subscribe to every row just to show
 * a couple of numbers (mirrors `overbookingBoard.ts`'s `counts`).
 */
export const counts = query({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    const b = await computeFinanceBundle(ctx, orgId, now);
    return {
      quotesOutCount: b.quotesOut.length,
      expiringCount: b.expiring.length,
      neverSentCount: b.neverSent.length,
      confirmedUninvoicedCount: b.confirmedUninvoiced.length,
      depositDueCount: b.depositDue.length,
      outstandingCount: b.outstanding.length,
    };
  },
});

// ─── agentOps annotations (Phase 5 domain slice, #1001) ──────────────────────
export const agentOps: AgentOpsAnnotations = {
  bundle: {
    summary: "The org's chaseable finance rows: quotes out, expiring, never sent, confirmed-uninvoiced, deposit due, outstanding.",
    danger: "low",
    mcpTier: 2,
  },
  counts: { summary: "Cheap counts for the six financeOrg.bundle sections, for a dashboard chip.", danger: "low", mcpTier: 3 },
};
