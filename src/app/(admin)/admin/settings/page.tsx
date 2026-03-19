"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: getSiteSettings,
  });

  const [form, setForm] = useState({
    platformName: "GearFlow",
    platformIcon: null as string | null,
    registrationPolicy: "OPEN",
    defaultCurrency: "AUD",
    defaultTaxRate: 10,
    socialLoginGoogle: false,
    socialLoginMicrosoft: false,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        platformName: settings.platformName || "GearFlow",
        platformIcon: settings.platformIcon || null,
        registrationPolicy: settings.registrationPolicy || "OPEN",
        defaultCurrency: settings.defaultCurrency || "AUD",
        defaultTaxRate: settings.defaultTaxRate ?? 10,
        socialLoginGoogle: settings.socialLoginGoogle ?? false,
        socialLoginMicrosoft: settings.socialLoginMicrosoft ?? false,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => updateSiteSettings(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      queryClient.invalidateQueries({ queryKey: ["platform-branding"] });
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
              <Badge variant="outline" className="ml-auto text-xs">Preview</Badge>
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
              <Badge variant={adminRegEnabled ? "default" : "secondary"}>
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
            <h3 className="t-heading">Social Login</h3>
            <p className="text-sm text-fg-3">
              Enable or disable social login providers. Providers also require environment variables to be configured.
            </p>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <div>
                  <span className="text-sm font-medium">Google</span>
                  {!process.env.NEXT_PUBLIC_GOOGLE_CONFIGURED && (
                    <p className="text-xs text-fg-3">Env vars not configured</p>
                  )}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={form.socialLoginGoogle}
                  onChange={(e) => setForm((f) => ({ ...f, socialLoginGoogle: e.target.checked }))}
                />
                <div className="w-9 h-5 bg-bg-inset rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5" viewBox="0 0 21 21">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                <div>
                  <span className="text-sm font-medium">Microsoft</span>
                  {!process.env.NEXT_PUBLIC_MICROSOFT_CONFIGURED && (
                    <p className="text-xs text-fg-3">Env vars not configured</p>
                  )}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={form.socialLoginMicrosoft}
                  onChange={(e) => setForm((f) => ({ ...f, socialLoginMicrosoft: e.target.checked }))}
                />
                <div className="w-9 h-5 bg-bg-inset rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>
            <p className="text-xs text-fg-3">
              Social login requires both the admin toggle above AND the corresponding environment variables (GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID, etc.) to be set.
            </p>
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
