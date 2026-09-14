import { z } from "zod";

import { QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";
import { isCountryEnabled } from "@/lib/countries";

/**
 * Global document settings (footer text, terms & conditions, quote
 * validity) — org-level, part of the `orgSettings` Convex blob
 * (`OrgSettings.documents`, see `src/lib/org-settings-types.ts`). Bounds
 * mirrored server-side per R-8.6.2; the only write path is
 * `updateOrganization` (`src/server/settings.ts`).
 */
export const orgDocumentSettingsSchema = z.object({
  footerText: z.string().max(200).optional(),
  footerSecondLine: z.string().max(200).optional(),
  termsAndConditions: z.string().max(4000).optional(),
  showTermsAndConditionsOnInvoice: z.boolean().optional(),
  paymentDetails: z.string().max(2000).optional(),
  /** Days a quote stays valid from its generation date. Default 30. */
  quoteValidityDays: z.coerce
    .number()
    .int()
    .min(QUOTE_VALIDITY_BOUNDS.min)
    .max(QUOTE_VALIDITY_BOUNDS.max)
    .optional(),
});

export type OrgDocumentSettingsValues = z.input<typeof orgDocumentSettingsSchema>;

/**
 * The setup wizard's "where you operate" screen (C2, #1099) — also reusable
 * anywhere else that ever needs to validate this same field set (only the
 * wizard does today). Country must be one of the enabled launch markets
 * (`src/lib/countries.ts` is the single source of truth for the list — NOT
 * re-declared here); the four country-derived fields (currency/taxLabel/
 * timezone/taxRate) are user-editable after auto-fill, so they're validated
 * for shape, not pinned to match the country's own table row. The business
 * number stays a bare string — `OrgSettings.abn`'s own doc comment says it's
 * "the local equivalent tax/business registration id", and the issue is
 * explicit that only the LABEL varies by country, not the format.
 *
 * `country` is REQUIRED here (this screen is where it's first set) but
 * immutable thereafter — enforced server-side by `withImmutableCountry`
 * (`src/server/settings.ts`), not by this schema, which has no way to know
 * whether the org already has one.
 */
export const orgOperatingDetailsSchema = z.object({
  country: z.string().refine(isCountryEnabled, { message: "Select a country" }),
  currency: z.string().length(3).optional(),
  timezone: z.string().min(1).max(100).optional(),
  taxLabel: z.string().max(30).optional(),
  /** Percent, e.g. 10 for 10%. Genuinely optional — the US ships with no
   *  default rate (#1088) and the UI must not invent one. */
  taxRate: z.coerce.number().min(0).max(100).optional(),
  businessNumber: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional().or(z.literal("")),
  address: z.string().max(300).optional(),
});

export type OrgOperatingDetailsValues = z.input<typeof orgOperatingDetailsSchema>;
