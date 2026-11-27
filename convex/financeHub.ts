import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { callerMayRead, requireOrgReadFor } from "./lib/auth";
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
  invoicePassesFilters,
  invoiceSearchWords,
  clientFacets,
  invoiceSortValue,
  moneyWords,
  quoteHubRow,
  quotePassesFilters,
  quoteSearchWords,
  quoteSortValue,
  type HubProjectRef,
  type InvoiceHubRow,
  type InvoiceSegment,
  type QuoteHubRow,
  type QuoteSegment,
} from "./lib/financeHubFacts";
import { depositDueForJob } from "./lib/invoicingState";
import { compareValues, matchesSearch, paginateItems } from "./lib/listQuery";
import { resolveOrgInvoiceConfig } from "./lib/orgSettings";
import { collectCapped } from "./lib/pagination";
import { startOfMonthInTimezone } from "./lib/quoteDates";
import { ReadBudget } from "./lib/readBudget";
import { assertArrayMax, assertStrLen } from "./lib/fieldGuards";
import * as enums from "./lib/validators";
import { resolveNow } from "./lib/projectSegments";

/**
 * The org Finance hub's reads (UX Phase 17, spec §9j): `quotesPage`, `invoicesPage` and
 * `hubCounts`, so the strip, the money words and the table are all derived from the SAME loaders
 * and cannot disagree. Everything derived is a pure function in `convex/lib/financeHubFacts.ts`.
 *
 * Bounds. Each raw status is read newest-first by `by_organizationId_status` (org and order in the
 * index, THEN the cap, so the cap drops the oldest), and the referenced projects, clients and each
 * candidate job's invoices come from ONE `ReadBudget`. There is NO index that can reach "unpaid" or
 * "overdue" invoices without also reading the settled ones (a paid invoice stays ISSUED), so when the
 * ISSUED scan is cut, the OLDEST rows go, and they are exactly the long-overdue ones. Every figure or
 * count derived from a cut read is therefore flagged (`approx`) and printed as "at least": never a
 * confident number that is too low. Money follows ONE rule (`canSeeJobCost`): absent, never zero,
 * never a sort key.
 *
 * ⚠️ R-8.4.3: `projects.by_cuid` / `clients.by_cuid` / `invoices.by_projectId` are global indexes;
 * every doc fetched through them here is re-checked against `organizationId`.
 */

export const QUOTE_STATUS_CAP = 150; // quote docs carry a frozen snapshot: keep the byte volume bounded too
/** ISSUED is the big one (paid invoices stay ISSUED forever), so it gets the most room; invoice docs are light. */
export const ISSUED_CAP = 1500;
export const OTHER_INVOICE_CAP = 300;
export const CANDIDATE_JOB_CAP = 150;
const JOB_INVOICES_READ = 8;
/** What one job's invoice read can actually scan (`take(n + 1)` reads one past the cap), and so what is reserved first. */
export const JOB_INVOICES_TAKE = JOB_INVOICES_READ + 1;
/**
 * Worst-case documents ONE query scans (Convex's limit is 16,384), `hubCounts` being the heaviest:
 *   quotes      6 statuses x (150 + 1)                      =   906
 *   invoices    ISSUED (1,500 + 1) + DRAFT/VOID 2 x (300+1) = 2,103
 *   candidates  8 statuses x (150 + 1) jobs                 = 1,208
 *   orgSettings 1                                           =     1
 *   subtotal (the fixed scans)                              = 4,218
 *   + READ_BUDGET: referenced projects, clients and each candidate job's invoices, every one reserved
 *     BEFORE it is read (`JOB_INVOICES_READ + 1` per job: `take()` can read one past the cap)  = 7,500
 *   worst case                                                     = 11,718 (< 12,000, with headroom under 16,384)
 */
export const READ_BUDGET = 7500;
const MAX_PAGE = 100;

const QUOTE_RAW_STATUSES = ["DRAFT", "SENT", "PUBLISHED", "ACCEPTED", "DECLINED", "SUPERSEDED"] as const;
const INVOICE_RAW_STATUSES = ["DRAFT", "ISSUED", "VOID"] as const;
/** Jobs the client has agreed to (gear is held from the money phase on): the candidates for a deposit still to raise. */
const DEPOSIT_CANDIDATE_STATUSES = ["AWAITING_PAYMENT", "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED"] as const;

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
  return { ref };
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
      collectCapped(ctx.db.query("invoices").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).order("desc"), status === "ISSUED" ? ISSUED_CAP : OTHER_INVOICE_CAP),
    ),
  );
  const invoices = scans.flatMap((s) => s.rows);
  const { ref } = await loadRefs(ctx, orgId, new Set(invoices.map((i) => i.projectId)), budget);
  const rows = invoices.map((i) => invoiceHubRow(i, ref(i.projectId), now, showMoney));
  // The scan is ordered by `_creationTime`, NOT by `issuedAt` (an old draft can be issued today), so a cut ISSUED
  // scan says nothing about which issue dates were lost: every figure from it, "this month" included, is a floor.
  return { rows, truncated: scans.some((s) => s.truncated), issuedTruncated: scans[1].truncated };
}

/**
 * Jobs still to invoice a deposit for. Candidates are the agreed jobs (newest first, capped); each one's
 * invoices are read through `invoices.by_projectId` (org-checked, from the budget) and the SAME rule the
 * job page uses decides (`depositDueForJob`). A candidate the budget cannot cover is NOT shown as due: it
 * is counted as `unknown`, and the count is flagged as a floor.
 */
async function loadDepositDue(ctx: QueryCtx, orgId: string, showMoney: boolean, budget: ReadBudget) {
  const scans = await Promise.all(
    DEPOSIT_CANDIDATE_STATUSES.map((status) =>
      collectCapped(ctx.db.query("projects").withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", status)).order("desc"), CANDIDATE_JOB_CAP),
    ),
  );
  const jobs = scans.flatMap((s) => s.rows).filter((p) => p.isTemplate !== true);
  const clientIds = [...new Set(jobs.map((p) => p.clientId).filter((c): c is string => !!c))];
  const grantedClients = clientIds.slice(0, budget.take(clientIds.length));
  const clientDocs = await Promise.all(grantedClients.map((id) => ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique()));
  const clients = new Map(clientDocs.filter((c): c is NonNullable<typeof c> => !!c && c.organizationId === orgId).map((c) => [c.id, c]));

  const rows: DepositDueRow[] = [];
  let unknown = 0;
  for (const p of jobs) {
    const verdict = await jobDepositVerdict(ctx, orgId, p, clients, showMoney, budget);
    if (verdict === "unknown") unknown += 1;
    else if (verdict) rows.push(verdict);
  }
  return { rows, unknown, truncated: scans.some((s) => s.truncated) || unknown > 0 };
}

type DepositDueRow = { id: string; projectNumber: string; name: string; clientName: string | null; depositPercent: number; amount?: number };

/** One candidate job: due (a row), not due (null), or `unknown` when the budget/read can't say whether invoicing has started. */
async function jobDepositVerdict(
  ctx: QueryCtx,
  orgId: string,
  p: Doc<"projects">,
  clients: Map<string, Doc<"clients">>,
  showMoney: boolean,
  budget: ReadBudget,
): Promise<DepositDueRow | null | "unknown"> {
  if (budget.take(JOB_INVOICES_TAKE) < JOB_INVOICES_TAKE) return "unknown"; // reserve what take() can actually read
  const inv = await ctx.db.query("invoices").withIndex("by_projectId", (q) => q.eq("projectId", p.id)).take(JOB_INVOICES_TAKE);
  if (inv.length >= JOB_INVOICES_TAKE) return "unknown"; // more invoices than we read: whether invoicing has started is not known
  const client = p.clientId ? (clients.get(p.clientId) ?? null) : null;
  const d = depositDueForJob(inv.filter((i) => i.organizationId === orgId), client, Number(p.total) || 0);
  if (!d.due) return null;
  return depositRow(p, client?.name ?? null, d, showMoney);
}

/** The deposit to raise is money: absent without job-cost visibility. */
function depositRow(p: Doc<"projects">, clientName: string | null, d: { percent: number; amount: number | null }, showMoney: boolean): DepositDueRow {
  const row: DepositDueRow = { id: p.id, projectNumber: p.projectNumber, name: p.name, clientName, depositPercent: d.percent };
  if (showMoney && d.amount != null) row.amount = d.amount;
  return row;
}

/** Sort (a refused/hidden-money key is the default order, ascending) and page: the one tail both lists share. */
function sortAndPage<R extends { id: string }>(
  rows: R[],
  a: { sortBy?: string; sortOrder?: "asc" | "desc"; page?: number; pageSize?: number },
  allowed: ReadonlySet<string>,
  value: (row: R, key: string) => unknown,
  showMoney: boolean,
) {
  const { page, pageSize } = pageArgs(a);
  const asked = allowed.has(a.sortBy ?? "") && (a.sortBy !== "total" || showMoney);
  const sortBy = asked ? (a.sortBy as string) : "number";
  const d = asked && a.sortOrder === "desc" ? -1 : 1;
  const sorted = [...rows].sort((x, y) => compareValues(value(x, sortBy), value(y, sortBy), d) || compareValues(x.id, y.id, 1));
  return { ...paginateItems(sorted, page, pageSize), page, pageSize };
}

const knownSeg = <T extends string>(all: readonly T[], seg: string | undefined): T => (all.includes(seg as T) ? (seg as T) : all[0]);

/** What a caller without invoice read gets: nothing (a role check on top of the org match, the navCounts pattern). */
/** The ranges the Sent / Validity / Issued filters offer (`rangeDays`); `issued` also takes `month`. */
const dayRange = v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"));
/** Filter bounds: a Client filter picks a handful of clients, and every id is a short cuid; a search is a few words. */
export const MAX_FILTER_VALUES = 50;
export const MAX_FILTER_ID_LEN = 64;
export const MAX_SEARCH_LEN = 200;
function assertFilterBounds(a: { clientIn?: string[]; kindIn?: string[]; xeroIn?: string[]; search?: string }): void {
  assertArrayMax(a.clientIn, "clientIn", MAX_FILTER_VALUES);
  assertArrayMax(a.kindIn, "kindIn", MAX_FILTER_VALUES);
  assertArrayMax(a.xeroIn, "xeroIn", MAX_FILTER_VALUES);
  for (const id of a.clientIn ?? []) assertStrLen(id, "clientIn", { max: MAX_FILTER_ID_LEN });
  assertStrLen(a.search, "search", { max: MAX_SEARCH_LEN });
}

const NOTHING = { clients: [] as { id: string; name: string }[], items: [], total: 0, totalPages: 0, page: 1, pageSize: 25, truncated: false, moneyVisible: false, now: 0, timezone: null as string | null, kind: "invoices" as const };

export const quotesPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    includeClosed: v.optional(v.boolean()),
    clientIn: v.optional(v.array(v.string())),
    sent: v.optional(dayRange),
    validity: v.optional(dayRange),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "invoice");
    assertFilterBounds(a);
    if (!(await callerMayRead(ctx, a.orgId, "invoice"))) return NOTHING;
    const now = resolveNow(a.now);
    const showMoney = await canSeeJobCost(ctx, a.orgId);
    const budget = new ReadBudget(READ_BUDGET);
    const [{ rows, truncated }, { timezone }] = await Promise.all([loadQuoteRows(ctx, a.orgId, now, showMoney, budget), resolveOrgInvoiceConfig(ctx, a.orgId)]);
    const seg = knownSeg<QuoteSegment>(QUOTE_SEGMENTS, a.segment);
    const filtered = rows.filter(
      (r) => inQuoteSegment(r, seg, a.includeClosed === true) && quotePassesFilters(r, a, now) && (!a.search || matchesSearch(quoteSearchWords(r), a.search)),
    );
    const p = sortAndPage(filtered, a, QUOTE_SORTS, (r, k) => quoteSortValue(r, k, showMoney), showMoney);
    return { ...p, truncated: truncated || budget.truncated, moneyVisible: showMoney, now, timezone: timezone ?? null, kind: "quotes" as const, clients: clientFacets(rows) };
  },
});

async function depositDuePage(
  ctx: QueryCtx,
  a: { orgId: string; search?: string; page?: number; pageSize?: number },
  showMoney: boolean,
  budget: ReadBudget,
  now: number,
  timezone: string | undefined,
) {
  const { rows, truncated } = await loadDepositDue(ctx, a.orgId, showMoney, budget);
  const filtered = rows.filter((r) => !a.search || matchesSearch([r.projectNumber, r.name, r.clientName], a.search));
  const p = sortAndPage(filtered, { page: a.page, pageSize: a.pageSize }, new Set(), (r) => (r as unknown as DepositDueRow).projectNumber, showMoney);
  return { kind: "toRaise" as const, ...p, truncated: truncated || budget.truncated, moneyVisible: showMoney, now, timezone: timezone ?? null };
}

export const invoicesPage = query({
  args: {
    orgId: v.string(),
    now: v.optional(v.number()),
    segment: v.optional(v.string()),
    search: v.optional(v.string()),
    includeVoid: v.optional(v.boolean()),
    clientIn: v.optional(v.array(v.string())),
    kindIn: v.optional(v.array(enums.InvoiceKind)),
    issued: v.optional(v.union(dayRange, v.literal("month"))),
    xeroIn: v.optional(v.array(enums.XeroSyncStatus)),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder,
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "invoice");
    assertFilterBounds(a);
    if (!(await callerMayRead(ctx, a.orgId, "invoice"))) return NOTHING;
    const now = resolveNow(a.now);
    const showMoney = await canSeeJobCost(ctx, a.orgId);
    const seg = knownSeg<InvoiceSegment>(INVOICE_SEGMENTS, a.segment);
    const budget = new ReadBudget(READ_BUDGET);
    const { timezone } = await resolveOrgInvoiceConfig(ctx, a.orgId);

    // Deposit due lists JOBS still to invoice, not invoice rows.
    if (seg === "depositdue") return await depositDuePage(ctx, a, showMoney, budget, now, timezone);

    const { rows, truncated } = await loadInvoiceRows(ctx, a.orgId, now, showMoney, budget);
    const monthStart = startOfMonthInTimezone(now, timezone);
    const filtered = rows.filter(
      (r) => inInvoiceSegment(r, seg, a.includeVoid === true) && invoicePassesFilters(r, a, now, monthStart) && (!a.search || matchesSearch(invoiceSearchWords(r), a.search)),
    );
    const p = sortAndPage(filtered, a, INVOICE_SORTS, (r, k) => invoiceSortValue(r, k, showMoney), showMoney);
    return { kind: "invoices" as const, ...p, truncated: truncated || budget.truncated, moneyVisible: showMoney, now, timezone: timezone ?? null, clients: clientFacets(rows) };
  },
});

/**
 * The head words' counts, both strips, and the four money words (present only with job-cost visibility).
 * `approx` says which of them are a FLOOR because a read was cut: the page prints "at least" for those.
 */
export const hubCounts = query({
  args: { orgId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now: nowArg }) => {
    await requireOrgReadFor(ctx, orgId, "invoice");
    if (!(await callerMayRead(ctx, orgId, "invoice"))) return null;
    const now = resolveNow(nowArg);
    const showMoney = await canSeeJobCost(ctx, orgId);
    const budget = new ReadBudget(READ_BUDGET);
    const { timezone } = await resolveOrgInvoiceConfig(ctx, orgId);
    const [quotes, invoices] = await Promise.all([loadQuoteRows(ctx, orgId, now, showMoney, budget), loadInvoiceRows(ctx, orgId, now, showMoney, budget)]);
    const deposit = await loadDepositDue(ctx, orgId, false, budget);
    const quoteCounts = countBy(quotes.rows, QUOTE_SEGMENTS, (r, k) => inQuoteSegment(r, k, false));
    const invoiceCounts = countBy(invoices.rows, INVOICE_SEGMENTS, (r, k) => inInvoiceSegment(r, k, false));
    invoiceCounts.depositdue = deposit.rows.length;

    const monthStart = startOfMonthInTimezone(now, timezone);
    const quotesApprox = quotes.truncated || budget.truncated;
    const invoicesApprox = invoices.truncated || budget.truncated;
    // A cut ISSUED scan drops the OLDEST-CREATED rows: unpaid/overdue and Paid are floors, and so is "this month" (creation order is not issue order).
    const issuedApprox = invoices.issuedTruncated || budget.truncated;
    return {
      quotes: quoteCounts,
      invoices: invoiceCounts,
      timezone: timezone ?? null,
      truncated: quotesApprox || invoicesApprox || deposit.truncated,
      approx: {
        quotes: quotesApprox,
        invoices: invoicesApprox,
        depositdue: deposit.truncated || budget.truncated,
        words: {
          quoted: quotesApprox,
          awaitingPayment: issuedApprox,
          overdue: issuedApprox,
          invoicedThisMonth: issuedApprox,
        },
      },
      // The money words are ABSENT (not zero) for a caller who can't see job cost.
      ...(showMoney ? { money: moneyWords(quotes.rows, invoices.rows, monthStart) } : {}),
    };
  },
});

export type { QuoteHubRow, InvoiceHubRow };

export const agentOps: AgentOpsAnnotations = {
  quotesPage: { summary: "A page of the org Finance hub's quotes, by derived status (Draft, Sent, Accepted, Expired), searchable and sortable.", danger: "low", mcpTier: 3 },
  invoicesPage: { summary: "A page of the org Finance hub's invoices by derived state (Draft, Issued, Paid, Overdue) or the jobs still to invoice a deposit for.", danger: "low", mcpTier: 3 },
  hubCounts: { summary: "The Finance hub's segment counts and, with job-cost visibility, its money words (quoted, awaiting payment, invoiced this month, overdue), with `approx` flags where a read was cut.", danger: "low", mcpTier: 3 },
};
