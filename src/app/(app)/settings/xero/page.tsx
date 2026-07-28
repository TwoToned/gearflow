"use client";
// use-client: interactive settings form + server-action buttons (R-8.1.1)

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle, RefreshCw, Unplug, ExternalLink } from "lucide-react";

import { useXeroIntegration } from "@/hooks/use-xero-linked";
import {
  getXeroAuthorizeUrl,
  disconnectXero,
  refreshXeroReferenceData,
  updateXeroCodingSettings,
  isXeroConfigured,
  type XeroCodingSettingsInput,
} from "@/server/xero";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormSection, SettingsCard } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { XeroClientMapping } from "@/components/settings/xero-client-mapping";
import { useXeroCodingOptions } from "@/components/settings/xero-coding-fields";
import { RequirePermission } from "@/components/auth/require-permission";

const SERVICE_TYPES = [
  { key: "LABOUR", label: "Labour" },
  { key: "DELIVERY_TRANSPORT", label: "Delivery / transport" },
  { key: "MISC", label: "Misc" },
] as const;

export default function XeroSettingsPage() {
  const integration = useXeroIntegration();
  const searchParams = useSearchParams();
  const { data: xeroConfig, isLoading: xeroConfigLoading } = useServerQuery({
    queryKey: ["xero-configured"],
    queryFn: () => isXeroConfigured(),
  });

  useEffect(() => {
    if (searchParams.get("xero_connected")) toast.success("Xero connected");
    const err = searchParams.get("xero_error");
    if (err) toast.error(`Xero connection failed: ${decodeURIComponent(err)}`);
  }, [searchParams]);

  const connectMutation = useServerMutation({
    mutationFn: () => getXeroAuthorizeUrl(),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (e) => toast.error(e.message),
  });
  const disconnectMutation = useServerMutation({
    mutationFn: () => disconnectXero(),
    onSuccess: () => toast.success("Xero disconnected"),
    onError: (e) => toast.error(e.message),
  });
  const refreshMutation = useServerMutation({
    mutationFn: () => refreshXeroReferenceData(),
    onSuccess: (result) => toast.success(`Refreshed ${result.accounts} accounts, ${result.taxRates} tax rates`),
    onError: (e) => toast.error(e.message),
  });

  const isConnected = integration?.isConnected === true;
  const { accountOptions, taxRateOptions } = useXeroCodingOptions();

  const [defaultAccountCode, setDefaultAccountCode] = useState(integration?.defaultAccountCode ?? "");
  const [defaultTaxType, setDefaultTaxType] = useState(integration?.defaultTaxType ?? "");
  const [serviceDefaults, setServiceDefaults] = useState<Record<string, string>>(
    (integration?.serviceAccountDefaults as Record<string, string> | undefined) ?? {},
  );
  useEffect(() => {
    if (!integration) return;
    setDefaultAccountCode(integration.defaultAccountCode ?? "");
    setDefaultTaxType(integration.defaultTaxType ?? "");
    setServiceDefaults((integration.serviceAccountDefaults as Record<string, string> | undefined) ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed local edit state only when the underlying doc changes
  }, [integration?.cacheRefreshedAt, integration?.defaultAccountCode, integration?.defaultTaxType]);

  const saveSettingsMutation = useServerMutation({
    mutationFn: (data: XeroCodingSettingsInput) => updateXeroCodingSettings(data),
    onSuccess: () => toast.success("Xero coding defaults saved"),
    onError: (e) => toast.error(e.message),
  });

  // Deployment-level gate — settings nav already hides this page's link when
  // unconfigured, but a direct URL visit should get a clear message instead
  // of a "Connect Xero" button that would just throw at click-time.
  if (!xeroConfigLoading && xeroConfig?.configured !== true) {
    return (
      <FormSection title="Xero" description="Connect Xero to push draft invoices and resolve account coding.">
        <SettingsCard>
          <p className="t-body text-fg-3">
            Xero isn&apos;t configured on this deployment yet — an admin needs to set
            <code className="mx-1 rounded bg-paper-2 px-1 py-0.5 t-micro">XERO_CLIENT_ID</code>
            and
            <code className="mx-1 rounded bg-paper-2 px-1 py-0.5 t-micro">XERO_CLIENT_SECRET</code>
            before any organisation can connect.
          </p>
        </SettingsCard>
      </FormSection>
    );
  }

  return (
    <div className="space-y-8">
      <FormSection title="Xero" description="Connect Xero to push draft invoices and resolve account coding.">
        <SettingsCard>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Badge status="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Connected{integration?.tenantName ? ` — ${integration.tenantName}` : ""}</Badge>
              ) : (
                <Badge status="neutral"><XCircle className="h-3.5 w-3.5" /> Not connected</Badge>
              )}
            </div>
            <RequirePermission resource="invoice" action="xero_manage">
              {isConnected ? (
                <Button type="button" variant="line" loading={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate(undefined)}>
                  <Unplug className="h-4 w-4" /> Disconnect
                </Button>
              ) : (
                <Button type="button" loading={connectMutation.isPending} onClick={() => connectMutation.mutate(undefined)}>
                  <ExternalLink className="h-4 w-4" /> Connect Xero
                </Button>
              )}
            </RequirePermission>
          </div>
          {integration?.lastSyncError && (
            <p className="mt-2 t-micro text-destructive">Last sync error: {integration.lastSyncError}</p>
          )}
        </SettingsCard>
      </FormSection>

      {isConnected && (
        <>
          <FormSection
            title="Reference data"
            description="Chart of accounts + tax rates, cached from Xero — pickers never hit Xero per keystroke."
          >
            <SettingsCard>
              <div className="flex items-center justify-between gap-4">
                <div className="t-micro text-fg-3">
                  {accountOptions.length} accounts, {taxRateOptions.length} tax rates
                  {integration?.cacheRefreshedAt ? ` — refreshed ${new Date(integration.cacheRefreshedAt).toLocaleString()}` : " — never refreshed"}
                  {integration?.cacheError && <span className="block text-destructive">Last refresh failed: {integration.cacheError}</span>}
                </div>
                <RequirePermission resource="invoice" action="xero_manage">
                  <Button type="button" variant="line" size="sm" loading={refreshMutation.isPending} onClick={() => refreshMutation.mutate(undefined)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </RequirePermission>
              </div>
            </SettingsCard>
          </FormSection>

          <FormSection title="Account coding defaults" description="Cascade: line override -> model/kit -> category -> org default (below).">
            <SettingsCard>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Org default account</Label>
                  <ComboboxPicker
                    value={defaultAccountCode}
                    onChange={setDefaultAccountCode}
                    options={accountOptions}
                    placeholder="Select…"
                    searchPlaceholder="Search accounts…"
                    emptyMessage="No accounts found."
                    allowClear
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Default GST tax type</Label>
                  <ComboboxPicker
                    value={defaultTaxType}
                    onChange={setDefaultTaxType}
                    options={taxRateOptions}
                    placeholder="Select…"
                    searchPlaceholder="Search tax types…"
                    emptyMessage="No tax types found."
                    allowClear
                    className="w-full"
                  />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Label>Per-service-type defaults</Label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {SERVICE_TYPES.map((s) => (
                    <div key={s.key} className="space-y-1">
                      <Label className="t-micro text-fg-3">{s.label}</Label>
                      <ComboboxPicker
                        value={serviceDefaults[s.key] ?? ""}
                        onChange={(v) => setServiceDefaults((prev) => ({ ...prev, [s.key]: v }))}
                        options={accountOptions}
                        placeholder="Org default"
                        searchPlaceholder="Search accounts…"
                        emptyMessage="No accounts found."
                        allowClear
                        className="w-full"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <RequirePermission resource="invoice" action="xero_manage">
                <div className="mt-4">
                  <Button
                    type="button"
                    loading={saveSettingsMutation.isPending}
                    onClick={() =>
                      saveSettingsMutation.mutate({
                        defaultAccountCode: defaultAccountCode || undefined,
                        defaultTaxType: defaultTaxType || undefined,
                        serviceAccountDefaults: serviceDefaults as XeroCodingSettingsInput["serviceAccountDefaults"],
                      })
                    }
                  >
                    Save coding defaults
                  </Button>
                </div>
              </RequirePermission>
            </SettingsCard>
          </FormSection>

          <RequirePermission resource="invoice" action="xero_manage">
            <FormSection title="Client mapping" description="Map each client to a Xero contact. Search for a client, then search/link/unlink its Xero contact.">
              <SettingsCard>
                <XeroClientMapping />
              </SettingsCard>
            </FormSection>
          </RequirePermission>

          <FormSection title="Invoice numbering" description="Configured on Settings -> General (same format engine as project numbers, namespaced separately). Default: INV-%YYYY-%SEQ, yearly reset, 4 digits.">
            <SettingsCard>
              <p className="t-micro text-fg-3">
                Format editing lives on <a className="underline" href="/settings">Settings → General</a> alongside project numbering — one settings surface for both numbering engines.
              </p>
            </SettingsCard>
          </FormSection>
        </>
      )}
    </div>
  );
}
