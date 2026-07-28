import { z } from "zod";

import { QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";

/**
 * Quote revision forms (WS1 #940, reworked by #986). ONE base schema; every
 * variant is DERIVED from it with `.pick()`/`.extend()` rather than re-declaring
 * the shared fields — a second hand-maintained copy of the same bounds is a
 * defect even while in sync (R-8.6.3 / R-3.1).
 *
 * Client validation is UX only. Every bound here is mirrored server-side in
 * `convex/quotesWrites.ts` via `convex/lib/fieldGuards.ts`, because these
 * mutations are browser-direct and a caller with a valid session can invoke them
 * without ever running this parse (FEATUREDOCS/54 "the write security bar").
 *
 * There is no monetary field anywhere in this file, by design (R-9.3): a send
 * carries dates, a contact and free text; every figure is computed server-side
 * from the project's own recalc-owned totals.
 */
const quoteBaseSchema = z.object({
  /** Notes to the client, printed on the quote. */
  notes: z.string().max(2000).optional(),
  /** Date printed on the PDF and the anchor for validity. Defaults to today. */
  quoteDate: z.coerce.date().optional(),
  /** Defaults to the org's `documents.quoteValidityDays` when omitted. */
  validityDays: z.coerce
    .number()
    .int()
    .min(QUOTE_VALIDITY_BOUNDS.min)
    .max(QUOTE_VALIDITY_BOUNDS.max)
    .optional(),
  /** A contact on THIS project's client — server-validated against both. */
  recipientContactId: z.string().optional(),
  /** PO number, email subject, "verbal — call 26/7" … */
  acceptanceRef: z.string().max(200).optional(),
  /** Why a revision was recalled or declined. The floor differs per verb below. */
  reason: z.string().max(1000).optional(),
  /** When the client accepted. Defaults to today. */
  acceptedAt: z.coerce.date().optional(),
});

/** Send — freezes the revision. */
export const quoteSendSchema = quoteBaseSchema.pick({
  notes: true,
  quoteDate: true,
  validityDays: true,
  recipientContactId: true,
});

/** Recall — un-send. Reuses #793's 10-character justification floor: this
 *  un-sends a document the client may already be holding, so "why" isn't
 *  optional. */
export const quoteRecallSchema = quoteBaseSchema
  .pick({ reason: true })
  .extend({ reason: z.string().min(10).max(1000) });

/** Accept — unblocks CONFIRMED. */
export const quoteAcceptSchema = quoteBaseSchema.pick({ acceptedAt: true, acceptanceRef: true });

/** Decline — a shorter floor than recall; "Too expensive" is a real answer. */
export const quoteDeclineSchema = quoteBaseSchema
  .pick({ reason: true })
  .extend({ reason: z.string().min(3).max(1000) });

export type QuoteSendValues = z.input<typeof quoteSendSchema>;
export type QuoteRecallValues = z.input<typeof quoteRecallSchema>;
export type QuoteAcceptValues = z.input<typeof quoteAcceptSchema>;
export type QuoteDeclineValues = z.input<typeof quoteDeclineSchema>;
