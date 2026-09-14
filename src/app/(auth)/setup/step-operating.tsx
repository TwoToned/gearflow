"use client";
// use-client: interactive — form state, Convex-backed hook reads (R-8.1.1)

import { useEffect, useState } from "react";
import { Loader2, Lock, Check } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "../auth-playful";
import { WizardRail } from "@/components/ui/wizard-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressInput } from "@/components/ui/address-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";
import { updateOrganization } from "@/server/settings";
import { getCountry, listEnabledCountries, type CountryDefinition } from "@/lib/countries";
import { orgOperatingDetailsSchema } from "@/lib/validations/org-settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { cn } from "@/lib/utils";
import { TOTAL_STEPS } from "./wizard-steps";
import { capture, AnalyticsEvent, type SetupStepId } from "@/lib/analytics";

interface OrgRecord {
  name?: string;
  settings?: OrgSettings;
  defaultTaxRate?: number | null;
}

interface OperatingFields {
  country: string;
  currency: string;
  timezone: string;
  taxLabel: string;
  taxRate: string;
  businessNumber: string;
  phone: string;
  email: string;
  address: string;
}

/** The complexity ratchet (R-3.6) counts each destructuring default as a
 *  decision point, so reading all 8 optional settings fields in one
 *  function trips it — split across two small functions instead of one big
 *  one, each safely under the ceiling. */
function coreFieldsFromSettings(settings: OrgSettings) {
  const { country = "", currency = "", timezone = "", taxLabel = "" } = settings;
  return { country, currency, timezone, taxLabel };
}

function contactFieldsFromSettings(settings: OrgSettings) {
  const { abn: businessNumber = "", phone = "", email = "", address = "" } = settings;
  return { businessNumber, phone, email, address };
}

/** Everything already stored for this org, as the form's flat string fields. */
function fieldsFromOrg(org: OrgRecord): OperatingFields {
  const settings = org.settings ?? {};
  return {
    ...coreFieldsFromSettings(settings),
    ...contactFieldsFromSettings(settings),
    taxRate: org.defaultTaxRate != null ? String(org.defaultTaxRate) : "",
  };
}

/** The `orgOperatingDetailsSchema` input shape from the form's raw string
 *  state — split out of `handleSave` purely to keep that function's own
 *  cyclomatic complexity under the R-3.6/complexity-ratchet ceiling. */
function toSchemaInput(fields: OperatingFields) {
  return {
    country: fields.country,
    currency: fields.currency || undefined,
    timezone: fields.timezone || undefined,
    taxLabel: fields.taxLabel || undefined,
    taxRate: fields.taxRate === "" ? undefined : fields.taxRate,
    businessNumber: fields.businessNumber || undefined,
    phone: fields.phone || undefined,
    email: fields.email,
    address: fields.address || undefined,
  };
}

/** The `OrgSettings` patch to send, merged onto whatever's already stored
 *  (D5 — no draft state, an ordinary settings write). */
function buildSettingsPatch(
  existing: OrgSettings,
  data: ReturnType<typeof orgOperatingDetailsSchema.parse>,
): OrgSettings {
  return {
    ...existing,
    country: data.country,
    currency: data.currency,
    timezone: data.timezone,
    taxLabel: data.taxLabel,
    abn: data.businessNumber,
    phone: data.phone,
    email: data.email || undefined,
    address: data.address,
  };
}

/** `withImmutableCountry` (src/server/settings.ts) silently forces `country`
 *  back to whatever was already persisted rather than rejecting a changed
 *  value — normally unreachable here since the picker disables once
 *  `countryLocked`, but a stale/duplicate session (double tab, browser
 *  back/forward) could still submit a different one. Returns the persisted
 *  country when it disagrees with what was submitted, so the caller can
 *  correct the UI instead of reporting a false success; null otherwise. */
function countryMismatch(persisted: string | undefined, submitted: string): string | null {
  return persisted && persisted !== submitted ? persisted : null;
}

function countryLockedMessage(code: string): string {
  return `Country is already set to ${getCountry(code)?.name ?? code} and can't be changed.`;
}

function schemaErrorMessage(parsed: { error: { issues: { message: string }[] } }): string {
  return parsed.error.issues[0]?.message ?? "Check the form and try again";
}

function saveErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Performs the actual write + cache refresh, split out of `handleSave`
 *  purely to keep that function's own cyclomatic complexity under the
 *  R-3.6/complexity-ratchet ceiling (this eslint config counts optional
 *  chaining as a decision point too, same as `??`/`||`/ternaries). */
async function saveOperatingDetails(
  orgId: string,
  org: OrgRecord | undefined,
  data: ReturnType<typeof orgOperatingDetailsSchema.parse>,
): Promise<{ mismatchCountry: string | null }> {
  const existingSettings = org?.settings ?? {};
  const result = (await updateOrganization({
    name: org?.name ?? "",
    settings: buildSettingsPatch(existingSettings, data),
    defaultTaxRate: data.taxRate ?? null,
  })) as { settings?: OrgSettings };
  refreshOrganization(orgId);
  return { mismatchCountry: countryMismatch(result.settings?.country, data.country) };
}

/**
 * `/setup` step 2 — C2 (#1099), "where you operate". Country is the
 * highest-leverage field in the wizard: picking one fills currency,
 * timezone, tax label and tax rate (all shown filled-but-editable, per the
 * design rule that hidden auto-fill reads as a bug), plus what the
 * business-number field is even CALLED (ABN/NZBN/VAT number/EIN — the
 * label, never the storage, per `OrgSettings.abn`'s own generic doc
 * comment).
 *
 * Country itself is permanent once saved (M6) — enforced server-side by
 * `withImmutableCountry` in `src/server/settings.ts`, which this screen
 * relies on rather than re-implementing: a resubmit with a different country
 * (e.g. a stale tab) is silently ignored by the server, not rejected.
 *
 * Writes through `updateOrganization` — the SAME server action the general
 * Settings page uses (D5, no parallel wizard-only write path) — merged onto
 * whatever's already in the blob (notably `currency`, seeded by C1's
 * `seedOrgDefaults`) so this save can never wipe out an unrelated field.
 */
export function StepOperating({
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

  useEffect(() => {
    capture(AnalyticsEvent.SetupStepViewed, { step: "operating" satisfies SetupStepId });
  }, []);

  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Set once at hydration, from whatever country (if any) was already
  // persisted when this screen loaded. M6 says country is permanent — this
  // is what actually enforces that in the UI (the hint text alone is only
  // advisory): once true, the picker is disabled, so the "already set,
  // can't change it" case can't even be attempted, rather than being
  // attempted and silently discarded server-side (#1099 review finding).
  const [countryLocked, setCountryLocked] = useState(false);

  // Pre-populate once from whatever's already stored (C1's seedOrgDefaults
  // wrote `currency`; everything else starts blank on a brand-new org).
  // Deliberately one-shot (`hydrated` guard): this screen owns the form
  // state from here — a later background refetch of `org` (e.g. from
  // another tab) must never silently overwrite what the operator is typing.
  useEffect(() => {
    if (hydrated || !org) return;
    const fields = fieldsFromOrg(org);
    setCountry(fields.country); // eslint-disable-line react-hooks/set-state-in-effect
    setCurrency(fields.currency);
    setTimezone(fields.timezone);
    setTaxLabel(fields.taxLabel);
    setTaxRate(fields.taxRate);
    setBusinessNumber(fields.businessNumber);
    setPhone(fields.phone);
    setEmail(fields.email);
    setAddress(fields.address);
    setCountryLocked(!!fields.country);
    setHydrated(true);
  }, [org, hydrated]);

  const countryDef = getCountry(country);

  function handleCountryChange(code: string) {
    setCountry(code);
    const def = getCountry(code);
    if (!def) return;
    setCurrency(def.currency);
    setTimezone(def.timezone);
    setTaxLabel(def.taxLabel);
    setTaxRate(def.defaultTaxRate != null ? String(def.defaultTaxRate) : "");
  }

  async function handleSave() {
    const parsed = orgOperatingDetailsSchema.safeParse(
      toSchemaInput({ country, currency, timezone, taxLabel, taxRate, businessNumber, phone, email, address }),
    );
    if (!parsed.success) {
      toast.error(schemaErrorMessage(parsed));
      return;
    }
    setSaving(true);
    try {
      const { mismatchCountry } = await saveOperatingDetails(orgId, org, parsed.data);
      if (mismatchCountry) {
        setCountry(mismatchCountry);
        setCountryLocked(true);
        toast.error(countryLockedMessage(mismatchCountry));
        return;
      }
      toast.success("Saved.");
      capture(AnalyticsEvent.SetupStepCompleted, { step: "operating" satisfies SetupStepId });
      onStepOutcome("completed");
      onDone();
    } catch (e) {
      toast.error(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthShell accent="setup" annotation="one field fills five.">
      <WizardRail step={2} total={TOTAL_STEPS} />
      <p className="t-annotation text-[13px] text-red">Step 2 of {TOTAL_STEPS} · Where you operate</p>
      <h1 className="t-title mt-1 text-ink">A few details for your paperwork.</h1>

      {isLoading && !hydrated ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <CountrySelectField
            country={country}
            countryDef={countryDef}
            locked={countryLocked}
            onChange={handleCountryChange}
          />

          <CountryAutofillSection
            countryDef={countryDef}
            currency={currency}
            onCurrencyChange={setCurrency}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            taxLabel={taxLabel}
            onTaxLabelChange={setTaxLabel}
            taxRate={taxRate}
            onTaxRateChange={setTaxRate}
            businessNumber={businessNumber}
            onBusinessNumberChange={setBusinessNumber}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="op-phone">Phone</Label>
              <Input id="op-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-email">Email on documents</Label>
              <Input
                id="op-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="op-address">Business address</Label>
            <AddressInput
              id="op-address"
              value={address}
              onChange={setAddress}
              countryCode={country || undefined}
              placeholder="Start typing and pick from the suggestions."
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                capture(AnalyticsEvent.SetupStepSkipped, { step: "operating" satisfies SetupStepId });
                onStepOutcome("skipped");
                onDone();
              }}
              className="text-sm text-muted hover:text-ink"
            >
              Skip for now
            </button>
            <Button onClick={handleSave} disabled={saving || !country}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save and continue
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

/** The country picker + its M6 "permanent" hint — split out of the main
 *  component purely to keep `StepOperating`'s own complexity down. */
function CountrySelectField({
  country,
  countryDef,
  locked,
  onChange,
}: {
  country: string;
  countryDef: CountryDefinition | undefined;
  locked: boolean;
  onChange: (code: string) => void;
}) {
  const lockedPrefix = locked ? "Already set. " : "";
  return (
    <div className="space-y-2">
      <Label htmlFor="op-country">Country</Label>
      <Select value={country} onValueChange={onChange} disabled={locked}>
        <SelectTrigger id="op-country">
          <SelectValue>{countryDef?.name ?? "Select a country"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {listEnabledCountries().map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="flex items-start gap-1.5 text-xs text-fg-3">
        <Lock className="mt-0.5 h-3 w-3 flex-none" aria-hidden />
        {lockedPrefix}Permanent. It sets your currency, tax, paper size and date format, so it
        can&apos;t be changed once you&apos;re running. Everything else on this page can.
      </p>
    </div>
  );
}

/** The four auto-filled fields + the business-number field whose LABEL (not
 *  value) tracks the country — split out of the main component purely to
 *  keep `StepOperating`'s own complexity down. Renders nothing until a
 *  country is picked. */
function CountryAutofillSection({
  countryDef,
  currency,
  onCurrencyChange,
  timezone,
  onTimezoneChange,
  taxLabel,
  onTaxLabelChange,
  taxRate,
  onTaxRateChange,
  businessNumber,
  onBusinessNumberChange,
}: {
  countryDef: CountryDefinition | undefined;
  currency: string;
  onCurrencyChange: (v: string) => void;
  timezone: string;
  onTimezoneChange: (v: string) => void;
  taxLabel: string;
  onTaxLabelChange: (v: string) => void;
  taxRate: string;
  onTaxRateChange: (v: string) => void;
  businessNumber: string;
  onBusinessNumberChange: (v: string) => void;
}) {
  if (!countryDef) return null;
  const taxRatePlaceholder = countryDef.defaultTaxRate == null ? "No default — set your own" : undefined;
  return (
    <div className="rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
      <p className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
        {countryDef.name} sets these — change any of them.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FilledField id="op-currency" label="Currency" value={currency} onChange={onCurrencyChange} />
        <FilledField id="op-timezone" label="Time zone" value={timezone} onChange={onTimezoneChange} />
        <FilledField id="op-tax-label" label="Tax label" value={taxLabel} onChange={onTaxLabelChange} />
        <FilledField
          id="op-tax-rate"
          label="Tax rate (%)"
          value={taxRate}
          onChange={onTaxRateChange}
          type="number"
          placeholder={taxRatePlaceholder}
        />
      </div>
      <div className="mt-3 space-y-2">
        <Label htmlFor="op-business-number">{countryDef.businessNumberLabel}</Label>
        <Input
          id="op-business-number"
          value={businessNumber}
          onChange={(e) => onBusinessNumberChange(e.target.value)}
        />
        <p className="text-xs text-fg-3">Your business number. Prints on every tax invoice.</p>
      </div>
    </div>
  );
}

/** One of the four country-derived fields — visually "filled" (dimmed
 *  background) to signal it came from the country pick, but a completely
 *  ordinary editable input underneath: "auto-fill that hides itself reads
 *  as a bug" (#1099). */
function FilledField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-9 text-sm", value && "border-line-2 bg-card/60 text-ink-2")}
      />
    </div>
  );
}
