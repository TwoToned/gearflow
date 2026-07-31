import { z } from "zod";

import { QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";

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
