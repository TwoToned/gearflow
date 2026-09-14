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
import { getCountry, listEnabledCountries } from "@/lib/countries";
import { orgOperatingDetailsSchema } from "@/lib/validations/org-settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { cn } from "@/lib/utils";
import { TOTAL_STEPS } from "./wizard-steps";

interface OrgRecord {
  name?: string;
  settings?: OrgSettings;
  defaultTaxRate?: number | null;
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
export function StepOperating({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { data: org, isLoading } = useOrganization(orgId) as {
    data: OrgRecord | undefined;
    isLoading: boolean;
  };

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
    const settings = org.settings ?? {};
    setCountry(settings.country ?? ""); // eslint-disable-line react-hooks/set-state-in-effect
    setCurrency(settings.currency ?? "");
    setTimezone(settings.timezone ?? "");
    setTaxLabel(settings.taxLabel ?? "");
    setTaxRate(org.defaultTaxRate != null ? String(org.defaultTaxRate) : "");
    setBusinessNumber(settings.abn ?? "");
    setPhone(settings.phone ?? "");
    setEmail(settings.email ?? "");
    setAddress(settings.address ?? "");
    setCountryLocked(!!settings.country);
    setHydrated(true);
  }, [org, hydrated]);

  const countryDef = getCountry(country);
  const businessNumberLabel = countryDef?.businessNumberLabel ?? "Business number";

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
    const parsed = orgOperatingDetailsSchema.safeParse({
      country,
      currency: currency || undefined,
      timezone: timezone || undefined,
      taxLabel: taxLabel || undefined,
      taxRate: taxRate === "" ? undefined : taxRate,
      businessNumber: businessNumber || undefined,
      phone: phone || undefined,
      email,
      address: address || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the form and try again");
      return;
    }
    setSaving(true);
    try {
      const result = (await updateOrganization({
        name: org?.name ?? "",
        settings: {
          ...(org?.settings ?? {}),
          country: parsed.data.country,
          currency: parsed.data.currency,
          timezone: parsed.data.timezone,
          taxLabel: parsed.data.taxLabel,
          abn: parsed.data.businessNumber,
          phone: parsed.data.phone,
          email: parsed.data.email || undefined,
          address: parsed.data.address,
        },
        defaultTaxRate: parsed.data.taxRate ?? null,
      })) as { settings?: OrgSettings };
      refreshOrganization(orgId);
      // The server silently forces `country` back to whatever was already
      // persisted (`withImmutableCountry`, src/server/settings.ts) rather
      // than rejecting a changed value — normally unreachable here since the
      // picker is disabled once `countryLocked`, but a stale/duplicate
      // session (double tab, browser back/forward) could still submit a
      // different one. Check the actual persisted value rather than assume
      // the submit succeeded as written.
      if (result.settings?.country && result.settings.country !== parsed.data.country) {
        setCountry(result.settings.country);
        setCountryLocked(true);
        toast.error(
          `Country is already set to ${getCountry(result.settings.country)?.name ?? result.settings.country} and can't be changed.`,
        );
        return;
      }
      toast.success("Saved.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
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
          <div className="space-y-2">
            <Label htmlFor="op-country">Country</Label>
            <Select value={country} onValueChange={handleCountryChange} disabled={countryLocked}>
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
              {countryLocked && "Already set. "}
              Permanent. It sets your currency, tax, paper size and date format, so it can&apos;t
              be changed once you&apos;re running. Everything else on this page can.
            </p>
          </div>

          {countryDef && (
            <div className="rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
                {countryDef.name} sets these — change any of them.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FilledField id="op-currency" label="Currency" value={currency} onChange={setCurrency} />
                <FilledField id="op-timezone" label="Time zone" value={timezone} onChange={setTimezone} />
                <FilledField id="op-tax-label" label="Tax label" value={taxLabel} onChange={setTaxLabel} />
                <FilledField
                  id="op-tax-rate"
                  label="Tax rate (%)"
                  value={taxRate}
                  onChange={setTaxRate}
                  type="number"
                  placeholder={countryDef.defaultTaxRate == null ? "No default — set your own" : undefined}
                />
              </div>
              <div className="mt-3 space-y-2">
                <Label htmlFor="op-business-number">{businessNumberLabel}</Label>
                <Input
                  id="op-business-number"
                  value={businessNumber}
                  onChange={(e) => setBusinessNumber(e.target.value)}
                />
                <p className="text-xs text-fg-3">
                  Your business number. Prints on every tax invoice.
                </p>
              </div>
            </div>
          )}

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
            <button type="button" onClick={onDone} className="text-sm text-muted hover:text-ink">
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
