"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

export default function BillingSettingsPage() {
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
      setName((org as Record<string, unknown>).name as string || "");
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {});
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

  const updateSetting = (key: keyof OrgSettings, value: string | number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
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
    </div>
    </FadeIn>
  );
}
