/**
 * The Finance tab's words-switch state (UX Phase 10, D55): `Quotes` or
 * `Invoices`. The URL (`?fin=invoices`) is the ONLY state — Quotes is the
 * default and is the absence of the param. Anything else parses to Quotes.
 */
export type FinanceView = "quotes" | "invoices";

export function parseFinanceView(param: string | null | undefined): FinanceView {
  return param === "invoices" ? "invoices" : "quotes";
}

/** The query string for a view change: keeps every other param, pins `tab=finance`, omits the default. */
export function financeViewQuery(current: URLSearchParams, view: FinanceView): string {
  const next = new URLSearchParams(current.toString());
  next.set("tab", "finance");
  if (view === "quotes") next.delete("fin");
  else next.set("fin", view);
  return next.toString();
}
