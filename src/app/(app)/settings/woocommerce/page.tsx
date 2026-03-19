"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import {
  wooCommerceIntegrationSchema,
  type WooCommerceIntegrationFormValues,
} from "@/lib/validations/woocommerce";
import {
  getWooCommerceIntegration,
  updateWooCommerceIntegration,
  regenerateWebhookSecret,
  getWooCommerceOrderLogs,
  getLastPayloadMetaKeys,
  retryFailedOrder,
} from "@/server/woocommerce";
import { getLocations } from "@/server/locations";
import { useActiveOrganization } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FormSection } from "@/components/layout/page-layouts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const projectTypeOptions = [
  { value: "DRY_HIRE", label: "Dry Hire" },
  { value: "WET_HIRE", label: "Wet Hire" },
  { value: "INSTALLATION", label: "Installation" },
  { value: "TOUR", label: "Tour" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "THEATRE", label: "Theatre" },
  { value: "FESTIVAL", label: "Festival" },
  { value: "CONFERENCE", label: "Conference" },
  { value: "OTHER", label: "Other" },
];

const dateFormatOptions = [
  { value: "auto", label: "Auto-detect" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (Australian)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (US)" },
  { value: "ISO", label: "ISO 8601 (YYYY-MM-DD)" },
];

export default function WooCommerceSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showMetaDetect, setShowMetaDetect] = useState(false);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["woocommerce-integration", orgId],
    queryFn: () => getWooCommerceIntegration(),
    enabled: !!orgId,
  });

  const { data: orderLogs } = useQuery({
    queryKey: ["woocommerce-logs", orgId],
    queryFn: () => getWooCommerceOrderLogs({ pageSize: 10 }),
    enabled: !!orgId,
  });

  const { data: metaKeys } = useQuery({
    queryKey: ["woocommerce-meta-keys", orgId],
    queryFn: () => getLastPayloadMetaKeys(),
    enabled: !!orgId && showMetaDetect,
  });

  const { data: locationsData } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: () => getLocations({ pageSize: 200 }),
    enabled: !!orgId,
  });
  const locationsList = locationsData?.locations as { id: string; name: string }[] | undefined;

  const form = useForm<WooCommerceIntegrationFormValues>({
    resolver: zodResolver(wooCommerceIntegrationSchema),
    defaultValues: {
      isEnabled: false,
      storeUrl: "",
      productMatchField: "sku",
      customFieldKey: "",
      rentalStartKey: "",
      rentalEndKey: "",
      eventStartKey: "",
      deliveryAddressKey: "",
      notesKey: "",
      locationMetaKey: "",
      defaultLocationId: "",
      dateFormat: "auto",
      defaultProjectType: "DRY_HIRE",
      autoConfirmEnquiry: false,
      notifyUserIds: [],
    },
    values: integration
      ? {
          isEnabled: integration.isEnabled,
          storeUrl: integration.storeUrl || "",
          productMatchField: integration.productMatchField as "sku" | "custom_field" | "name",
          customFieldKey: integration.customFieldKey || "",
          rentalStartKey: integration.rentalStartKey || "",
          rentalEndKey: integration.rentalEndKey || "",
          eventStartKey: integration.eventStartKey || "",
          deliveryAddressKey: integration.deliveryAddressKey || "",
          notesKey: integration.notesKey || "",
          locationMetaKey: integration.locationMetaKey || "",
          defaultLocationId: integration.defaultLocationId || "",
          dateFormat: (integration.dateFormat || "auto") as "auto" | "DD/MM/YYYY" | "MM/DD/YYYY" | "ISO",
          defaultProjectType: integration.defaultProjectType as WooCommerceIntegrationFormValues["defaultProjectType"],
          autoConfirmEnquiry: integration.autoConfirmEnquiry,
          notifyUserIds: integration.notifyUserIds || [],
        }
      : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: WooCommerceIntegrationFormValues) => updateWooCommerceIntegration(data),
    onSuccess: () => {
      toast.success("WooCommerce settings saved");
      queryClient.invalidateQueries({ queryKey: ["woocommerce-integration"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const regenMutation = useMutation({
    mutationFn: () => regenerateWebhookSecret(),
    onSuccess: () => {
      toast.success("Webhook secret regenerated");
      queryClient.invalidateQueries({ queryKey: ["woocommerce-integration"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const retryMutation = useMutation({
    mutationFn: (logId: string) => retryFailedOrder(logId),
    onSuccess: () => {
      toast.success("Order retry initiated");
      queryClient.invalidateQueries({ queryKey: ["woocommerce-logs"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/integrations/woocommerce/webhook`
    : "";

  if (isLoading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="t-heading text-fg">WooCommerce Integration</h2>
        <p className="text-[12px] text-fg-3">
          Automatically create projects from WooCommerce orders.
        </p>
      </div>

      <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} className="space-y-6">
        {/* Enable/Disable */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6 flex items-center justify-between">
          <div>
            <Label>Enable Integration</Label>
            <p className="text-xs text-fg-3">
              When enabled, incoming WooCommerce webhooks will create projects automatically.
            </p>
          </div>
          <Controller
            name="isEnabled"
            control={form.control}
            render={({ field }) => (
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </div>

        {/* Connection */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection title="Connection" description="Configure the webhook connection between WooCommerce and GearFlow.">
            <div className="sm:col-span-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storeUrl">Store URL</Label>
              <Input
                id="storeUrl"
                {...form.register("storeUrl")}
                placeholder="https://www.yourstore.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Webhook URL (copy to WooCommerce)</Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Webhook Secret</Label>
              <div className="flex gap-2">
                <Input
                  value={integration?.webhookSecret || "Not yet generated"}
                  readOnly
                  type={showSecret ? "text" : "password"}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (integration?.webhookSecret) {
                      navigator.clipboard.writeText(integration.webhookSecret);
                      toast.success("Secret copied to clipboard");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => regenMutation.mutate()}
                  disabled={regenMutation.isPending}
                >
                  <RefreshCw className={`h-4 w-4 ${regenMutation.isPending ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this secret into WooCommerce webhook settings. Regenerating will invalidate the old secret.
              </p>
            </div>
            </div>
          </FormSection>
        </div>

        {/* Product Matching */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection title="Product Matching" description="How to match WooCommerce products to GearFlow models.">
            <div className="sm:col-span-2 space-y-4">
            <div className="space-y-2">
              <Label>Match Strategy</Label>
              <Controller
                name="productMatchField"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {field.value === "sku" ? "SKU → Model SKU / Model Number"
                          : field.value === "custom_field" ? "Custom meta field → Model ID"
                          : "Product name → Model name (fuzzy)"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sku">SKU → Model SKU / Model Number</SelectItem>
                      <SelectItem value="custom_field">Custom meta field → Model ID</SelectItem>
                      <SelectItem value="name">Product name → Model name (fuzzy)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {form.watch("productMatchField") === "custom_field" && (
              <div className="space-y-2">
                <Label htmlFor="customFieldKey">Custom Field Key</Label>
                <Input
                  id="customFieldKey"
                  {...form.register("customFieldKey")}
                  placeholder="e.g. gearflow_model_id"
                />
              </div>
            )}
            </div>
          </FormSection>
        </div>

        {/* Date Field Mapping */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection
            title="Date Field Mapping"
            description="Map WooCommerce order meta fields to project dates."
          >
            <div className="sm:col-span-2 space-y-4">
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => setShowMetaDetect(!showMetaDetect)}
            >
              {showMetaDetect ? "Hide" : "Test & Detect"}
            </button>
            {showMetaDetect && (
              <MetaDetectPanel
                metaKeys={metaKeys}
                onSelectKey={(key) => {
                  // Auto-fill the first empty date field
                  if (!form.getValues("rentalStartKey")) {
                    form.setValue("rentalStartKey", key);
                  } else if (!form.getValues("rentalEndKey")) {
                    form.setValue("rentalEndKey", key);
                  } else if (!form.getValues("eventStartKey")) {
                    form.setValue("eventStartKey", key);
                  }
                  toast.success(`Mapped "${key}"`);
                }}
              />
            )}

            <div className="space-y-2">
              <Label>Date Format</Label>
              <Controller
                name="dateFormat"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {dateFormatOptions.find((o) => o.value === field.value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {dateFormatOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rentalStartKey">Rental Start Key</Label>
                <Input
                  id="rentalStartKey"
                  {...form.register("rentalStartKey")}
                  placeholder="e.g. rental_start_date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rentalEndKey">Rental End Key</Label>
                <Input
                  id="rentalEndKey"
                  {...form.register("rentalEndKey")}
                  placeholder="e.g. rental_end_date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventStartKey">Event Date Key</Label>
                <Input
                  id="eventStartKey"
                  {...form.register("eventStartKey")}
                  placeholder="e.g. event_date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deliveryAddressKey">Delivery Address Key</Label>
                <Input
                  id="deliveryAddressKey"
                  {...form.register("deliveryAddressKey")}
                  placeholder="e.g. delivery_address"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notesKey">Notes Key</Label>
              <Input
                id="notesKey"
                {...form.register("notesKey")}
                placeholder="e.g. order_notes"
              />
            </div>
            </div>
          </FormSection>
        </div>

        {/* Location Mapping */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection title="Location Mapping" description="Map a WooCommerce order meta field to a project location. If the value matches an existing location it will be used; otherwise a new venue location is created automatically.">
            <div className="sm:col-span-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="locationMetaKey">Location Meta Key</Label>
              <Input
                id="locationMetaKey"
                {...form.register("locationMetaKey")}
                placeholder="e.g. venue_name or delivery_location"
              />
              <p className="text-xs text-muted-foreground">
                The WooCommerce order meta key containing the venue or delivery location name/address.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Default Location (fallback)</Label>
              <Controller
                name="defaultLocationId"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {field.value
                          ? locationsList?.find(
                              (l) => l.id === field.value,
                            )?.name ?? "Unknown"
                          : "None (no fallback)"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None (no fallback)</SelectItem>
                      {locationsList?.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-fg-3">
                Used when no location meta key is set, or the meta field is empty.
              </p>
            </div>
            </div>
          </FormSection>
        </div>

        {/* Project Defaults */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <FormSection title="Project Defaults">
            <div className="sm:col-span-2 space-y-4">
            <div className="space-y-2">
              <Label>Default Project Type</Label>
              <Controller
                name="defaultProjectType"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {projectTypeOptions.find((o) => o.value === field.value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {projectTypeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-advance to Quoting</Label>
                <p className="text-xs text-muted-foreground">
                  Set new projects to Quoting instead of Enquiry.
                </p>
              </div>
              <Controller
                name="autoConfirmEnquiry"
                control={form.control}
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>
            </div>
          </FormSection>
        </div>

        {/* WordPress Setup Guide */}
        <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between p-5 sm:p-6"
            onClick={() => setShowSetupGuide(!showSetupGuide)}
          >
            <div className="text-left">
              <h3 className="t-heading text-fg">WordPress Setup Guide</h3>
              <p className="mt-0.5 text-[12px] text-fg-3">How to configure WooCommerce to send orders to GearFlow.</p>
            </div>
            {showSetupGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showSetupGuide && (
            <div className="px-5 pb-5 sm:px-6 sm:pb-6 space-y-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium">1. Create a Webhook</h4>
                <p className="text-muted-foreground">
                  In WordPress admin: WooCommerce &rarr; Settings &rarr; Advanced &rarr; Webhooks &rarr; Add Webhook
                </p>
                <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                  <li><strong>Name:</strong> GearFlow Project Creation</li>
                  <li><strong>Status:</strong> Active</li>
                  <li><strong>Topic:</strong> Order created</li>
                  <li><strong>Delivery URL:</strong> Copy the Webhook URL above</li>
                  <li><strong>Secret:</strong> Copy the Webhook Secret above</li>
                  <li><strong>API Version:</strong> WP REST API Integration v3</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">2. Save Custom Checkout Fields to Order Meta</h4>
                <p className="text-muted-foreground">
                  If your checkout has custom date fields (e.g. from a booking plugin), ensure they are saved
                  as order meta. Add this PHP snippet to your theme&apos;s <code className="text-xs bg-muted px-1 py-0.5 rounded">functions.php</code>:
                </p>
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">{`add_action('woocommerce_checkout_update_order_meta', function($order_id) {
  $fields = ['rental_start_date', 'rental_end_date', 'event_date', 'delivery_address'];
  foreach ($fields as $field) {
    if (!empty($_POST[$field])) {
      update_post_meta($order_id, $field, sanitize_text_field($_POST[$field]));
    }
  }
});`}</pre>
                <p className="text-muted-foreground">
                  Adjust the field names to match your checkout form. Then set the same keys in the Date Field Mapping above.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">3. Set Product SKUs</h4>
                <p className="text-muted-foreground">
                  For SKU matching: set each WooCommerce product&apos;s SKU to match the corresponding GearFlow model&apos;s SKU or Model Number.
                  Go to Products &rarr; Edit &rarr; Inventory &rarr; SKU.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Settings
        </Button>
      </form>

      {/* Order Logs */}
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <FormSection title="Recent Orders" description="Webhook deliveries and processing results.">
          <div className="sm:col-span-2">
          {!orderLogs?.items?.length ? (
            <p className="text-sm text-muted-foreground">No orders received yet.</p>
          ) : (
            <div className="space-y-2">
              {orderLogs.items.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={log.status} />
                      <span className="font-mono font-medium">
                        #{log.wooOrderNumber || log.wooOrderId}
                      </span>
                      <StatusBadge status={log.status} />
                    </div>
                    {log.project && (
                      <p className="text-muted-foreground">
                        &rarr; {log.project.projectNumber} — {log.project.name}
                      </p>
                    )}
                    {log.errorMessage && (
                      <p className="text-destructive text-xs">{log.errorMessage}</p>
                    )}
                    {log.matchResults && (
                      <MatchSummary results={log.matchResults as unknown as MatchResult[]} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </span>
                    {log.status === "FAILED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryMutation.mutate(log.id)}
                        disabled={retryMutation.isPending}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </FormSection>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface MatchResult {
  wooProductName: string;
  wooSku?: string;
  matched: boolean;
  modelName?: string;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "FAILED":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "DUPLICATE":
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    default:
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "COMPLETED" ? "default"
    : status === "FAILED" ? "destructive"
    : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function MatchSummary({ results }: { results: MatchResult[] }) {
  const matched = results.filter((r) => r.matched).length;
  const total = results.length;
  if (matched === total) {
    return <p className="text-xs text-green-600">{total} product{total !== 1 ? "s" : ""} matched</p>;
  }
  return (
    <p className="text-xs text-yellow-600">
      {matched}/{total} products matched
      {results.filter((r) => !r.matched).map((r) => (
        <span key={r.wooProductName} className="block text-muted-foreground">
          No match: {r.wooProductName}{r.wooSku ? ` (${r.wooSku})` : ""}
        </span>
      ))}
    </p>
  );
}

function MetaDetectPanel({
  metaKeys,
  onSelectKey,
}: {
  metaKeys: { orderMeta: { key: string; value: string }[]; lineItemMeta: string[] } | null | undefined;
  onSelectKey: (key: string) => void;
}) {
  if (!metaKeys) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        <p>No webhook payload stored yet.</p>
        <p>Send a test order from WooCommerce to detect available meta fields.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <p className="text-sm font-medium">Detected Meta Fields</p>
      <p className="text-xs text-muted-foreground">
        Click a key to map it to the next empty date field.
      </p>
      {metaKeys.orderMeta.length > 0 ? (
        <div className="space-y-1">
          {metaKeys.orderMeta.map((m) => (
            <button
              key={m.key}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent"
              onClick={() => onSelectKey(m.key)}
            >
              <code className="font-mono">{m.key}</code>
              <span className="text-muted-foreground truncate ml-4 max-w-[200px]">
                {m.value}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No order-level meta fields found.</p>
      )}
    </div>
  );
}
