import { toCsv } from "@/lib/csv";
import type { InvoiceSource, QuoteSource } from "@/lib/list-views/finance";

/**
 * Finance hub exports (UX Phase 17): selected rows as CSV, built ONLY through `toCsv` (`src/lib/csv.ts`,
 * the formula-injection guard: a client or job name that starts with `=`/`+`/`@` can't run in a spreadsheet).
 * Money follows the one rule: a money column exists only when the server sent money for the rows (absent,
 * never a column of zeros), and a row's own `total`/`outstanding` is printed as the server derived it.
 */
const isoDay = (ms: number | null, timeZone?: string | null) => (ms == null ? "" : new Date(ms).toLocaleDateString("en-CA", { timeZone: timeZone ?? undefined }));
const money = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));

export function quotesCsv(rows: QuoteSource[], timeZone?: string | null): string {
  const withMoney = rows.some((r) => r.total !== undefined);
  const header = ["Quote", "Job", "Client", "Status", "Sent", "Valid until", ...(withMoney ? ["Total"] : [])];
  const body = rows.map((r) => [
    `${r.project?.projectNumber ?? ""} v${r.version}`,
    r.project?.name ?? "",
    r.project?.clientName ?? "",
    r.status,
    isoDay(r.sentAt, timeZone),
    isoDay(r.validUntil, timeZone),
    ...(withMoney ? [money(r.total)] : []),
  ]);
  return toCsv(header, body);
}

export function invoicesCsv(rows: InvoiceSource[], timeZone?: string | null): string {
  const withMoney = rows.some((r) => r.total !== undefined);
  const header = ["Invoice", "Kind", "Job", "Client", "Status", "Issued", "Due", "Xero", ...(withMoney ? ["Total", "Still owed"] : [])];
  const body = rows.map((r) => [
    r.invoiceNumber ?? "",
    r.kind,
    r.project?.projectNumber ?? "",
    r.project?.clientName ?? "",
    r.pillLabel,
    isoDay(r.issuedAt, timeZone),
    isoDay(r.dueDate, timeZone),
    r.xero?.status ?? "",
    ...(withMoney ? [money(r.total), money(r.outstanding)] : []),
  ]);
  return toCsv(header, body);
}
