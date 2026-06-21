"use client";

import { useEffect, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshPlatformBranding } from "@/lib/use-platform-name";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { IconPicker } from "@/components/admin/icon-picker";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { getSiteSettings, updateSiteSettings } from "@/server/site-admin";

export default function AdminSettingsPage() {
  const { data: settings, refetch } = useServerQuery({
    queryKey: ["site-settings"],
    queryFn: getSiteSettings,
  });

  const [form, setForm] = useState({
    platformName: "GearFlow",
    platformIcon: null as string | null,
    registrationPolicy: "OPEN",
    defaultCurrency: "AUD",
    defaultTaxRate: 10,
  });

  useEffect(() => {
    if (settings) {
      setForm({ // eslint-disable-line react-hooks/set-state-in-effect
        platformName: settings.platformName || "GearFlow",
        platformIcon: settings.platformIcon || null,
        registrationPolicy: settings.registrationPolicy || "OPEN",
        defaultCurrency: settings.defaultCurrency || "AUD",
        defaultTaxRate: settings.defaultTaxRate ?? 10,
      });
    }
  }, [settings]);

  const saveMutation = useServerMutation({
    mutationFn: () => updateSiteSettings(form),
    onSuccess: () => {
      refetch();
      refreshPlatformBranding();
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const adminRegEnabled = process.env.NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED === "true";
  const initials = form.platformName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <AdminShell>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="t-title text-fg">
            Platform Settings
          </h1>
          <p className="text-fg-3">
            Global configuration for the platform.
          </p>
        </div>

        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="mb-4">
            <h3 className="t-heading">Branding</h3>
            <p className="text-sm text-fg-3">
              Configure the platform name and icon shown across the app.
            </p>
          </div>
          <div className="space-y-6">
            {/* Preview */}
            <div className="flex items-center gap-3 rounded-lg border p-4 bg-bg-inset/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
                {form.platformIcon ? (
                  <DynamicIcon name={form.platformIcon} className="h-5 w-5" />
                ) : (
                  initials
                )}
              </div>
              <span className="font-semibold text-lg">{form.platformName}</span>
              <Badge status="neutral" className="ml-auto text-xs">Preview</Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="platformName">Platform Name</Label>
              <Input
                id="platformName"
                value={form.platformName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, platformName: e.target.value }))
                }
              />
              <p className="text-xs text-fg-3">
                Shown in the sidebar, login page, and emails.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Platform Icon</Label>
              <IconPicker
                value={form.platformIcon}
                onChange={(icon) =>
                  setForm((f) => ({ ...f, platformIcon: icon }))
                }
              />
              <p className="text-xs text-fg-3">
                Replaces the text initials in the sidebar and auth pages. Leave empty to show initials.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="mb-4">
            <h3 className="t-heading">Registration</h3>
            <p className="text-sm text-fg-3">
              Control who can create accounts on this platform.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Registration Policy</Label>
              <select
                value={form.registrationPolicy}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    registrationPolicy: e.target.value,
                  }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="OPEN">Open (anyone can register)</option>
                <option value="INVITE_ONLY">Invite Only</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-3">
                Secret admin registration link:
              </span>
              <Badge status={adminRegEnabled ? "ok" : "neutral"}>
                {adminRegEnabled ? "Enabled" : "Disabled"}
              </Badge>
              <span className="text-xs text-fg-3">
                (configured via .env)
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="mb-4">
            <h3 className="t-heading">Defaults</h3>
            <p className="text-sm text-fg-3">
              Default currency and tax rate for the platform.
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultCurrency">Default Currency</Label>
                <Input
                  id="defaultCurrency"
                  value={form.defaultCurrency}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      defaultCurrency: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultTaxRate">Default Tax Rate (%)</Label>
                <Input
                  id="defaultTaxRate"
                  type="number"
                  step="0.01"
                  value={form.defaultTaxRate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      defaultTaxRate: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}
