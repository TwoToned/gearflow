import { z } from "zod";

import { QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";
import { isCountryEnabled } from "@/lib/countries";
import { AUTO_STATUS_KEYS, type AutoStatusKey } from "@/lib/project-status-automation";
import { UNANSWERED_OFFER_HOURS_BOUNDS } from "@/lib/crew-time-settings";
import { FOLLOW_UP_BOUNDS } from "../../../convex/lib/followUpRules";

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

// No exported `z.input<...>` type here (unlike orgDocumentSettingsSchema's
// OrgDocumentSettingsValues, which predates this and is itself already an
// unused-export ratchet baseline entry) — nothing outside this file needs to
// name the shape yet, and an exported-but-unimported type is dead code
// (R-4.2, the knip ratchet). Add one back only when a real consumer needs it.

/**
 * #1160 — project status automation opt-outs (`OrgSettings.projectStatusAutomation`).
 * Every key is optional and absent means ENABLED, so this schema only ever
 * validates the shape of an explicit opt-out; the default lives in one place,
 * `isAutoStatusEnabled` (`src/lib/project-status-automation.ts`), never here.
 * Keys are derived from `AUTO_STATUS_KEYS` rather than re-typed, so adding a
 * trigger can't leave the validator behind (R-3.1/R-8.6.3).
 */
export const projectStatusAutomationSchema = z.object(
  Object.fromEntries(AUTO_STATUS_KEYS.map((k) => [k, z.boolean().optional()])) as {
    [K in AutoStatusKey]: z.ZodOptional<z.ZodBoolean>;
  },
).strict();

/**
 * Work-layer Phase 4 (#1246) — the crew planner's confirmation-layer settings
 * (`OrgSettings.crewTime`). Bounds mirror `src/lib/crew-time-settings.ts`,
 * which is also what the server-side resolvers (`convex/lib/orgSettings.ts`)
 * clamp to — one definition of the bound, not a third copy (R-8.6.3).
 */
export const crewTimeSettingsSchema = z.object({
  unansweredOfferHours: z.coerce
    .number()
    .int()
    .min(UNANSWERED_OFFER_HOURS_BOUNDS.min)
    .max(UNANSWERED_OFFER_HOURS_BOUNDS.max)
    .optional(),
  callReminderEnabled: z.boolean().optional(),
}).strict();

/**
 * Follow-up automation (FEATUREDOCS/82, `OrgSettings.followUps`). Bounds are
 * `FOLLOW_UP_BOUNDS` — the same constant `resolveOrgFollowUpConfig` clamps to
 * server-side, so the form and the engine can't disagree (R-8.6.3). Absent keys
 * mean the engine defaults; `cutoverAt` is never edited in the UI but must
 * round-trip, so it's accepted here.
 */
const businessDays = z.coerce.number().int().min(FOLLOW_UP_BOUNDS.businessDays.min).max(FOLLOW_UP_BOUNDS.businessDays.max).optional();
export const followUpSettingsSchema = z.object({
  quotesEnabled: z.boolean().optional(),
  invoicesEnabled: z.boolean().optional(),
  firstFollowUpBusinessDays: businessDays,
  nextFollowUpBusinessDays: businessDays,
  decisionLeadDays: z.coerce
    .number()
    .int()
    .min(FOLLOW_UP_BOUNDS.decisionLeadDays.min)
    .max(FOLLOW_UP_BOUNDS.decisionLeadDays.max)
    .optional(),
  cutoverAt: z.number().int().positive().optional(),
}).strict();
