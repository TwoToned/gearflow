/**
 * Invoice numbering (WS1 #940) — zero engine change from src/lib/project-number.ts.
 * Invoices reuse the exact same template/scopeKey/counter engine project numbers
 * use. The namespace prefix that keeps the invoice counter and the project-
 * number counter from colliding inside the shared `projectNumberSequences`
 * table lives only on the Convex side (`convex/invoicesWrites.ts`
 * `issueNative` — literal `"INV:"`, since Convex can't import this src/lib
 * module) — there is no src-side consumer of that prefix to share a constant
 * with.
 *
 * Unlike project numbers, invoices have no manual-entry fallback — every issued
 * invoice is numbered by this engine, at issue time (drafts stay unnumbered).
 */
import type { IncrementReset } from "./project-number";

export const DEFAULT_INVOICE_NUMBER_FORMAT = "INV-%YYYY-%SEQ";
export const DEFAULT_INVOICE_NUMBER_INCREMENT_RESET: IncrementReset = "YEARLY";
export const DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING = 4;
