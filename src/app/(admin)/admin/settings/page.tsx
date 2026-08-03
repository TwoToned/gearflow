"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshPlatformBranding } from "@/lib/use-platform-name";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { IconPicker } from "@/components/admin/icon-picker";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import {
  getSiteSettings,
  updateSiteSettings,
  getOrgCreationCodeAdmin,
  regenerateOrgCreationCode,
} from "@/server/site-admin";
import { SettingsCard } from "@/components/layout/page-layouts";

interface SiteSettingsForm {
  platformName: string;
  platformIcon: string | null;
  registrationPolicy: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  allowOrgCreation: boolean;
  orgCreationCodeEnabled: boolean;
}

export default function AdminSettingsPage() {
  const { data: settings, refetch } = useServerQuery({
    queryKey: ["site-settings"],
    queryFn: getSiteSettings,
  });

  // Separate query — deliberately NOT part of getSiteSettings()'s payload
  // (org-creation-gate.ts's doc comment on why the code stays off SiteSettingsRow).
  const { data: orgCreationCode, refetch: refetchOrgCreationCode } = useServerQuery({
    queryKey: ["org-creation-code"],
    queryFn: getOrgCreationCodeAdmin,
  });

  const [form, setForm] = useState<SiteSettingsForm>({
    platformName: "RVLT Flow",
    platformIcon: null,
    registrationPolicy: "OPEN",
    defaultCurrency: "AUD",
    defaultTaxRate: 10,
    allowOrgCreation: true,
    orgCreationCodeEnabled: false,
  });

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ // eslint-disable-line react-hooks/set-state-in-effect
        ...f,
        platformName: settings.platformName || "RVLT Flow",
        platformIcon: settings.platformIcon || null,
        registrationPolicy: settings.registrationPolicy || "OPEN",
        defaultCurrency: settings.defaultCurrency || "AUD",
        defaultTaxRate: settings.defaultTaxRate ?? 10,
        allowOrgCreation: settings.allowOrgCreation ?? true,
      }));
    }
  }, [settings]);

  // A separate effect (and a separate query, above) since orgCreationCodeEnabled
  // lives outside getSiteSettings()'s payload and can resolve independently.
  useEffect(() => {
    if (orgCreationCode) {
      setForm((f) => ({ // eslint-disable-line react-hooks/set-state-in-effect
        ...f,
        orgCreationCodeEnabled: orgCreationCode.codeEnabled,
      }));
    }
  }, [orgCreationCode]);

  const saveMutation = useServerMutation({
    mutationFn: () => updateSiteSettings(form),
    onSuccess: () => {
      refetch();
      refreshPlatformBranding();
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateCodeMutation = useServerMutation({
    mutationFn: () => regenerateOrgCreationCode(),
    onSuccess: () => {
      refetchOrgCreationCode();
      toast.success("Signup code regenerated");
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

        <SettingsCard>
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
        </SettingsCard>

        <SettingsCard>
          <div className="mb-4">
            <h3 className="t-heading">Registration</h3>
            <p className="text-sm text-fg-3">
              Control who can create accounts on this platform.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Registration Policy</Label>
              <NativeSelect
                variant="compact"
                value={form.registrationPolicy}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    registrationPolicy: e.target.value,
                  }))
                }
              >
                <option value="OPEN">Open (anyone can register)</option>
                <option value="INVITE_ONLY">Invite Only</option>
                <option value="DISABLED">Disabled</option>
              </NativeSelect>
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
        </SettingsCard>

        <OrgCreationCard
          form={form}
          setForm={setForm}
          orgCreationCode={orgCreationCode}
          onRegenerate={() => regenerateCodeMutation.mutate()}
          regenerating={regenerateCodeMutation.isPending}
        />

        <SettingsCard>
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
        </SettingsCard>

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

/** Split out of AdminSettingsPage so its several fields don't push the page
 *  component's own line count up further (R-3.6). */
function OrgCreationCard({
  form,
  setForm,
  orgCreationCode,
  onRegenerate,
  regenerating,
}: {
  form: SiteSettingsForm;
  setForm: Dispatch<SetStateAction<SiteSettingsForm>>;
  orgCreationCode: { allowOrgCreation: boolean; codeEnabled: boolean; code: string | null } | undefined;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <SettingsCard>
      <div className="mb-4">
        <h3 className="t-heading">Organisation creation</h3>
        <p className="text-sm text-fg-3">
          Control who may create a new organisation on this platform. Separate from
          registration above — this gates creating an org, not a user account.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Allow organisation creation</p>
            <p className="text-xs text-fg-3">
              When off, an authenticated user with no organisation can&apos;t create one.
            </p>
          </div>
          <Switch
            checked={form.allowOrgCreation}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, allowOrgCreation: checked }))}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Require a signup code</p>
            <p className="text-xs text-fg-3">
              Creating an organisation requires the code below in addition to the toggle above.
            </p>
          </div>
          <Switch
            checked={form.orgCreationCodeEnabled}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, orgCreationCodeEnabled: checked }))
            }
            disabled={!form.allowOrgCreation}
          />
        </div>
        <div className="space-y-2">
          <Label>Signup code</Label>
          <div className="flex gap-2">
            <Input
              value={orgCreationCode?.code || "Not yet generated"}
              readOnly
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="line"
              size="icon"
              disabled={!orgCreationCode?.code}
              onClick={() => {
                if (orgCreationCode?.code) {
                  navigator.clipboard.writeText(orgCreationCode.code);
                  toast.success("Signup code copied to clipboard");
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="line"
              size="icon"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <p className="text-xs text-fg-3">
            Shown in plaintext — hand it out to whoever should be able to create an
            organisation. Regenerating invalidates the old code immediately.
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}
