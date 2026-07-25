"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSection, SettingsCard } from "@/components/layout/page-layouts";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";
import { FadeIn } from "@/components/ui/motion";

export default function BillingSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  const updateMutation = useServerMutation({
    mutationFn: () => updateOrganization({ name, settings }),
    onSuccess: () => {
      refreshOrganization(orgId);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSetting = (key: keyof OrgSettings, value: string | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn>
    <SettingsCard>
      <div className="space-y-6">
        <FormSection title="Billing" description="Currency and tax configuration for quotes and invoices.">
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value={settings.currency || "AUD"}
              onChange={(e) => updateSetting("currency", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxRate">Tax Rate (%)</Label>
            <Input
              id="taxRate"
              type="number"
              step="0.01"
              value={settings.taxRate ?? 10}
              onChange={(e) => updateSetting("taxRate", parseFloat(e.target.value) || 0)}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxLabel">Tax Label</Label>
            <Input
              id="taxLabel"
              value={settings.taxLabel || "GST"}
              onChange={(e) => updateSetting("taxLabel", e.target.value)}
              disabled={!canEdit}
            />
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
    </SettingsCard>
    </FadeIn>
  );
}
