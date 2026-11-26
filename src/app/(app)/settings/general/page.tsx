"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { SettingsSection, SettingsSections, SettingsSaveBar } from "@/components/settings/settings-section";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { ProjectNumberingSettings } from "@/components/settings/project-numbering-settings";
import { StatusAutomationSettings } from "@/components/settings/status-automation-settings";
import { CrewTimeSettingsPanel } from "@/components/settings/crew-time-settings";
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

export default function GeneralSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  // Snapshot of the last loaded/saved values — drives the dirty-state affordance.
  const [baseline, setBaseline] = useState<string>("");

  const currentSnapshot = useMemo(
    () => JSON.stringify({ name, settings }),
    [name, settings],
  );
  const isDirty = baseline !== "" && currentSnapshot !== baseline;

  useEffect(() => {
    if (org) {
      const nextName = ((org as Record<string, unknown>).name as string) || "";
      const nextSettings = ((org as Record<string, unknown>).settings as OrgSettings) || {};

      setName(nextName);
      setSettings(nextSettings);
      setBaseline(JSON.stringify({ name: nextName, settings: nextSettings }));
    }
  }, [org]);

  const updateMutation = useServerMutation({
    // No `defaultTaxRate` here: it moved to Billing (D60), and an omitted rate
    // leaves the stored one untouched.
    mutationFn: () => updateOrganization({ name, settings }),
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
    setName(nextName);
    setSettings(nextSettings);
    setBaseline(JSON.stringify({ name: nextName, settings: nextSettings }));
  };

  const updateSetting = (key: keyof OrgSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn className="space-y-6 pb-24">
      {/* General */}
      <SettingsSections>
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
            <Label htmlFor="orgAbn">ABN</Label>
            <Input
              id="orgAbn"
              value={settings.abn || ""}
              onChange={(e) => updateSetting("abn", e.target.value)}
              placeholder="12 345 678 901"
              disabled={!canEdit}
            />
            <p className="t-micro text-muted">
              Australian Business Number — required on Tax Invoices. Printed in the PDF header, under your address and email, on every document type.
            </p>
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
        <div>
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
        <div>
          <SettingsSection
            title="Job defaults"
            description="How new jobs are numbered. The default tax rate and invoice numbering are under Billing."
          >
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
            </div>
          </SettingsSection>
        </div>

        {/* Status automation (#1160) — its own section, not a "Job defaults"
            field: these change what the app DOES on its own, which is a different
            kind of setting from a value new projects inherit. */}
        <div>
          <SettingsSection
            title="Status automation"
            description="Let jobs move themselves as the work actually happens, instead of someone remembering to."
          >
            <StatusAutomationSettings
              value={settings.projectStatusAutomation}
              disabled={!canEdit}
              onChange={(next) => setSettings((prev) => ({ ...prev, projectStatusAutomation: next }))}
            />
            <p className="t-micro text-muted">
              Jobs only ever move FORWARD, and never into Confirmed, Completed or Invoiced — those
              commit stock, money or a lock, so they stay a deliberate click. Every automatic move is
              recorded in the job&rsquo;s activity log.
            </p>
          </SettingsSection>
        </div>

        {/* Crew & time (work-layer Phase 4, #1246) — the crew planner's
            confirmation layer. Its own section: unlike status automation this
            governs Triage visibility and an email opt-in, not the job lifecycle. */}
        <div>
          <SettingsSection
            title="Crew & time"
            description="Tune the crew planner's confirmation layer — when an unanswered offer surfaces to you, and whether crew get a reminder before call time."
          >
            <CrewTimeSettingsPanel
              value={settings.crewTime}
              disabled={!canEdit}
              onChange={(next) => setSettings((prev) => ({ ...prev, crewTime: next }))}
            />
          </SettingsSection>
        </div>
      </SettingsSections>

      {canEdit && (
        <SettingsSaveBar
          isDirty={isDirty}
          pending={updateMutation.isPending}
          onReset={resetForm}
          onSave={() => updateMutation.mutate()}
        />
      )}
    </FadeIn>
  );
}
