import { z } from "zod";

/**
 * Quote publish form (WS1 #940) — the only client input on publish is an
 * optional note; every money field is server-computed (buildFinanceLines +
 * the project's own recalc-owned totals — R-9.3, never trust client money).
 */
export const quoteSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export type QuoteFormValues = z.input<typeof quoteSchema>;
