import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { canSeeJobCost } from "./lib/crewPayVisibility";
import {
  INVOICE_SEGMENTS,
  INVOICE_SORTS,
  QUOTE_SEGMENTS,
  QUOTE_SORTS,
  countBy,
  inInvoiceSegment,
  inQuoteSegment,
  invoiceHubRow,
  invoiceSearchWords,
  invoiceSortValue,
  moneyWords,
  quoteHubRow,
  quoteSearchWords,
  quoteSortValue,
  type HubProjectRef,
  type InvoiceHubRow,
  type InvoiceSegment,
  type QuoteHubRow,
  type QuoteSegment,
} from "./lib/financeHubFacts";
import { compareValues, matchesSearch, paginateItems } from "./lib/listQuery";
import { collectCapped } from "./lib/pagination";
import { ReadBudget } from "./lib/readBudget";
import { resolveNow } from "./lib/projectSegments";
import { buildDepositDue, fetchConfirmedOrLaterProjects } from "./financeOrg";

/**
 * The org Finance hub's reads (UX Phase 17, spec §9j): `quotesPage`, `invoicesPage` and
 * `hubCounts`, so the strip, the money words and the table are all derived from the SAME loaders
 * and cannot disagree. Everything derived is a pure function in `convex/lib/financeHubFacts.ts`.
 *
 * Bounds (the People-list rule): each raw status is read newest-first by `by_organizationId_status`
 * (org and order in the index, THEN the cap, so the cap drops the oldest, never the row you need),
 * and the referenced projects and clients are read from ONE `ReadBudget`. When any cap bites the
 * response says `truncated` and the page prints "at least". Money follows ONE rule
 * (`canSeeJobCost`): absent, never zero, never a sort key.
 *
 * ⚠️ R-8.4.3: `projects.by_cuid` / `clients.by_cuid` are global indexes; every doc fetched by cuid
 * here is re-checked against `organizationId`.
 */

const QUOTE_STATUS_CAP = 150; // quote docs carry a frozen snapshot: keep the byte volume bounded too
const INVOICE_STATUS_CAP = 300;
const READ_BUDGET = 9000;
const MAX_PAGE = 100;

const QUOTE_RAW_STATUSES = ["DRAFT", "SENT", "PUBLISHED", "ACCEPTED", "DECLINED", "SUPERSEDED"] as const;
const INVOICE_RAW_STATUSES = ["DRAFT", "ISSUED", "VOID"] as const;

const sortOrder = v.optional(v.union(v.literal("asc"), v.literal("desc")));

function pageArgs(a: { page?: number; pageSize?: number }) {
  return {
    page: Math.max(1, Math.floor(a.page ?? 1)),
    pageSize: Math.min(MAX_PAGE, Math.max(1, Math.floor(a.pageSize ?? 25))),
  };
}

/** Projects and clients the rows point at, by cuid, org-checked, drawn from `budget`. */
async function loadRefs(ctx: QueryCtx, orgId: string, projectIds: Set<string>, budget: ReadBudget) {
  const ids = [...projectIds];
  const granted = ids.slice(0, budget.take(ids.length));
  const projects = await Promise.all(granted.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));
  const byId = new Map<string, Doc<"projects">>();
  for (const p of projects) if (p && p.organizationId === orgId) byId.set(p.id, p);

  const clientIds = [...new Set([...byId.values()].map((p) => p.clientId).filter((c): c is string => !!c))];
  const grantedClients = clientIds.slice(0, budget.take(clientIds.length));
  const clients = await Promise.all(grantedClients.map((id) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));
  const clientName = new Map<string, string>();
  for (const c of clients) if (c && c.organizationId === orgId) clientName.set(c.id, c.name);

  const ref = (projectId: string): HubProjectRef | null => {
    const p = byId.get(projectId);
    if (!p) return null;
    return { id: p.id, projectNumber: p.projectNumber, name: p.name, clientId: p.clientId ?? null, clientName: p.clientId ? (clientName.get(p.clientId) ?? null) : null };
  };
  return { ref, projectsById: byId, clientName };
}

async function loadQuoteRows(ctx: QueryCtx, orgId: string, now: number, showMoney: boolean, budget: ReadBudget) {
  const scans = await Promise.all(
    QUOTE_RAW_STATUSES.map((status) =>
      collectCapped(ctx.db.query("quotes").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).order("desc"), QUOTE_STATUS_CAP),
    ),
  );
  const quotes = scans.flatMap((s) => s.rows);
  const { ref } = await loadRefs(ctx, orgId, new Set(quotes.map((q) => q.projectId)), budget);
  const rows = quotes.map((q) => quoteHubRow(q, ref(q.projectId), now, showMoney));
  return { rows, truncated: scans.some((s) => s.truncated) };
}

async function loadInvoiceRows(ctx: QueryCtx, orgId: string, now: number, showMoney: boolean, budget: ReadBudget) {
  const scans = await Promise.all(
    INVOICE_RAW_STATUSES.map((status) =>
      collectCapped(ctx.db.query("invoices").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).order("desc"), INVOICE_STATUS_CAP),
    ),
  );
  const invoices = scans.flatMap((s) => s.rows);
  const { ref } = await loadRefs(ctx, orgId, new Set(invoices.map((i) => i.projectId)), budget);
  const rows = invoices.map((i) => invoiceHubRow(i, ref(i.projectId), now, showMoney));
  return { rows, truncated: scans.some((s) => s.truncated) };
}

/** Projects still to invoice (D-deposit): the org's CONFIRMED-or-later jobs of a deposit client with no issued deposit. */
async function loadDepositDue(ctx: QueryCtx, orgId: string, showMoney: boolean) {
  const { projectDocsById, hitCap } = await fetchConfirmedOrLaterProjects(ctx, orgId);
  const clientIds = new Set<string>();
  for (const p of projectDocsById.values()) if (p.clientId) clientIds.add(p.clientId);
  const clients = await Promise.all([...clientIds].map((id) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));
  const clientsById = new Map(clients.filter((c): c is NonNullable<typeof c> => !!c && c.organizationId === orgId).map((c) => [c.id, c]));
  const issued = await collectCapped(ctx.db.query("invoices").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "ISSUED")).order("desc"), INVOICE_STATUS_CAP);
  const byProject = new Map<string, Doc<"invoices">[]>();
  for (const i of issued.rows) (byProject.get(i.projectId) ?? byProject.set(i.projectId, []).get(i.projectId)!).push(i);
  const rows = buildDepositDue(projectDocsById, byProject, clientsById).map((d) => ({
    id: d.project.id,
    projectNumber: d.project.projectNumber,
    name: d.project.name,
    clientName: d.project.clientName,
    depositPercent: d.depositPercent,
    // The deposit to raise is money: absent without job-cost visibility.
    ...(showMoney ? { amount: Math.round(((d.total * d.depositPercent) / 100) * 100) / 100 } : {}),
  }));
  return { rows, truncated: hitCap || issued.truncated };
}

const knownSeg = <T extends string>(all: readonly T[], seg: string | undefined): T => (all.includes(seg as T) ? (seg as T) : all[0]);

export const quotesPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    includeClosed: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "invoice");
    const now = resolveNow(a.now);
    const showMoney = await canSeeJobCost(ctx, a.orgId);
    const { page, pageSize } = pageArgs(a);
    const budget = new ReadBudget(READ_BUDGET);
    const { rows, truncated } = await loadQuoteRows(ctx, a.orgId, now, showMoney, budget);
    const seg = knownSeg<QuoteSegment>(QUOTE_SEGMENTS, a.segment);
    const filtered = rows.filter((r) => inQuoteSegment(r, seg, a.includeClosed === true) && (!a.search || matchesSearch(quoteSearchWords(r), a.search)));
    // A hidden money column is not a sort key: it falls back to the default order.
    const asked = QUOTE_SORTS.has(a.sortBy ?? "") && (a.sortBy !== "total" || showMoney);
    const sortBy = asked ? (a.sortBy as string) : "number";
    const d = asked && a.sortOrder === "desc" ? -1 : 1; // a refused sort key is the default order, ascending: asc and desc read the same
    const sorted = [...filtered].sort((x, y) => compareValues(quoteSortValue(x, sortBy, showMoney), quoteSortValue(y, sortBy, showMoney), d) || compareValues(x.id, y.id, 1));
    const { items, total, totalPages } = paginateItems(sorted, page, pageSize);
    return { items, total, totalPages, page, pageSize, truncated: truncated || budget.truncated, moneyVisible: showMoney, now };
  },
});

export const invoicesPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    includeVoid: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "invoice");
    const now = resolveNow(a.now);
    const showMoney = await canSeeJobCost(ctx, a.orgId);
    const { page, pageSize } = pageArgs(a);
    const seg = knownSeg<InvoiceSegment>(INVOICE_SEGMENTS, a.segment);

    // Deposit due lists PROJECTS still to invoice, not invoice rows.
    if (seg === "depositdue") {
      const { rows, truncated } = await loadDepositDue(ctx, a.orgId, showMoney);
      const filtered = rows.filter((r) => !a.search || matchesSearch([r.projectNumber, r.name, r.clientName], a.search));
      const sorted = [...filtered].sort((x, y) => x.projectNumber.localeCompare(y.projectNumber));
      const { items, total, totalPages } = paginateItems(sorted, page, pageSize);
      return { kind: "toRaise" as const, items, total, totalPages, page, pageSize, truncated, moneyVisible: showMoney, now };
    }

    const budget = new ReadBudget(READ_BUDGET);
    const { rows, truncated } = await loadInvoiceRows(ctx, a.orgId, now, showMoney, budget);
    const filtered = rows.filter((r) => inInvoiceSegment(r, seg, a.includeVoid === true) && (!a.search || matchesSearch(invoiceSearchWords(r), a.search)));
    const asked = INVOICE_SORTS.has(a.sortBy ?? "") && (a.sortBy !== "total" || showMoney);
    const sortBy = asked ? (a.sortBy as string) : "number";
    const d = asked && a.sortOrder === "desc" ? -1 : 1; // a refused sort key is the default order, ascending: asc and desc read the same
    const sorted = [...filtered].sort((x, y) => compareValues(invoiceSortValue(x, sortBy, showMoney), invoiceSortValue(y, sortBy, showMoney), d) || compareValues(x.id, y.id, 1));
    const { items, total, totalPages } = paginateItems(sorted, page, pageSize);
    return { kind: "invoices" as const, items, total, totalPages, page, pageSize, truncated: truncated || budget.truncated, moneyVisible: showMoney, now };
  },
});

/** The head words' counts, both strips, and the four money words (present only with job-cost visibility). */
export const hubCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now: nowArg }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    const now = resolveNow(nowArg);
    const showMoney = await canSeeJobCost(ctx, orgId);
    const budget = new ReadBudget(READ_BUDGET);
    const [quotes, invoices, deposit] = await Promise.all([
      loadQuoteRows(ctx, orgId, now, showMoney, budget),
      loadInvoiceRows(ctx, orgId, now, showMoney, budget),
      loadDepositDue(ctx, orgId, false),
    ]);
    const quoteCounts = countBy(quotes.rows, QUOTE_SEGMENTS, (r, k) => inQuoteSegment(r, k, false));
    const invoiceCounts = countBy(invoices.rows, INVOICE_SEGMENTS, (r, k) => inInvoiceSegment(r, k, false));
    invoiceCounts.depositdue = deposit.rows.length;
    return {
      quotes: quoteCounts,
      invoices: invoiceCounts,
      truncated: quotes.truncated || invoices.truncated || deposit.truncated || budget.truncated,
      // The money words are ABSENT (not zero) for a caller who can't see job cost.
      ...(showMoney ? { money: moneyWords(quotes.rows, invoices.rows, now) } : {}),
    };
  },
});

export type { QuoteHubRow, InvoiceHubRow };

export const agentOps: AgentOpsAnnotations = {
  quotesPage: { summary: "A page of the org Finance hub's quotes, by derived status (Draft, Sent, Accepted, Expired), searchable and sortable.", danger: "low", mcpTier: 3 },
  invoicesPage: { summary: "A page of the org Finance hub's invoices by derived state (Draft, Issued, Paid, Overdue) or the jobs still to invoice a deposit for.", danger: "low", mcpTier: 3 },
  hubCounts: { summary: "The Finance hub's segment counts and, with job-cost visibility, its money words (quoted, awaiting payment, invoiced this month, overdue).", danger: "low", mcpTier: 3 },
};
