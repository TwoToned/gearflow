import { z } from "zod";

/**
 * "Left blank" for an OPTIONAL money field, mapped to `undefined` — i.e. the
 * field has no value, rendered "—", not "$0.00". The ONE definition (R-3.1):
 * line items, assets, models and every form sheet import it from here.
 *
 * `z.coerce.number()` alone cannot express that: an untouched `<input
 * type="number">` submits `""`, and `Number("")` is `0`, so `.optional()` never
 * gets a look in. Every blank price landed as a REAL, explicit $0 (#1249) —
 * which suppressed the server's auto-pricing (`fields.unitPrice == null` was
 * never true) and, until #1249 changed it, excluded that gear from revenue
 * allocation entirely, so anything added to a Project Group reported $0 ROI.
 *
 * A typed `0` still parses to `0`: a deliberate free line is a real choice and
 * stays distinguishable from a blank one.
 *
 * Declared with an explicit input type so `z.input<typeof schema>` — what the
 * forms are typed on (CLAUDE.md, Forms & Validation) — keeps accepting the
 * `string | number | undefined` a React Hook Form register() actually yields,
 * instead of collapsing to `unknown` the way a bare `z.preprocess` would.
 */
export const blankableNumber = (
  schema: z.ZodType<number, number>,
): z.ZodType<number | undefined, string | number | null | undefined> =>
  z.optional(
    z
      .union([z.literal(""), z.null(), z.coerce.number().pipe(schema)])
      .transform((v) => (v === "" || v === null ? undefined : v)),
  ) as unknown as z.ZodType<number | undefined, string | number | null | undefined>;
