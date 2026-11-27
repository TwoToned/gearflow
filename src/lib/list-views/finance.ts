/**
 * The Finance hub's two lists as data (UX Phase 17, spec §9j): Quotes and Invoices. Pure: no React,
 * no router, no Convex. `FinanceHub` supplies the queries and handlers; this module says what each
 * list IS (segments, columns, URL spec, row mapping, the money words and their deep links), so a test
 * can pin it without rendering anything.
 *
 * Statuses are the DERIVED ones the server sends (`effectiveQuoteStatus`, the one invoice pill, D56:
 * Overdue outranks Part paid): this module never reads a stored status column. Money columns and the
 * money words exist only when the server sent them: ABSENT, never a column of zeros or dashes.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, StatusValue } from "@/lib/primitives/types";
import { quoteStatusIntent, type ColorIntent } from "@/lib/status-colors";
import type { InvoicePillState } from "../../../convex/lib/invoiceOverdue";
import { invoicePillValue } from "@/lib/invoice-pill";

export type HubTab = "quotes" | "invoices";
export const HUB_TABS: readonly HubTab[] = ["quotes", "invoices"];
export const parseHubTab = (raw: string | null | undefined): HubTab => (raw === "invoices" ? "invoices" : "quotes");

/** `26 Nov` in the ORG's timezone (invoices and quotes are stamped in it, so a UTC label can print the wrong day). */
const dateLabel = (ms: number, timeZone?: string | null) => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: timeZone ?? undefined });
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
const text = (label: string | null | undefined): Fact | undefined => (label ? { kind: "text", label } : undefined);

function defined(facts: Record<string, Fact | undefined>): Record<string, Fact> {
  return Object.fromEntries(Object.entries(facts).filter((e): e is [string, Fact] => e[1] != null));
}

// ─── URL specs ───────────────────────────────────────────────────────────

const QUOTE_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "expired", label: "Expired" },
] as const;
const INVOICE_SEGMENTS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "depositdue", label: "Deposit due" },
  { key: "issued", label: "Issued" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
] as const;

export const QUOTES_SPEC: ListUrlSpec = {
  segments: QUOTE_SEGMENTS.map((s) => s.key),
  filters: ["show"],
  sorts: ["number", "job", "client", "status", "sent", "total"],
  defaultSort: "sent:desc",
};
export const INVOICES_SPEC: ListUrlSpec = {
  segments: INVOICE_SEGMENTS.map((s) => s.key),
  filters: ["show"],
  sorts: ["number", "job", "client", "status", "issued", "due", "total"],
  defaultSort: "issued:desc",
};
export const specFor = (tab: HubTab): ListUrlSpec => (tab === "quotes" ? QUOTES_SPEC : INVOICES_SPEC);

/** Declined and superseded quotes, or void invoices, are under All only after asking (the Jobs `cancelled` idiom). */
export const hubFilters = (tab: HubTab): ListFilterDef[] => [
  { key: "show", label: "Also show", single: true, options: [tab === "quotes" ? { value: "closed", label: "Declined and superseded" } : { value: "void", label: "Void invoices" }] },
];

/**
 * The strip. A count derived from a CUT read is a floor, and a strip count is a bare number, so while the
 * tab's read is cut its counts are left off (the head sub line says `at least`): never a confident figure
 * that is too low. `Deposit due` is judged on its own (it has its own read).
 */
export function hubSegments(tab: HubTab, counts: Record<string, number> | undefined, approx?: { tab?: boolean; depositdue?: boolean }): ListSegment[] {
  const defs = tab === "quotes" ? QUOTE_SEGMENTS : INVOICE_SEGMENTS;
  return defs.map((s) => ({ key: s.key, label: s.label, count: (s.key === "depositdue" ? approx?.depositdue : approx?.tab) ? undefined : counts?.[s.key] }));
}

/** The shared query contract: every hub list sends the same page / sort / search shape. */
export function hubQueryArgs(tab: HubTab, state: ListUrlState, now: number) {
  const show = state.filters.show?.[0];
  return {
    segment: state.seg,
    search: state.q.trim() || undefined,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    now,
    ...(tab === "quotes" ? { includeClosed: show === "closed" } : { includeVoid: show === "void" }),
  };
}

// ─── Money words ─────────────────────────────────────────────────────────

export interface HubMoney {
  quoted: number;
  awaitingPayment: number;
  invoicedThisMonth: number;
  overdue: number;
}

export interface MoneyWord {
  key: keyof HubMoney;
  label: string;
  /** `$12,346`, or `at least $12,346` when the read behind it was cut. */
  amount: string;
  /** Each word is a link to the list it counts (`?tab=invoices&seg=overdue`). */
  href: string;
  tone: "error" | "neutral";
}

const floor = (n: number, approx: boolean | undefined) => `${approx ? "at least " : ""}${dollars(n)}`;

/** The four words, or none: a caller below the job-cost line gets no `money` and so no words at all. */
export function moneyWords(money: HubMoney | undefined, approx?: Partial<Record<keyof HubMoney, boolean>>): MoneyWord[] {
  if (!money) return [];
  return [
    { key: "quoted", label: "Quoted", amount: floor(money.quoted, approx?.quoted), href: "/finance?tab=quotes&seg=sent", tone: "neutral" },
    { key: "awaitingPayment", label: "Awaiting payment", amount: floor(money.awaitingPayment, approx?.awaitingPayment), href: "/finance?tab=invoices&seg=issued", tone: "neutral" },
    { key: "invoicedThisMonth", label: "Invoiced this month", amount: floor(money.invoicedThisMonth, approx?.invoicedThisMonth), href: "/finance?tab=invoices&seg=all", tone: "neutral" },
    { key: "overdue", label: "Overdue", amount: floor(money.overdue, approx?.overdue), href: "/finance?tab=invoices&seg=overdue", tone: money.overdue > 0 ? "error" : "neutral" },
  ];
}

// ─── Columns ─────────────────────────────────────────────────────────────

export function quoteColumns(moneyVisible: boolean): FactColumn[] {
  return [
    { id: "job", header: "Job", sortKey: "job" },
    { id: "status", header: "Status", sortKey: "status" },
    { id: "sent", header: "Sent", sortKey: "sent" },
    ...(moneyVisible ? [{ id: "total", header: "Total", sortKey: "total", align: "end" as const }] : []),
  ];
}

export function invoiceColumns(moneyVisible: boolean, xeroConnected: boolean): FactColumn[] {
  return [
    { id: "job", header: "Job", sortKey: "job" },
    { id: "status", header: "Status", sortKey: "status" },
    { id: "issued", header: "Issued", sortKey: "issued" },
    ...(xeroConnected ? [{ id: "xero", header: "Xero" }] : []),
    ...(moneyVisible ? [{ id: "total", header: "Total", sortKey: "total", align: "end" as const }] : []),
  ];
}

// ─── Rows ────────────────────────────────────────────────────────────────

interface HubProjectSource {
  id: string;
  projectNumber: string;
  name: string;
  clientName: string | null;
}

export interface QuoteSource {
  id: string;
  version: number;
  status: string;
  dismissed: boolean;
  sentAt: number | null;
  validUntil: number | null;
  daysLeft: number | null;
  hasPdf: boolean;
  project: HubProjectSource | null;
  total?: number | null;
}

export interface InvoiceSource {
  id: string;
  invoiceNumber: string | null;
  kind: string;
  depositPercent: number | null;
  pill: InvoicePillState;
  pillLabel: string;
  issuedAt: number | null;
  dueDate: number | null;
  overdueDays: number | null;
  hasPdf: boolean;
  xero: { status: string; error: string | null } | null;
  project: HubProjectSource | null;
  total?: number;
  outstanding?: number;
}

export interface ToRaiseSource {
  id: string;
  projectNumber: string;
  name: string;
  clientName: string | null;
  depositPercent: number;
  amount?: number;
}

const financeHref = (projectId: string) => `/projects/${projectId}?tab=finance`;
const jobFact = (p: HubProjectSource | null): Fact | undefined => (p ? text(`${p.projectNumber} · ${p.clientName ?? "No client"}`) : undefined);

/** Derived quote status words (DRAFT, SENT, ACCEPTED, EXPIRED ...), colour from the one `quote` intent table. */
export function quoteStatusValue(status: string): StatusValue {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return { label, intent: quoteStatusIntent(status) };
}

/** `5d left`, `expired 3d ago`: the line under a sent quote's status (never a money figure). */
export function quoteWhenLine(q: Pick<QuoteSource, "status" | "daysLeft">): string | undefined {
  if (q.daysLeft == null) return undefined;
  if (q.status === "SENT") return q.daysLeft >= 0 ? `${q.daysLeft}d left` : undefined;
  if (q.status === "EXPIRED") return `expired ${Math.abs(q.daysLeft)}d ago`;
  return undefined;
}

/** A sent quote inside its last week, or a fresh expiry, is the thing to chase: a dot-word on the row. */
function quoteFlags(q: QuoteSource): LineRowData["flags"] {
  if (q.status === "SENT" && q.daysLeft != null && q.daysLeft >= 0 && q.daysLeft <= 7) return [{ label: `${q.daysLeft}d left`, tone: "warning" }];
  if (q.status === "EXPIRED" && !q.dismissed) return [{ label: quoteWhenLine(q) ?? "Expired", tone: "error" }];
  return [];
}

export function quoteRow(q: QuoteSource, menu?: ActionMenuSpec, timeZone?: string | null): LineRowData {
  const num = q.project?.projectNumber ?? "—";
  return {
    id: q.id,
    kind: "job",
    title: `${num} v${q.version}`,
    subtitle: q.project?.name,
    facts: defined({
      job: jobFact(q.project),
      sent: text(q.sentAt == null ? undefined : dateLabel(q.sentAt, timeZone)),
      // Absent when the server did not send it; a sent quote's frozen total prints, a draft has none.
      total: q.total != null ? { kind: "money", amount: q.total } : undefined,
    }),
    status: quoteStatusValue(q.status),
    flags: quoteFlags(q),
    menu,
    href: q.project ? financeHref(q.project.id) : undefined,
  };
}

const XERO_WORDS: Record<string, string> = { SYNCED: "Synced", NOT_SYNCED: "Not in Xero", PENDING: "Pending", ERROR: "Failed" };

export function invoiceKindLine(i: Pick<InvoiceSource, "kind" | "depositPercent">): string {
  if (i.kind === "DEPOSIT") return i.depositPercent != null ? `Deposit ${i.depositPercent}%` : "Deposit";
  return ({ FULL: "Full", BALANCE: "Balance", CREDIT: "Credit note" } as Record<string, string>)[i.kind] ?? i.kind;
}

/** What sits under the status: `$2,950 to go` (money only), or the days late. */
export function invoiceStatusLine(i: Pick<InvoiceSource, "pill" | "overdueDays" | "outstanding">): string | undefined {
  const owed = i.outstanding != null && i.outstanding > 0 ? `${dollars(i.outstanding)} to go` : undefined;
  if (i.pill === "OVERDUE") return [i.overdueDays != null ? `${i.overdueDays}d overdue` : undefined, owed].filter(Boolean).join(" · ") || undefined;
  if (i.pill === "PART_PAID") return owed;
  return undefined;
}

export function invoiceRow(i: InvoiceSource, menu?: ActionMenuSpec, timeZone?: string | null): LineRowData {
  return {
    id: i.id,
    kind: "job",
    title: i.invoiceNumber ?? "Draft invoice",
    subtitle: invoiceKindLine(i),
    facts: defined({
      job: jobFact(i.project),
      issued: text(i.issuedAt == null ? undefined : dateLabel(i.issuedAt, timeZone)),
      xero: i.xero ? text(XERO_WORDS[i.xero.status] ?? i.xero.status) : undefined,
      total: i.total != null ? { kind: "money", amount: i.total } : undefined,
    }),
    // The ONE pill (D56): Overdue outranks Part paid. Colour comes from `invoicePillValue`'s intent table.
    status: invoicePillValue(i.pill),
    flags: [],
    menu,
    href: i.project ? financeHref(i.project.id) : undefined,
  };
}

/** A job still to invoice a deposit for (the `Deposit due` segment): a project row, not an invoice. */
export function toRaiseRow(r: ToRaiseSource): LineRowData {
  return {
    id: r.id,
    kind: "job",
    title: `${r.projectNumber} · ${r.name}`,
    subtitle: `Raise ${r.depositPercent}% deposit`,
    facts: defined({
      job: text(r.clientName),
      total: r.amount != null ? { kind: "money", amount: r.amount } : undefined,
    }),
    status: { label: "Deposit due", intent: "warning" as ColorIntent },
    href: financeHref(r.id),
  };
}

const atLeast = (cut: boolean | undefined) => (cut ? "at least " : "");
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The head sub line: `27 quotes \u00b7 20 invoices`, with `at least` on whichever count a read cap may have cut. */
export function hubSubline(counts: { quotes?: { all?: number }; invoices?: { all?: number }; approx?: { quotes?: boolean; invoices?: boolean } } | undefined): string | undefined {
  if (!counts) return undefined;
  return `${atLeast(counts.approx?.quotes)}${plural(counts.quotes?.all ?? 0, "quote")} \u00b7 ${atLeast(counts.approx?.invoices)}${plural(counts.invoices?.all ?? 0, "invoice")}`;
}

/** The head words `Quotes 27` / `Invoices 20+` (a plus where the count is a floor). */
export function hubHeadWords(
  tab: HubTab,
  counts: { quotes: { all: number }; invoices: { all: number }; approx: { quotes: boolean; invoices: boolean } } | null | undefined,
) {
  const word = { quotes: "Quotes", invoices: "Invoices" } as const;
  return {
    value: tab,
    words: HUB_TABS.map((k) => ({ key: k, label: `${word[k]}${counts ? ` ${counts[k].all}${counts.approx[k] ? "+" : ""}` : ""}`, href: `/finance?tab=${k}` })),
  };
}
