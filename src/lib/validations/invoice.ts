import { z } from "zod";

import { PAYMENT_TERMS_BOUNDS } from "@/lib/invoice-terms";

/**
 * Invoice create form (WS1 #940). `id`/`organizationId`/`projectId`/
 * `clientId` are create-time args the hook supplies directly (mirrors
 * projectSchema's `name`/`projectNumber` split — see validationDrift.test.ts).
 * All money (subtotal/taxAmount/total) is server-computed in
 * `invoicesWrites.ts createNative`, never client input.
 */
export const invoiceSchema = z.object({
  kind: z.enum(["FULL", "DEPOSIT", "BALANCE", "CREDIT"]),
  notes: z.string().max(2000).optional(),
  dueDate: z.union([z.literal(""), z.coerce.date()]).optional().transform((v) => (v === "" ? undefined : v)),
  /** Only meaningful for kind: "DEPOSIT" — which of depositPercent/depositAmount
   *  createNative should read. Defaults server-side to "%" when omitted. */
  depositMode: z.enum(["%", "$"]).optional(),
  /** % of the tax-inclusive total to invoice, used when depositMode is "%" (or
   *  omitted). Defaults to the client's `profileDepositPercent` (or 25) when
   *  omitted — see use-invoice-writes.ts. */
  depositPercent: z.coerce.number().min(0).max(100).optional(),
  /** Fixed-$ alternative, used when depositMode is "$". Must not exceed the
   *  project's current total — re-validated server-side (R-9.3). */
  depositAmount: z.coerce.number().positive().optional(),
});

export type InvoiceFormValues = z.input<typeof invoiceSchema>;

/**
 * Invoice ISSUE form (#989 — the issue dialog, distinct from the create form
 * above: an invoice's kind/deposit-% are fixed at create, only date/due-date/
 * notes are still open at issue). No monetary field (R-9.3) — the read-only
 * amount summary the dialog shows comes from the already-created draft row.
 */
export const invoiceIssueSchema = z.object({
  /** Defaults to today. Printed on the PDF. */
  invoiceDate: z.coerce.date().optional(),
  /** Defaults to invoiceDate + the org's `documents.paymentTermsDays`. */
  dueDate: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

export type InvoiceIssueValues = z.input<typeof invoiceIssueSchema>;

export { PAYMENT_TERMS_BOUNDS };
