"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import {
  getOrganization,
  updateOrganization,
  type OrgSettings,
} from "@/server/settings";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";

export default function GeneralSettingsPage() {
  const queryClient = useQueryClient();
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: getOrganization,
  });

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});
  const [defaultTaxRate, setDefaultTaxRate] = useState<string>("");

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
      const taxRate = (org as Record<string, unknown>).defaultTaxRate;
      setDefaultTaxRate(taxRate != null ? String(taxRate) : ""); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateOrganization({
        name,
        settings,
        defaultTaxRate: defaultTaxRate ? parseFloat(defaultTaxRate) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSetting = (key: keyof OrgSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const selectClassName =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <FadeIn className="space-y-8">
      {/* General section */}
      <section>
        <SectionHeader label="General" />
        <div className="mt-4 rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="orgName">Business Name</Label>
              <Input
                id="orgName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
              />
            </div>
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
            <div className="sm:col-span-2 space-y-2">
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
              <select
                id="country"
                value={settings.country || ""}
                onChange={(e) => updateSetting("country", e.target.value)}
                disabled={!canEdit}
                className={selectClassName}
              >
                <option value="">Not set</option>
                <option value="AU">Australia</option>
                <option value="NZ">New Zealand</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="IE">Ireland</option>
                <option value="SG">Singapore</option>
                <option value="HK">Hong Kong</option>
                <option value="JP">Japan</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="NL">Netherlands</option>
                <option value="SE">Sweden</option>
                <option value="NO">Norway</option>
                <option value="DK">Denmark</option>
                <option value="FI">Finland</option>
                <option value="IN">India</option>
                <option value="AE">United Arab Emirates</option>
                <option value="ZA">South Africa</option>
              </select>
              <p className="text-xs text-fg-3">
                Used to prefer local results in address autocomplete.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Timezone section */}
      <section>
        <SectionHeader label="Timezone" />
        <div className="mt-4 rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={settings.timezone || ""}
                onChange={(e) => updateSetting("timezone", e.target.value)}
                disabled={!canEdit}
                className={selectClassName}
              >
                <option value="">Auto (browser)</option>
                <option value="Pacific/Auckland">Pacific/Auckland (NZST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
                <option value="Australia/Brisbane">Australia/Brisbane (AEST, no DST)</option>
                <option value="Australia/Adelaide">Australia/Adelaide (ACST)</option>
                <option value="Australia/Darwin">Australia/Darwin (ACST, no DST)</option>
                <option value="Australia/Perth">Australia/Perth (AWST)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Chicago">America/Chicago (CST)</option>
                <option value="America/Denver">America/Denver (MST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                <option value="UTC">UTC</option>
              </select>
              <p className="text-xs text-fg-3">
                Used for date display across the platform.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Project Defaults */}
      <section>
        <SectionHeader label="Project Defaults" />
        <div className="mt-4 rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultTaxRate">Default Tax Rate (%)</Label>
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
              <p className="text-xs text-fg-3">
                Applied to new projects unless overridden. Used for GST/VAT calculation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Save button */}
      {canEdit && (
        <div className="flex justify-end">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </FadeIn>
  );
}
