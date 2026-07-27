"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FadeIn } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { ProjectNumberingSettings } from "@/components/settings/project-numbering-settings";
import { InvoiceNumberingSettings } from "@/components/settings/invoice-numbering-settings";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";

const COUNTRIES: { value: string; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "IE", label: "Ireland" },
  { value: "SG", label: "Singapore" },
  { value: "HK", label: "Hong Kong" },
  { value: "JP", label: "Japan" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "NL", label: "Netherlands" },
  { value: "SE", label: "Sweden" },
  { value: "NO", label: "Norway" },
  { value: "DK", label: "Denmark" },
  { value: "FI", label: "Finland" },
  { value: "IN", label: "India" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "ZA", label: "South Africa" },
];

const TIMEZONES: { value: string; label: string }[] = [
  { value: "", label: "Auto (browser)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (NZST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
  { value: "Australia/Brisbane", label: "Australia/Brisbane (AEST, no DST)" },
  { value: "Australia/Adelaide", label: "Australia/Adelaide (ACST)" },
  { value: "Australia/Darwin", label: "Australia/Darwin (ACST, no DST)" },
  { value: "Australia/Perth", label: "Australia/Perth (AWST)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
  { value: "America/Chicago", label: "America/Chicago (CST)" },
  { value: "America/Denver", label: "America/Denver (MST)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST)" },
  { value: "UTC", label: "UTC" },
];

const countryLabel = (v: string) => COUNTRIES.find((c) => c.value === v)?.label ?? "Not set";
const timezoneLabel = (v: string) => TIMEZONES.find((t) => t.value === v)?.label ?? "Auto (browser)";

/** A flat form section: title + helper on the left rail, fields on the right (Dub/Stripe grammar). */
function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 p-5 sm:p-6 md:grid-cols-[minmax(0,200px)_1fr]">
      <div className="md:pt-0.5">
        <h2 className="t-heading text-ink">{title}</h2>
        <p className="mt-1 t-micro text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function GeneralSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});
  const [defaultTaxRate, setDefaultTaxRate] = useState<string>("");

  // Snapshot of the last loaded/saved values — drives the dirty-state affordance.
  const [baseline, setBaseline] = useState<string>("");

  const currentSnapshot = useMemo(
    () => JSON.stringify({ name, settings, defaultTaxRate }),
    [name, settings, defaultTaxRate],
  );
  const isDirty = baseline !== "" && currentSnapshot !== baseline;

  useEffect(() => {
    if (org) {
      const nextName = ((org as Record<string, unknown>).name as string) || "";
      const nextSettings = ((org as Record<string, unknown>).settings as OrgSettings) || {};
      const taxRate = (org as Record<string, unknown>).defaultTaxRate;
      const nextTaxRate = taxRate != null ? String(taxRate) : "";

      setName(nextName);
      setSettings(nextSettings);
      setDefaultTaxRate(nextTaxRate);
      setBaseline(
        JSON.stringify({ name: nextName, settings: nextSettings, defaultTaxRate: nextTaxRate }),
      );
    }
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
      setBaseline(currentSnapshot);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    if (!org) return;
    const nextName = ((org as Record<string, unknown>).name as string) || "";
    const nextSettings = ((org as Record<string, unknown>).settings as OrgSettings) || {};
    const taxRate = (org as Record<string, unknown>).defaultTaxRate;
    const nextTaxRate = taxRate != null ? String(taxRate) : "";
    setName(nextName);
    setSettings(nextSettings);
    setDefaultTaxRate(nextTaxRate);
    setBaseline(
      JSON.stringify({ name: nextName, settings: nextSettings, defaultTaxRate: nextTaxRate }),
    );
  };

  const updateSetting = (key: keyof OrgSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn className="space-y-6 pb-24">
      {/* General */}
      <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
        <SettingsSection
          title="General"
          description="Business identity shown on documents, dockets and quotes."
        >
          <div className="space-y-2">
            <Label htmlFor="orgName">Business name</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="orgEmail">Email</Label>
              <Input
                id="orgEmail"
                type="email"
                value={settings.email || ""}
                onChange={(e) => updateSetting("email", e.target.value)}
                placeholder="info@company.com"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgPhone">Phone</Label>
              <Input
                id="orgPhone"
                value={settings.phone || ""}
                onChange={(e) => updateSetting("phone", e.target.value)}
                placeholder="+61 ..."
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgWebsite">Website</Label>
            <Input
              id="orgWebsite"
              value={settings.website || ""}
              onChange={(e) => updateSetting("website", e.target.value)}
              placeholder="https://..."
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgAddress">Address</Label>
            <Input
              id="orgAddress"
              value={settings.address || ""}
              onChange={(e) => updateSetting("address", e.target.value)}
              placeholder="123 Main St, City"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Select
              value={settings.country || ""}
              onValueChange={(v) => updateSetting("country", v)}
              disabled={!canEdit}
            >
              <SelectTrigger id="country">
                <SelectValue>{countryLabel(settings.country || "")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.value || "none"} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="t-micro text-muted">
              Used to prefer local results in address autocomplete.
            </p>
          </div>
        </SettingsSection>

        {/* Timezone & locale */}
        <div className="border-t border-line">
          <SettingsSection
            title="Timezone"
            description="Controls how dates and times display across the platform."
          >
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={settings.timezone || ""}
                onValueChange={(v) => updateSetting("timezone", v)}
                disabled={!canEdit}
              >
                <SelectTrigger id="timezone">
                  <SelectValue>{timezoneLabel(settings.timezone || "")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => (
                    <SelectItem key={t.value || "auto"} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="t-micro text-muted">
                Used for date display across the platform.
              </p>
            </div>
          </SettingsSection>
        </div>

        {/* Project defaults */}
        <div className="border-t border-line">
          <SettingsSection
            title="Project defaults"
            description="Applied to new projects. Each project can override these."
          >
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
                Applied to new projects unless overridden. Used for GST/VAT calculation.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ProjectNumberingSettings
                format={settings.projectNumberFormat ?? ""}
                reset={settings.projectNumberIncrementReset ?? "MONTHLY"}
                padding={settings.projectNumberIncrementPadding ?? 2}
                disabled={!canEdit}
                onChange={(patch) =>
                  setSettings((prev) => ({
                    ...prev,
                    ...(patch.format !== undefined ? { projectNumberFormat: patch.format } : {}),
                    ...(patch.reset !== undefined ? { projectNumberIncrementReset: patch.reset } : {}),
                    ...(patch.padding !== undefined ? { projectNumberIncrementPadding: patch.padding } : {}),
                  }))
                }
              />
              {/* WS1 (#940) — same engine, disjoint "INV:" counter namespace. */}
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
            </div>
          </SettingsSection>
        </div>
      </div>

      {/* Save — sticky footer bar with a dirty-state affordance (Vapi grammar) */}
      {canEdit && (
        <div className="sticky bottom-4 z-10">
          <div
            className={cn(
              "flex items-center justify-between gap-4 rounded-[var(--r)] border border-line bg-paper-2/95 px-4 py-3 shadow-[var(--sh-card)] backdrop-blur transition-opacity",
              isDirty ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
            aria-hidden={!isDirty}
          >
            <p className="t-small text-ink-2">You have unsaved changes.</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="line"
                size="sm"
                onClick={resetForm}
                disabled={updateMutation.isPending}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => updateMutation.mutate()}
                loading={updateMutation.isPending}
                disabled={updateMutation.isPending}
              >
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </FadeIn>
  );
}
