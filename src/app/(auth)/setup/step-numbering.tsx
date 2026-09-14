"use client";
// use-client: interactive — form state, Convex-backed hooks (R-8.1.1)

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "../auth-playful";
import { WizardRail } from "@/components/ui/wizard-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProjectNumberingSettings } from "@/components/settings/project-numbering-settings";
import { InvoiceNumberingSettings } from "@/components/settings/invoice-numbering-settings";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";
import { useLocations } from "@/hooks/use-locations";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { updateOrganization, getOrganization } from "@/server/settings";
import {
  DEFAULT_INCREMENT_RESET,
  DEFAULT_INCREMENT_PADDING,
  validateProjectNumberFormat,
  type IncrementReset,
} from "@/lib/project-number";
import {
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_INCREMENT_RESET,
  DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING,
} from "@/lib/invoice-number";
import { DEFAULT_QUOTE_VALIDITY_DAYS, QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";
import { DEFAULT_PAYMENT_TERMS_DAYS, PAYMENT_TERMS_BOUNDS } from "@/lib/invoice-terms";
import type { OrgSettings, OrgDocumentSettings } from "@/lib/org-settings-types";
import { logger } from "@/lib/logger";
import { TOTAL_STEPS } from "./wizard-steps";
import { capture, AnalyticsEvent, type SetupStepId } from "@/lib/analytics";

interface OrgRecord {
  name?: string;
  settings?: OrgSettings;
}

interface NumberingFields {
  projectNumberFormat: string;
  projectNumberReset: IncrementReset;
  projectNumberPadding: number;
  invoiceNumberFormat: string;
  invoiceNumberReset: IncrementReset;
  invoiceNumberPadding: number;
  assetTagPrefix: string;
  assetTagDigits: number;
  footerText: string;
  termsAndConditions: string;
  paymentDetails: string;
  quoteValidityDays: number;
  paymentTermsDays: number;
}

const EMPTY_FIELDS: NumberingFields = {
  projectNumberFormat: "",
  projectNumberReset: DEFAULT_INCREMENT_RESET,
  projectNumberPadding: DEFAULT_INCREMENT_PADDING,
  invoiceNumberFormat: "",
  invoiceNumberReset: DEFAULT_INVOICE_NUMBER_INCREMENT_RESET,
  invoiceNumberPadding: DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING,
  assetTagPrefix: "",
  assetTagDigits: 4,
  footerText: "",
  termsAndConditions: "",
  paymentDetails: "",
  quoteValidityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
  paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS,
};

/** Each `fieldsFromOrg` helper below covers a handful of fields — split
 *  purely to keep every function's own cyclomatic complexity under the
 *  R-3.6/complexity-ratchet ceiling (destructuring defaults count as
 *  decision points in this repo's eslint config, same as `??`/`||`/
 *  ternaries — see the identical note on `step-operating.tsx`). */
function projectNumberFieldsFromSettings(s: OrgSettings) {
  const {
    projectNumberFormat = "",
    projectNumberIncrementReset = DEFAULT_INCREMENT_RESET,
    projectNumberIncrementPadding = DEFAULT_INCREMENT_PADDING,
  } = s;
  return {
    projectNumberFormat,
    projectNumberReset: projectNumberIncrementReset,
    projectNumberPadding: projectNumberIncrementPadding,
  };
}

function invoiceNumberFieldsFromSettings(s: OrgSettings) {
  const {
    invoiceNumberFormat = "",
    invoiceNumberIncrementReset = DEFAULT_INVOICE_NUMBER_INCREMENT_RESET,
    invoiceNumberIncrementPadding = DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING,
  } = s;
  return {
    invoiceNumberFormat,
    invoiceNumberReset: invoiceNumberIncrementReset,
    invoiceNumberPadding: invoiceNumberIncrementPadding,
  };
}

function assetTagFieldsFromSettings(s: OrgSettings) {
  const { assetTagPrefix = "", assetTagDigits = 4 } = s;
  return { assetTagPrefix, assetTagDigits };
}

function documentTextFieldsFromSettings(d: OrgDocumentSettings) {
  const { footerText = "", termsAndConditions = "", paymentDetails = "" } = d;
  return { footerText, termsAndConditions, paymentDetails };
}

function documentTermsFieldsFromSettings(d: OrgDocumentSettings) {
  const { quoteValidityDays = DEFAULT_QUOTE_VALIDITY_DAYS, paymentTermsDays = DEFAULT_PAYMENT_TERMS_DAYS } = d;
  return { quoteValidityDays, paymentTermsDays };
}

/** Everything already stored for this org, as the form's flat fields. */
function fieldsFromOrg(org: OrgRecord): NumberingFields {
  const s = org.settings ?? {};
  const d = s.documents ?? {};
  return {
    ...projectNumberFieldsFromSettings(s),
    ...invoiceNumberFieldsFromSettings(s),
    ...assetTagFieldsFromSettings(s),
    ...documentTextFieldsFromSettings(d),
    ...documentTermsFieldsFromSettings(d),
  };
}

/** A field at its default value is omitted rather than written — same
 *  "unchanged from default means don't persist it" convention every other
 *  wizard step and its Settings-page equivalent already use. Each builder
 *  below covers one group of fields, split for the same complexity reason
 *  as the `*FieldsFromSettings` helpers above. */
function buildProjectNumberPatch(fields: NumberingFields) {
  return {
    projectNumberFormat: fields.projectNumberFormat.trim() || undefined,
    projectNumberIncrementReset: fields.projectNumberReset !== DEFAULT_INCREMENT_RESET ? fields.projectNumberReset : undefined,
    projectNumberIncrementPadding:
      fields.projectNumberPadding !== DEFAULT_INCREMENT_PADDING ? fields.projectNumberPadding : undefined,
  };
}

function buildInvoiceNumberPatch(fields: NumberingFields) {
  const format = fields.invoiceNumberFormat.trim();
  return {
    invoiceNumberFormat: format && format !== DEFAULT_INVOICE_NUMBER_FORMAT ? format : undefined,
    invoiceNumberIncrementReset:
      fields.invoiceNumberReset !== DEFAULT_INVOICE_NUMBER_INCREMENT_RESET ? fields.invoiceNumberReset : undefined,
    invoiceNumberIncrementPadding:
      fields.invoiceNumberPadding !== DEFAULT_INVOICE_NUMBER_INCREMENT_PADDING ? fields.invoiceNumberPadding : undefined,
  };
}

function buildAssetTagPatch(fields: NumberingFields) {
  return {
    assetTagPrefix: fields.assetTagPrefix.trim() || undefined,
    assetTagDigits: fields.assetTagDigits !== 4 ? fields.assetTagDigits : undefined,
  };
}

function documentsPatchFields(fields: NumberingFields): OrgDocumentSettings {
  return {
    footerText: fields.footerText.trim() || undefined,
    termsAndConditions: fields.termsAndConditions.trim() || undefined,
    paymentDetails: fields.paymentDetails.trim() || undefined,
    quoteValidityDays: fields.quoteValidityDays !== DEFAULT_QUOTE_VALIDITY_DAYS ? fields.quoteValidityDays : undefined,
    paymentTermsDays: fields.paymentTermsDays !== DEFAULT_PAYMENT_TERMS_DAYS ? fields.paymentTermsDays : undefined,
  };
}

function hasAnyDefined(obj: object): boolean {
  return Object.values(obj).some((v) => v !== undefined);
}

/** Starts from whatever `OrgDocumentSettings` is already stored so fields
 *  this screen doesn't expose (`footerSecondLine`,
 *  `showTermsAndConditionsOnInvoice` — both Settings-page-only) survive a
 *  wizard save untouched, rather than this screen's smaller field set
 *  silently replacing the whole sub-object and erasing them. Same fix,
 *  same rationale as `step-branding.tsx`'s `buildBranding` for
 *  `showOrgNameOnDocuments`. */
function buildDocumentsPatch(existingDocuments: OrgDocumentSettings | undefined, fields: NumberingFields): OrgDocumentSettings | undefined {
  const next = { ...existingDocuments, ...documentsPatchFields(fields) };
  return hasAnyDefined(next) ? next : undefined;
}

/** The `OrgSettings` patch to send, merged onto whatever's already stored
 *  (D5 — no draft state, an ordinary settings write against the live org). */
function buildSettingsPatch(existing: OrgSettings, fields: NumberingFields): OrgSettings {
  return {
    ...existing,
    ...buildProjectNumberPatch(fields),
    ...buildInvoiceNumberPatch(fields),
    ...buildAssetTagPatch(fields),
    documents: buildDocumentsPatch(existing.documents, fields),
  };
}

function applyProjectNumberChange(
  prev: NumberingFields,
  patch: { format?: string; reset?: IncrementReset; padding?: number },
): NumberingFields {
  return {
    ...prev,
    projectNumberFormat: patch.format ?? prev.projectNumberFormat,
    projectNumberReset: patch.reset ?? prev.projectNumberReset,
    projectNumberPadding: patch.padding ?? prev.projectNumberPadding,
  };
}

function applyInvoiceNumberChange(
  prev: NumberingFields,
  patch: { format?: string; reset?: IncrementReset; padding?: number },
): NumberingFields {
  return {
    ...prev,
    invoiceNumberFormat: patch.format ?? prev.invoiceNumberFormat,
    invoiceNumberReset: patch.reset ?? prev.invoiceNumberReset,
    invoiceNumberPadding: patch.padding ?? prev.invoiceNumberPadding,
  };
}

function numberFormatError(fields: NumberingFields): string | null {
  if (fields.projectNumberFormat.trim()) {
    const err = validateProjectNumberFormat(fields.projectNumberFormat);
    if (err) return err;
  }
  return validateProjectNumberFormat(fields.invoiceNumberFormat.trim() || DEFAULT_INVOICE_NUMBER_FORMAT);
}

/** `quoteValidityDays` is `z.coerce.number().int()` server-side
 *  (`orgDocumentSettingsSchema`) — reject a fractional value here too
 *  (typeable via the plain number input, which has no `step` attribute)
 *  rather than letting Save look enabled and then fail with a confusing
 *  server throw. */
function daysOutOfRange(fields: NumberingFields): boolean {
  const { quoteValidityDays: v, paymentTermsDays: p } = fields;
  const validityBad =
    !Number.isInteger(v) || v < QUOTE_VALIDITY_BOUNDS.min || v > QUOTE_VALIDITY_BOUNDS.max;
  const paymentBad =
    !Number.isInteger(p) || p < PAYMENT_TERMS_BOUNDS.min || p > PAYMENT_TERMS_BOUNDS.max;
  return validityBad || paymentBad;
}

function saveErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Performs the actual write + cache refresh, split out of `handleSave`
 *  purely to keep that function's own cyclomatic complexity under the
 *  R-3.6/complexity-ratchet ceiling (see the identical note on
 *  `step-operating.tsx`'s `saveOperatingDetails`). */
async function saveNumbering(orgId: string, org: OrgRecord | undefined, fields: NumberingFields): Promise<void> {
  // Re-fetches fresh rather than trusting the `org` prop: this screen
  // chains directly after step 3 (C3), whose own save triggers only a
  // fire-and-forget `refreshOrganization` (the shared-resource hook's
  // `refresh` returns void by design), so the `useOrganization` cache this
  // component reads for display can still be the pre-step-3-write snapshot
  // when the operator saves quickly. Same fix, same rationale as C3's
  // `saveBranding` (step-branding.tsx) — closes the identical race for this
  // step's own merge.
  const fresh = (await getOrganization()) as OrgRecord;
  await updateOrganization({
    name: fresh.name ?? org?.name ?? "",
    settings: buildSettingsPatch(fresh.settings ?? {}, fields),
  });
  refreshOrganization(orgId);
}

type LocationWrites = ReturnType<typeof useLocationWrites>;

/** The one genuinely load-bearing default in this screen (per the issue):
 *  a serialized asset needs a location to live in, so an org that reaches
 *  the tour with zero locations gets one made for it. */
async function createDefaultLocation(locWrites: LocationWrites): Promise<void> {
  await locWrites.create({ name: "Main warehouse", isDefault: true });
}

/** On an explicit save, a typed name always creates that location (an
 *  intentional action); an org with no location at all still gets the
 *  "Main warehouse" fallback even if the field was left blank, exactly as
 *  "Skip for now" would have given it. An org that already has at least
 *  one location gets nothing extra when the field is left blank — no
 *  duplicate default.
 *
 *  Known gap: `hasExistingLocations` is a plain read of `useLocations`, not
 *  atomic with `locWrites.create()` — `convex/locationsWrites.ts` has no
 *  "only one default location" invariant of its own (`unsetOtherDefaults`
 *  only un-defaults the PREVIOUS row after an insert, it doesn't prevent a
 *  second one). Two tabs racing this exact step for the same brand-new org
 *  within the same round trip could both create a "Main warehouse". Judged
 *  acceptable: the failure mode is a harmless, obviously-named duplicate
 *  location (rename/delete in Settings), not data loss or a security
 *  issue, and the window requires simultaneous multi-tab use of a screen
 *  that exists for seconds per org. A real fix needs a Convex-side
 *  invariant, out of scope for a client-only wizard screen. */
async function ensureLocationOnSave(
  locWrites: LocationWrites,
  locationName: string,
  hasExistingLocations: boolean,
): Promise<void> {
  const trimmed = locationName.trim();
  if (trimmed) {
    await locWrites.create({ name: trimmed, isDefault: !hasExistingLocations });
    return;
  }
  if (!hasExistingLocations) await createDefaultLocation(locWrites);
}

async function ensureLocationOnSkip(locWrites: LocationWrites, hasExistingLocations: boolean): Promise<void> {
  if (!hasExistingLocations) await createDefaultLocation(locWrites);
}

/** Derives the two location-list booleans the component needs — split out
 *  purely to keep `StepNumbering`'s own cyclomatic complexity under the
 *  R-3.6/complexity-ratchet ceiling (optional chaining/`??` count as
 *  decision points in this repo's eslint config). */
function locationsState(locations: unknown[] | undefined): { hasExisting: boolean; loading: boolean } {
  return { hasExisting: (locations?.length ?? 0) > 0, loading: locations === undefined };
}

/** Whether Save/Skip are disabled — split out for the same complexity
 *  reason as `locationsState`. */
function computeDisabled(opts: {
  saving: boolean;
  skipping: boolean;
  locationsLoading: boolean;
  formatError: string | null;
  rangeError: boolean;
}): { saveDisabled: boolean; skipDisabled: boolean } {
  const busy = opts.saving || opts.skipping || opts.locationsLoading;
  return { saveDisabled: busy || !!opts.formatError || opts.rangeError, skipDisabled: busy };
}

/**
 * `/setup` step 4 — C4 (#1102), "how you work". The boring, load-bearing
 * screen, and the most likely skip — every field here has a working
 * default, so skipping is always safe (D3).
 *
 * Project/invoice numbering, the asset tag scheme, and document terms
 * (quote validity, payment terms, footer, T&Cs, payment details) are an
 * ordinary `OrgSettings` write through `updateOrganization` — the SAME
 * server action Settings uses (D5) — merged onto whatever's already
 * stored. The numbering fields reuse Settings' own
 * `ProjectNumberingSettings`/`InvoiceNumberingSettings` components
 * directly (including `ProjectNumberingSettings`' live next-number
 * preview via `peekNextProjectNumber`) rather than re-implementing them.
 *
 * The first location is DIFFERENT: it isn't an `OrgSettings` field, it's a
 * separate Convex `locations` row, written via `useLocationWrites` — so
 * this step's save path does two writes, not one. And unlike every prior
 * step, "Skip for now" here is NOT a no-op: a serialized asset needs
 * somewhere to live, so skipping with zero locations already on the org
 * still creates a "Main warehouse" default (marked `isDefault: true`) —
 * exactly what the screen tells the operator will happen. That write is
 * best-effort (logged, never blocks `onDone`), the same posture C1's
 * post-creation seed/mirror step takes: a location can always be renamed
 * or added to later, so a transient failure here must never strand the
 * wizard.
 *
 * Both writes ultimately target the SESSION's active org, not literally the
 * `orgId` prop (`updateOrganization`/`useLocationWrites` both derive it from
 * `getOrgContext()`/`useActiveOrganization()`) — same pre-existing pattern
 * every earlier step already relies on, since `organization.setActive()` in
 * step 1 keeps the two in lockstep for the lifetime of this wizard.
 */
export function StepNumbering({
  orgId,
  onDone,
  onStepOutcome,
}: {
  orgId: string;
  onDone: () => void;
  /** D4 (#1108) — purely additive analytics tally; doesn't affect `onDone`. */
  onStepOutcome: (outcome: "completed" | "skipped") => void;
}) {
  const { data: org, isLoading } = useOrganization(orgId) as {
    data: OrgRecord | undefined;
    isLoading: boolean;
  };
  const locations = useLocations(orgId);
  const locWrites = useLocationWrites();

  useEffect(() => {
    capture(AnalyticsEvent.SetupStepViewed, { step: "numbering" satisfies SetupStepId });
  }, []);

  const [fields, setFields] = useState<NumberingFields>(EMPTY_FIELDS);
  const [locationName, setLocationName] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // One-shot hydration, same rationale as every prior step: this screen
  // owns the form state from here — a later background refetch of `org`
  // must never silently overwrite what the operator is typing.
  useEffect(() => {
    if (hydrated || !org) return;
    setFields(fieldsFromOrg(org)); // eslint-disable-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, [org, hydrated]);

  const { hasExisting: hasExistingLocations, loading: locationsLoading } = locationsState(locations);
  const formatError = numberFormatError(fields);
  const rangeError = daysOutOfRange(fields);
  const { saveDisabled, skipDisabled } = computeDisabled({ saving, skipping, locationsLoading, formatError, rangeError });

  async function handleSave() {
    setSaving(true);
    try {
      await saveNumbering(orgId, org, fields);
      await ensureLocationOnSave(locWrites, locationName, hasExistingLocations);
      toast.success("Saved.");
      capture(AnalyticsEvent.SetupStepCompleted, { step: "numbering" satisfies SetupStepId });
      onStepOutcome("completed");
      onDone();
    } catch (e) {
      toast.error(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      await ensureLocationOnSkip(locWrites, hasExistingLocations);
    } catch (e) {
      logger.error("setup: step 4 default-location creation failed (best-effort)", { orgId, error: e });
    } finally {
      setSkipping(false);
    }
    capture(AnalyticsEvent.SetupStepSkipped, { step: "numbering" satisfies SetupStepId });
    onStepOutcome("skipped");
    onDone();
  }

  return (
    <AuthShell accent="setup" annotation="every field already has a default.">
      <WizardRail step={4} total={TOTAL_STEPS} />
      <p className="t-annotation text-[13px] text-red">Step 4 of {TOTAL_STEPS} · How you work</p>
      <h1 className="t-title mt-1 text-ink">Numbering, terms, and where gear lives.</h1>
      <p className="mt-1 text-sm text-muted">
        The most skippable screen in the wizard — every field below already has a working default.
      </p>

      {isLoading && !hydrated ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <ProjectNumberingSettings
            format={fields.projectNumberFormat}
            reset={fields.projectNumberReset}
            padding={fields.projectNumberPadding}
            onChange={(patch) => setFields((prev) => applyProjectNumberChange(prev, patch))}
          />

          <InvoiceNumberingSettings
            format={fields.invoiceNumberFormat}
            reset={fields.invoiceNumberReset}
            padding={fields.invoiceNumberPadding}
            onChange={(patch) => setFields((prev) => applyInvoiceNumberChange(prev, patch))}
          />

          <AssetTagField
            prefix={fields.assetTagPrefix}
            digits={fields.assetTagDigits}
            onPrefixChange={(v) => setFields((prev) => ({ ...prev, assetTagPrefix: v }))}
            onDigitsChange={(v) => setFields((prev) => ({ ...prev, assetTagDigits: v }))}
          />

          <DocumentTermsSection
            footerText={fields.footerText}
            onFooterTextChange={(v) => setFields((prev) => ({ ...prev, footerText: v }))}
            termsAndConditions={fields.termsAndConditions}
            onTermsChange={(v) => setFields((prev) => ({ ...prev, termsAndConditions: v }))}
            paymentDetails={fields.paymentDetails}
            onPaymentDetailsChange={(v) => setFields((prev) => ({ ...prev, paymentDetails: v }))}
            quoteValidityDays={fields.quoteValidityDays}
            onQuoteValidityChange={(v) => setFields((prev) => ({ ...prev, quoteValidityDays: v }))}
            paymentTermsDays={fields.paymentTermsDays}
            onPaymentTermsChange={(v) => setFields((prev) => ({ ...prev, paymentTermsDays: v }))}
          />

          <LocationField name={locationName} onChange={setLocationName} hasExistingLocations={hasExistingLocations} />

          <FormatErrorNotice message={formatError} />

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleSkip}
              disabled={skipDisabled}
              className="text-sm text-muted hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
            <Button onClick={handleSave} disabled={saveDisabled}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save and continue
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

/** Renders the project/invoice number format error, if any — split out
 *  purely to keep `StepNumbering`'s own complexity down. */
function FormatErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-red">{message}</p>;
}

/** The asset tag prefix/digits fields — split out purely to keep the main
 *  component's own complexity down. The preview is computed client-side
 *  (not via `peekNextAssetTags`, which reads only the SAVED config): a
 *  fresh org's counter is always 0 pre-save, so `{prefix}{1 padded}` is
 *  exactly what the server would compute anyway. */
function AssetTagField({
  prefix,
  digits,
  onPrefixChange,
  onDigitsChange,
}: {
  prefix: string;
  digits: number;
  onPrefixChange: (v: string) => void;
  onDigitsChange: (v: number) => void;
}) {
  const effectivePrefix = prefix || "ASSET";
  const effectiveDigits = digits || 4;
  const preview = `${effectivePrefix}${String(1).padStart(effectiveDigits, "0")}`;
  return (
    <div className="space-y-3 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
      <div>
        <h4 className="t-body font-medium text-ink">Asset tag scheme</h4>
        <p className="text-xs text-fg-3">Needed before your first serialized asset — every asset gets one automatically.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="assetTagPrefix">Prefix</Label>
          <Input
            id="assetTagPrefix"
            value={prefix}
            onChange={(e) => onPrefixChange(e.target.value)}
            placeholder="ASSET"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="assetTagDigits">Digits</Label>
          <Input
            id="assetTagDigits"
            type="number"
            min={1}
            max={10}
            value={digits}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onDigitsChange(Math.max(1, Math.min(10, n)));
            }}
          />
        </div>
      </div>
      <p className="text-xs text-fg-3">
        Next tag: <span className="font-mono font-medium text-ink">{preview}</span>
      </p>
    </div>
  );
}

interface DocumentTermsSectionProps {
  footerText: string;
  onFooterTextChange: (v: string) => void;
  termsAndConditions: string;
  onTermsChange: (v: string) => void;
  paymentDetails: string;
  onPaymentDetailsChange: (v: string) => void;
  quoteValidityDays: number;
  onQuoteValidityChange: (v: number) => void;
  paymentTermsDays: number;
  onPaymentTermsChange: (v: number) => void;
}

/** Footer/T&Cs/payment-details text plus the two day-count defaults — split
 *  out purely to keep the main component's own complexity down. */
function DocumentTermsSection({
  footerText,
  onFooterTextChange,
  termsAndConditions,
  onTermsChange,
  paymentDetails,
  onPaymentDetailsChange,
  quoteValidityDays,
  onQuoteValidityChange,
  paymentTermsDays,
  onPaymentTermsChange,
}: DocumentTermsSectionProps) {
  return (
    <div className="space-y-4 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
      <h4 className="t-body font-medium text-ink">Document terms</h4>

      <div className="space-y-1">
        <Label htmlFor="footerText">Footer text</Label>
        <Input
          id="footerText"
          value={footerText}
          onChange={(e) => onFooterTextChange(e.target.value)}
          placeholder="Your Org | you@example.com | 0400 000 000"
          maxLength={200}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="termsAndConditions">Terms &amp; conditions</Label>
        <Textarea
          id="termsAndConditions"
          value={termsAndConditions}
          onChange={(e) => onTermsChange(e.target.value)}
          placeholder="Shown on every quote. Leave blank to add later."
          maxLength={4000}
          rows={3}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="paymentDetails">Payment details</Label>
        <Textarea
          id="paymentDetails"
          value={paymentDetails}
          onChange={(e) => onPaymentDetailsChange(e.target.value)}
          placeholder={"Bank: Example Bank\nAccount: 000 000 000"}
          maxLength={2000}
          rows={3}
        />
        <p className="text-xs text-fg-3">Shown on invoices, next to the total.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="quoteValidityDays">Quote validity (days)</Label>
          <Input
            id="quoteValidityDays"
            type="number"
            step={1}
            min={QUOTE_VALIDITY_BOUNDS.min}
            max={QUOTE_VALIDITY_BOUNDS.max}
            value={quoteValidityDays}
            onChange={(e) => onQuoteValidityChange(e.target.valueAsNumber)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="paymentTermsDays">Payment terms (days)</Label>
          <Input
            id="paymentTermsDays"
            type="number"
            step={1}
            min={PAYMENT_TERMS_BOUNDS.min}
            max={PAYMENT_TERMS_BOUNDS.max}
            value={paymentTermsDays}
            onChange={(e) => onPaymentTermsChange(e.target.valueAsNumber)}
          />
        </div>
      </div>
    </div>
  );
}

/** The first-location field — split out purely to keep the main
 *  component's own complexity down. The copy changes depending on whether
 *  the org already has a location, per the "auto-fill that hides itself
 *  reads as a bug" rule: say plainly what happens either way. */
function LocationField({
  name,
  onChange,
  hasExistingLocations,
}: {
  name: string;
  onChange: (v: string) => void;
  hasExistingLocations: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="op-location">First location</Label>
      <Input
        id="op-location"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Main warehouse"
      />
      <p className="text-xs text-fg-3">
        {hasExistingLocations
          ? "You already have a location set up — leave this blank to skip adding another."
          : "A serialized asset needs somewhere to live. Skip this and we'll make you a \"Main warehouse\" so your first asset has somewhere to go."}
      </p>
    </div>
  );
}
