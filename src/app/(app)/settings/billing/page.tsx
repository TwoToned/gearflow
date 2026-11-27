"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn } from "@/components/ui/motion";
import { InvoiceNumberingSettings } from "@/components/settings/invoice-numbering-settings";
import { SettingsSection, SettingsSections, SettingsSaveBar } from "@/components/settings/settings-section";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";

/**
 * Billing (UX Phase 17, D60): the money settings in one place — currency, tax,
 * and how invoices are numbered. The default tax rate and invoice numbering
 * used to sit on General under "Job defaults". The default rate is the org's
 * `defaultTaxRate` (the one new jobs inherit, FEATUREDOCS/75); the old
 * "Tax rate" box here wrote `settings.taxRate`, which nothing reads, so it is
 * gone rather than moved.
 */
export default function BillingSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});
  const [defaultTaxRate, setDefaultTaxRate] = useState<string>("");
  const [baseline, setBaseline] = useState<string>("");

  const snapshot = useMemo(() => JSON.stringify({ name, settings, defaultTaxRate }), [name, settings, defaultTaxRate]);
  const isDirty = baseline !== "" && snapshot !== baseline;

  const load = (o: Record<string, unknown>) => {
    const nextName = (o.name as string) || "";
    const nextSettings = (o.settings as OrgSettings) || {};
    const rate = o.defaultTaxRate;
    const nextRate = rate != null ? String(rate) : "";
    setName(nextName);
    setSettings(nextSettings);
    setDefaultTaxRate(nextRate);
    setBaseline(JSON.stringify({ name: nextName, settings: nextSettings, defaultTaxRate: nextRate }));
  };

  useEffect(() => {
    if (org) load(org as Record<string, unknown>); // eslint-disable-line react-hooks/set-state-in-effect
  }, [org]);

  const updateMutation = useServerMutation({
    mutationFn: () =>
      updateOrganization({
        name,
        settings,
        defaultTaxRate: defaultTaxRate ? parseFloat(defaultTaxRate) : null,
      }),
    onSuccess: () => {
      refreshOrganization(orgId);
      setBaseline(snapshot);
      toast.success("Billing settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSetting = (key: keyof OrgSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn className="space-y-6 pb-24">
      <SettingsSections>
        <SettingsSection title="Currency and tax" description="Used on every quote and invoice.">
          <div className="space-y-2 sm:max-w-[240px]">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value={settings.currency || "AUD"}
              onChange={(e) => updateSetting("currency", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2 sm:max-w-[240px]">
            <Label htmlFor="defaultTaxRate">Default tax rate (%)</Label>
            <Input
              id="defaultTaxRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={defaultTaxRate}
              onChange={(e) => setDefaultTaxRate(e.target.value)}
              placeholder="e.g. 10"
              disabled={!canEdit}
            />
            <p className="t-micro text-muted">
              Applied to new jobs unless overridden. Used for GST/VAT calculation.
            </p>
          </div>
          <div className="space-y-2 sm:max-w-[240px]">
            <Label htmlFor="taxLabel">Tax label</Label>
            <Input
              id="taxLabel"
              value={settings.taxLabel || "GST"}
              onChange={(e) => updateSetting("taxLabel", e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Invoice numbering"
          description="How invoices are numbered when they are issued. Quotes and jobs have their own numbers."
        >
          <InvoiceNumberingSettings
            format={settings.invoiceNumberFormat ?? ""}
            reset={settings.invoiceNumberIncrementReset ?? "YEARLY"}
            padding={settings.invoiceNumberIncrementPadding ?? 4}
            disabled={!canEdit}
            onChange={(patch) =>
              setSettings((prev) => ({
                ...prev,
                ...(patch.format !== undefined ? { invoiceNumberFormat: patch.format } : {}),
                ...(patch.reset !== undefined ? { invoiceNumberIncrementReset: patch.reset } : {}),
                ...(patch.padding !== undefined ? { invoiceNumberIncrementPadding: patch.padding } : {}),
              }))
            }
          />
        </SettingsSection>
      </SettingsSections>

      {canEdit && (
        <SettingsSaveBar
          isDirty={isDirty}
          pending={updateMutation.isPending}
          onReset={() => org && load(org as Record<string, unknown>)}
          onSave={() => updateMutation.mutate()}
        />
      )}
    </FadeIn>
  );
}
