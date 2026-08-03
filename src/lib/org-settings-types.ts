import type { OrgSSOSettings } from "@/lib/sso-types";
import type { IncrementReset } from "@/lib/project-number";
import type { OrgJoinPolicy } from "@/lib/org-join-policy";

/**
 * Pure type definitions for org settings — split out of `server/settings.ts`
 * (a `"use server"` file) so `org-settings-read.ts` can depend on the SHAPE
 * without depending on `server/settings.ts` itself. `server/settings.ts`
 * imports real functions from `org-settings-read.ts`, so the reverse type-only
 * edge closed a circular dependency (POLICY.md R-3.5). `server/settings.ts`
 * re-exports these for its other (non-cyclic) consumers.
 */

export interface OrgBranding {
  primaryColor?: string;
  accentColor?: string;
  documentColor?: string;
  logoUrl?: string;
  iconUrl?: string;
  /** Which image to show on PDFs: "logo" (full width above header), "icon" (inline), or "none" */
  documentLogoMode?: "logo" | "icon" | "none";
  /** Whether to show the org name text on PDF documents (default true) */
  showOrgNameOnDocuments?: boolean;
}

/** Global document settings — footer text, T&Cs, quote validity. Applies to
 *  all 5 project doc types (footer) or just the quote (T&Cs, validity). */
export interface OrgDocumentSettings {
  footerText?: string;
  footerSecondLine?: string;
  /** Org-authored plain text (no tokens). Always rendered on the quote when
   *  set; rendered on the invoice too only when `showTermsAndConditionsOnInvoice`
   *  is also on — quotes have no separate toggle, presence of text is enough. */
  termsAndConditions?: string;
  /** Off by default — an invoice already carries its own payment terms/due
   *  date; T&Cs is opt-in there rather than always-on like the quote. */
  showTermsAndConditionsOnInvoice?: boolean;
  /** Org-authored plain text (no tokens) — bank name, BSB, account number,
   *  reference, etc. Rendered on the invoice only, directly after the totals
   *  block, omitted entirely when unset (same convention as T&Cs). */
  paymentDetails?: string;
  /** Days a quote stays valid from its generation date. Default 30. */
  quoteValidityDays?: number;
  /** Default payment terms for an issued invoice — the due date defaults to
   *  invoiceDate + this many days (#989). Default 14. */
  paymentTermsDays?: number;
}

export interface TestTagSettings {
  prefix?: string;
  digits?: number;
  counter?: number;
  defaultIntervalMonths?: number;
  defaultEquipmentClass?: "CLASS_I" | "CLASS_II" | "CLASS_II_DOUBLE_INSULATED" | "LEAD_CORD_ASSEMBLY";
  dueSoonThresholdDays?: number;
  companyName?: string;
  defaultTestMethod?: "INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH";
  checkoutPolicy?: "WARN" | "BLOCK";
  emailReminders?: boolean;
}

export interface OrgSettings {
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  /** Australian Business Number (or local equivalent tax/business
   *  registration id). Rendered in the PDF header on every doc type, under
   *  the org's address/phone/email — required on Tax Invoices, but shown
   *  wherever the org details block renders, not gated to that one type. */
  abn?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  taxRate?: number;
  taxLabel?: string;
  assetTagPrefix?: string;
  assetTagCounter?: number;
  assetTagDigits?: number;
  /** Auto project-number template (e.g. "%YY%MM%INC"). Empty/undefined = manual entry. */
  projectNumberFormat?: string;
  /** When the project-number increment resets. Default MONTHLY. */
  projectNumberIncrementReset?: IncrementReset;
  /** Zero-pad width for the project-number increment. Default 2. */
  projectNumberIncrementPadding?: number;
  /** WS1 (#940) — invoice-number template, SAME engine as project numbers (zero
   *  engine change — src/lib/project-number.ts), namespaced under a separate
   *  "INV:<period>" scopeKey in the shared projectNumberSequences counter table
   *  so invoice and project numbering never collide or share a counter. Default
   *  "INV-%YYYY-%SEQ". Unlike project numbers, invoices are ALWAYS auto-numbered
   *  (no manual override) — numbered only at issue time (drafts stay unnumbered).
   */
  invoiceNumberFormat?: string;
  /** Default YEARLY (pairs with the "%YYYY" in the default format). */
  invoiceNumberIncrementReset?: IncrementReset;
  /** Default 4 (pairs with "INV-2026-0001"). */
  invoiceNumberIncrementPadding?: number;
  branding?: OrgBranding;
  documents?: OrgDocumentSettings;
  testTag?: TestTagSettings;
  icalToken?: string;
  icalEnabled?: boolean;
  prepKitCategoryId?: string;
  sso?: OrgSSOSettings;
  /** B2 (#1094) — governs whether a non-member can self-serve request to join
   *  via verified-domain match. Absent = `INVITE_ONLY` (see
   *  `src/lib/org-join-policy.ts` for the full policy + default). */
  joinPolicy?: OrgJoinPolicy;
}
