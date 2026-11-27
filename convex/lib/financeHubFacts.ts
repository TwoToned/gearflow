import type { Doc } from "../_generated/dataModel";
import { effectiveQuoteStatus, type EffectiveQuoteStatus } from "./quoteState";
import { daysUntilValidUntil } from "./quoteDates";
import { INVOICE_PILL_LABEL, invoiceOutstanding, invoicePillState, type InvoicePillState } from "./invoiceOverdue";

/**
 * The Finance hub's derived facts (UX Phase 17, spec §9j), as pure functions: the quote and
 * invoice row shapes, the segment predicates, the sort keys and the money words. Nothing here is
 * stored. Three rules the hub shares with every other finance surface:
 *
 * - A quote's status is the DERIVED one (`effectiveQuoteStatus`: Expired is `validUntil < now &&
 *   SENT`, `PUBLISHED` reads as `SENT`); an invoice's is the ONE pill (`invoicePillState`, D56:
 *   Overdue outranks Part paid). The stored columns are never branched on here.
 * - Money (`total`, `outstanding`, every money word) exists only when the caller may see job cost
 *   (`canSeeJobCost`): ABSENT, never zero, and never a sort key (a hidden field sorts as blank).
 * - An expired quote shows for 7 days or until acknowledged; older ones live under All only.
 */

export const QUOTE_SEGMENTS = ["all", "draft", "sent", "accepted", "expired"] as const;
export const INVOICE_SEGMENTS = ["all", "draft", "depositdue", "issued", "paid", "overdue"] as const;
export type QuoteSegment = (typeof QUOTE_SEGMENTS)[number];
export type InvoiceSegment = (typeof INVOICE_SEGMENTS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an unacknowledged expired quote stays out of the way of `Expired`. Same rule as financeOrg. */
export const EXPIRED_QUOTE_VISIBLE_DAYS = 7;

export interface HubProjectRef {
  id: string;
  projectNumber: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
}

export interface QuoteHubRow {
  id: string;
  version: number;
  status: EffectiveQuoteStatus;
  /** Expired and acknowledged, or expired more than a week ago: under All only. */
  dismissed: boolean;
  sentAt: number | null;
  validUntil: number | null;
  daysLeft: number | null;
  hasPdf: boolean;
  project: HubProjectRef | null;
  /** The frozen total at send. ABSENT without job-cost visibility. */
  total?: number | null;
}

export interface InvoiceHubRow {
  id: string;
  invoiceNumber: string | null;
  kind: string;
  depositPercent: number | null;
  pill: InvoicePillState;
  pillLabel: string;
  issuedAt: number | null;
  dueDate: number | null;
  /** Whole days past the due day while overdue, else null. */
  overdueDays: number | null;
  hasPdf: boolean;
  xero: { status: string; error: string | null } | null;
  project: HubProjectRef | null;
  /** Both ABSENT without job-cost visibility. */
  total?: number;
  outstanding?: number;
}

function snapshotTotal(snapshot: unknown): number | null {
  const t = snapshot && typeof snapshot === "object" ? (snapshot as { total?: unknown }).total : undefined;
  return typeof t === "number" ? t : null;
}

export function quoteHubRow(quote: Doc<"quotes">, project: HubProjectRef | null, now: number, showMoney: boolean): QuoteHubRow {
  const status = effectiveQuoteStatus(quote, now);
  const dismissed =
    status === "EXPIRED" &&
    (quote.expiredAcknowledgedAt != null || (quote.validUntil != null && now - quote.validUntil > EXPIRED_QUOTE_VISIBLE_DAYS * DAY_MS));
  const row: QuoteHubRow = {
    id: quote.id,
    version: quote.version,
    status,
    dismissed,
    sentAt: quote.sentAt ?? quote.publishedAt ?? null,
    validUntil: quote.validUntil ?? null,
    daysLeft: daysUntilValidUntil(quote.validUntil, now),
    hasPdf: quote.pdfFileId != null,
    project,
  };
  if (showMoney) row.total = snapshotTotal(quote.snapshot);
  return row;
}

/** Whole days past the due day while overdue, else null. */
function overdueDaysOf(pill: InvoicePillState, dueDate: number | undefined, now: number): number | null {
  if (pill !== "OVERDUE" || dueDate == null) return null;
  return Math.max(1, Math.floor((now - (dueDate + DAY_MS)) / DAY_MS) + 1);
}

/** A Xero dot-word exists only for an invoice that has been issued (a draft is never pushed, a void is gone). */
function xeroOf(inv: Doc<"invoices">): InvoiceHubRow["xero"] {
  if (inv.status === "DRAFT" || inv.status === "VOID") return null;
  return { status: inv.xeroSyncStatus ?? "NOT_SYNCED", error: inv.lastSyncError ?? null };
}

const NO_OUTSTANDING: ReadonlySet<InvoicePillState> = new Set(["PAID", "DRAFT", "VOID"]);

export function invoiceHubRow(inv: Doc<"invoices">, project: HubProjectRef | null, now: number, showMoney: boolean): InvoiceHubRow {
  const pill = invoicePillState(inv, now);
  const row: InvoiceHubRow = {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber ?? null,
    kind: inv.kind,
    depositPercent: inv.depositPercent ?? null,
    pill,
    pillLabel: INVOICE_PILL_LABEL[pill],
    issuedAt: inv.issuedAt ?? null,
    dueDate: inv.dueDate ?? null,
    overdueDays: overdueDaysOf(pill, inv.dueDate, now),
    hasPdf: inv.pdfFileId != null,
    xero: xeroOf(inv),
    project,
  };
  if (showMoney) {
    row.total = inv.total;
    row.outstanding = NO_OUTSTANDING.has(pill) ? 0 : invoiceOutstanding(inv);
  }
  return row;
}

/** Quote segments. `All` leaves out declined and superseded revisions unless the caller asks for them. */
export function inQuoteSegment(row: Pick<QuoteHubRow, "status" | "dismissed">, seg: QuoteSegment, includeClosed: boolean): boolean {
  switch (seg) {
    case "draft":
      return row.status === "DRAFT";
    case "sent":
      return row.status === "SENT";
    case "accepted":
      return row.status === "ACCEPTED";
    case "expired":
      return row.status === "EXPIRED" && !row.dismissed;
    case "all":
      return includeClosed || (row.status !== "DECLINED" && row.status !== "SUPERSEDED");
  }
}

/** Invoice segments over the ONE pill. `Deposit due` is not a row of this table (it is a project still to invoice). */
export function inInvoiceSegment(row: Pick<InvoiceHubRow, "pill">, seg: InvoiceSegment, includeVoid: boolean): boolean {
  switch (seg) {
    case "draft":
      return row.pill === "DRAFT";
    case "issued":
      return row.pill === "ISSUED" || row.pill === "PART_PAID";
    case "paid":
      return row.pill === "PAID";
    case "overdue":
      return row.pill === "OVERDUE";
    case "depositdue":
      return false;
    case "all":
      return includeVoid || row.pill !== "VOID";
  }
}

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

type QuoteSort = (row: QuoteHubRow, showMoney: boolean) => unknown;
const QUOTE_SORT_VALUE: Record<string, QuoteSort> = {
  job: (r) => lower(r.project?.projectNumber),
  client: (r) => lower(r.project?.clientName),
  status: (r) => r.status,
  sent: (r) => r.sentAt,
  // A hidden money column is not a sort key: it sorts as blank.
  total: (r, money) => (money ? (r.total ?? null) : null),
  number: (r) => lower(r.project?.projectNumber) + String(r.version).padStart(4, "0"),
};
export const quoteSortValue = (row: QuoteHubRow, key: string, showMoney: boolean): unknown => (QUOTE_SORT_VALUE[key] ?? QUOTE_SORT_VALUE.number)(row, showMoney);

type InvoiceSort = (row: InvoiceHubRow, showMoney: boolean) => unknown;
const INVOICE_SORT_VALUE: Record<string, InvoiceSort> = {
  job: (r) => lower(r.project?.projectNumber),
  client: (r) => lower(r.project?.clientName),
  status: (r) => r.pillLabel,
  issued: (r) => r.issuedAt,
  due: (r) => r.dueDate,
  total: (r, money) => (money ? (r.total ?? null) : null),
  number: (r) => lower(r.invoiceNumber),
};
export const invoiceSortValue = (row: InvoiceHubRow, key: string, showMoney: boolean): unknown => (INVOICE_SORT_VALUE[key] ?? INVOICE_SORT_VALUE.number)(row, showMoney);

export const QUOTE_SORTS = new Set(["number", "job", "client", "status", "sent", "total"]);
export const INVOICE_SORTS = new Set(["number", "job", "client", "status", "issued", "due", "total"]);

/** Free-text search over the row's own words (number, job, client). */
export function quoteSearchWords(row: QuoteHubRow): (string | null)[] {
  return [row.project?.projectNumber ?? null, `${row.project?.projectNumber ?? ""} v${row.version}`, row.project?.name ?? null, row.project?.clientName ?? null];
}
export function invoiceSearchWords(row: InvoiceHubRow): (string | null)[] {
  return [row.invoiceNumber, row.project?.projectNumber ?? null, row.project?.name ?? null, row.project?.clientName ?? null];
}

export interface MoneyWords {
  quoted: number;
  awaitingPayment: number;
  invoicedThisMonth: number;
  overdue: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Start of the calendar month (UTC) containing `now`. The hub's month is UTC, like every date the lists stamp. */
export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

const sumInto = (w: MoneyWords, i: InvoiceHubRow, monthStart: number): void => {
  if (i.pill === "ISSUED" || i.pill === "PART_PAID") w.awaitingPayment += i.outstanding ?? 0;
  if (i.pill === "OVERDUE") w.overdue += i.outstanding ?? 0;
  if (isInvoicedThisMonth(i, monthStart)) w.invoicedThisMonth += i.total ?? 0;
};

const isInvoicedThisMonth = (i: InvoiceHubRow, monthStart: number): boolean =>
  i.issuedAt != null && i.issuedAt >= monthStart && i.pill !== "DRAFT" && i.pill !== "VOID";

/**
 * The four money words, derived on read from rows that carry money (so a caller without job-cost
 * visibility never gets here). Quoted = live SENT quotes; Awaiting payment = what is still owed on
 * issued invoices that are NOT yet overdue; Overdue = what is still owed past the due day;
 * Invoiced this month = issued invoices stamped this month.
 */
export function moneyWords(quotes: QuoteHubRow[], invoices: InvoiceHubRow[], now: number): MoneyWords {
  const monthStart = monthStartUtc(now);
  const w: MoneyWords = { quoted: 0, awaitingPayment: 0, invoicedThisMonth: 0, overdue: 0 };
  for (const q of quotes) if (q.status === "SENT") w.quoted += q.total ?? 0;
  for (const i of invoices) sumInto(w, i, monthStart);
  return { quoted: cents(w.quoted), awaitingPayment: cents(w.awaitingPayment), invoicedThisMonth: cents(w.invoicedThisMonth), overdue: cents(w.overdue) };
}

export function countBy<T, K extends string>(rows: T[], keys: readonly K[], test: (row: T, key: K) => boolean): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) for (const k of keys) if (test(r, k)) out[k] += 1;
  return out;
}
