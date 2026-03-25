"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSection } from "@/components/layout/page-layouts";
import {
  getOrganization,
  updateOrganization,
  type OrgSettings,
} from "@/server/settings";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";

export default function TestTagSettingsPage() {
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

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  const updateMutation = useMutation({
    mutationFn: () => updateOrganization({ name, settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateTestTagSetting = (key: string, value: string | number) => {
    setSettings((prev) => ({
      ...prev,
      testTag: { ...prev.testTag, [key]: value },
    }));
  };

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
      <div className="space-y-6">
        <FormSection title="Test & Tag" description="Configure test tag ID format and testing defaults.">
          <div className="space-y-2">
            <Label htmlFor="ttPrefix">Test Tag Prefix</Label>
            <Input
              id="ttPrefix"
              value={settings.testTag?.prefix || ""}
              onChange={(e) => updateTestTagSetting("prefix", e.target.value)}
              placeholder="e.g. GF-TT-"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttDigits">Number of Digits</Label>
            <Input
              id="ttDigits"
              type="number"
              min={1}
              max={10}
              value={settings.testTag?.digits ?? 4}
              onChange={(e) => updateTestTagSetting("digits", parseInt(e.target.value) || 4)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttCounter">Current Counter</Label>
            <Input
              id="ttCounter"
              type="number"
              value={settings.testTag?.counter ?? 0}
              onChange={(e) => updateTestTagSetting("counter", parseInt(e.target.value) || 0)}
              disabled={!canEdit}
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-fg-3">
              Next test tag: <span className="font-mono font-medium">{(settings.testTag?.prefix || "TT")}{String((settings.testTag?.counter ?? 0) + 1).padStart(settings.testTag?.digits ?? 4, "0")}</span>
            </p>
          </div>
        </FormSection>

        <FormSection title="Test Profiles" description="Configure which visual checks and electrical tests apply for each equipment type.">
          <div className="sm:col-span-2">
            <Link
              href="/settings/test-and-tag/profiles"
              className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="font-medium text-fg-1">Manage Test Profiles</p>
                  <p className="text-sm text-fg-3">Define visual checks, electrical tests, and thresholds per equipment type</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-fg-3" />
            </Link>
          </div>
        </FormSection>

        <FormSection title="Testing Defaults" description="Default intervals and deployment policy.">
          <div className="space-y-2">
            <Label htmlFor="ttDefaultInterval">Default Interval (months)</Label>
            <Input
              id="ttDefaultInterval"
              type="number"
              min={1}
              max={120}
              value={settings.testTag?.defaultIntervalMonths ?? 3}
              onChange={(e) => updateTestTagSetting("defaultIntervalMonths", parseInt(e.target.value) || 3)}
              disabled={!canEdit}
            />
            <p className="text-xs text-fg-3">Hire/rental equipment: 3 months (AS/NZS 3760)</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttDueSoonDays">Due Soon Threshold (days)</Label>
            <Input
              id="ttDueSoonDays"
              type="number"
              min={1}
              max={90}
              value={settings.testTag?.dueSoonThresholdDays ?? 14}
              onChange={(e) => updateTestTagSetting("dueSoonThresholdDays", parseInt(e.target.value) || 14)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttCheckoutPolicy">Deployment Policy</Label>
            <select
              id="ttCheckoutPolicy"
              value={settings.testTag?.checkoutPolicy || "WARN"}
              onChange={(e) => updateTestTagSetting("checkoutPolicy", e.target.value)}
              disabled={!canEdit}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="WARN">Warn on overdue items</option>
              <option value="BLOCK">Block deployment of overdue items</option>
            </select>
            <p className="text-xs text-fg-3">
              What happens when deploying an asset with an overdue test tag
            </p>
          </div>
        </FormSection>
      </div>

      {canEdit && (
        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
    </FadeIn>
  );
}
