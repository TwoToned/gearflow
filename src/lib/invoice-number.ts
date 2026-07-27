/**
 * Invoice numbering (WS1 #940) — zero engine change from src/lib/project-number.ts.
 * Invoices reuse the exact same template/scopeKey/counter engine project numbers
 * use; the only addition here is a namespace PREFIX so the invoice counter and
 * the project-number counter never collide inside the shared
 * `projectNumberSequences` table (same table, disjoint scopeKey space).
 *
 * Unlike project numbers, invoices have no manual-entry fallback — every issued
 * invoice is numbered by this engine, at issue time (drafts stay unnumbered).
 */
import type { IncrementReset } from "./project-number";

export const DEFAULT_INVOICE_NUMBER_FORMAT = "INV-%YYYY-%SEQ";
export const DEFAULT_INVOICE_NUMBER_INCREMENT_RESET: IncrementReset = "YEARLY";
export const DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING = 4;

/** Prefix that separates the invoice counter's scopeKey space from the project
 *  number counter's — see convex/invoicesWrites.ts `issueNative`. */
export const INVOICE_SCOPE_PREFIX = "INV:";
