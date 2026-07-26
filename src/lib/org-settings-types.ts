import type { OrgSSOSettings } from "@/lib/sso-types";
import type { IncrementReset } from "@/lib/project-number";

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
  termsAndConditions?: string;
  /** Days a quote stays valid from its generation date. Default 30. */
  quoteValidityDays?: number;
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
  branding?: OrgBranding;
  documents?: OrgDocumentSettings;
  testTag?: TestTagSettings;
  icalToken?: string;
  icalEnabled?: boolean;
  prepKitCategoryId?: string;
  sso?: OrgSSOSettings;
}
