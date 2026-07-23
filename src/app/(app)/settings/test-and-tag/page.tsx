"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";

import { toast } from "sonner";

import Link from "next/link";
import { ChevronRight, ShieldCheck, Copy, Trash2, Plus, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSection } from "@/components/layout/page-layouts";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import {
  getAuditorTokens,
  createAuditorToken,
  updateAuditorToken,
  revokeAuditorToken,
  deleteAuditorToken,
  getAuditorScopeOptions,
  type AuditorTokenScope,
} from "@/server/test-tag-auditor";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";

export default function TestTagSettingsPage() {
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

  const updateTestTagSetting = (key: string, value: string | number | boolean) => {
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

        <FormSection title="Email Reminders" description="Daily digest emails for overdue and due-soon items.">
          <div className="sm:col-span-2 flex items-center gap-3">
            <input
              type="checkbox"
              id="ttEmailReminders"
              checked={settings.testTag?.emailReminders !== false}
              onChange={(e) => updateTestTagSetting("emailReminders", e.target.checked)}
              disabled={!canEdit}
              className="h-4 w-4 rounded border-border text-teal-600 focus:ring-teal-500"
            />
            <Label htmlFor="ttEmailReminders" className="cursor-pointer">
              Send daily digest emails to admins when items are overdue or due soon
            </Label>
          </div>
        </FormSection>

        <FormSection title="Auditor Portal Links" description="Share read-only compliance views with auditors and insurers.">
          <div className="sm:col-span-2">
            <AuditorLinksSection canEdit={canEdit} />
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

// ─── Label Maps ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Extension Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD (Portable)",
  RCD_FIXED: "RCD (Fixed)",
  THREE_PHASE: "Three Phase",
  MICROWAVE: "Microwave",
  OTHER: "Other",
};

const CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (Double Insulated)",
  LEAD_CORD_ASSEMBLY: "Lead / Cord Assembly",
};

// ─── Auditor Links Sub-Component ─────────────────────────────────────────────

type AuditorTokenItem = {
  id: string;
  name: string;
  token: string;
  isActive: boolean;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
  scope: string | null;
  createdBy: { name: string; email: string };
};

type ScopeOptionsData = {
  applianceTypes: string[];
  equipmentClasses: string[];
  locations: string[];
  assets: { id: string; testTagId: string; description: string }[];
};

function AuditorLinksSection({ canEdit }: { canEdit: boolean }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: tokens, refetch: refetchTokens } = useServerQuery({
    queryKey: ["auditorTokens"],
    queryFn: getAuditorTokens,
  });

  const { data: scopeOptions } = useServerQuery({
    queryKey: ["auditorScopeOptions"],
    queryFn: getAuditorScopeOptions,
    enabled: showCreate || editingId !== null,
  });

  const revokeMutation = useServerMutation({
    mutationFn: revokeAuditorToken,
    onSuccess: () => {
      refetchTokens();
      toast.success("Link revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: deleteAuditorToken,
    onSuccess: () => {
      refetchTokens();
      toast.success("Link deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/auditor/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  const tokenList = (tokens || []) as unknown as AuditorTokenItem[];
  const opts = scopeOptions as unknown as ScopeOptionsData | undefined;

  const onSaved = () => {
    refetchTokens();
    setShowCreate(false);
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      {tokenList.map((t) => {
        if (editingId === t.id) {
          return (
            <AuditorTokenForm
              key={t.id}
              mode="edit"
              tokenId={t.id}
              initialName={t.name}
              initialExpiry={t.expiresAt ? new Date(t.expiresAt).toISOString().split("T")[0] : ""}
              initialScope={t.scope ? (JSON.parse(t.scope) as AuditorTokenScope) : {}}
              scopeOptions={opts}
              onSaved={onSaved}
              onCancel={() => setEditingId(null)}
            />
          );
        }

        const tokenScope = t.scope ? (JSON.parse(t.scope) as AuditorTokenScope) : null;
        const scopeParts: string[] = [];
        if (tokenScope?.categories?.length) scopeParts.push(`${tokenScope.categories.length} categories`);
        if (tokenScope?.equipmentClasses?.length) scopeParts.push(`${tokenScope.equipmentClasses.length} classes`);
        if (tokenScope?.locations?.length) scopeParts.push(`${tokenScope.locations.length} locations`);
        if (tokenScope?.assetIds?.length) scopeParts.push(`${tokenScope.assetIds.length} assets`);

        return (
          <div
            key={t.id}
            className={`flex items-center justify-between rounded-lg border p-3 ${
              t.isActive ? "border-border" : "border-border opacity-50"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm text-fg-1">{t.name}</p>
                {!t.isActive && (
                  <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">Revoked</span>
                )}
                {t.expiresAt && new Date(t.expiresAt) < new Date() && t.isActive && (
                  <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded">Expired</span>
                )}
                {scopeParts.length > 0 && (
                  <span className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 px-1.5 py-0.5 rounded">
                    Scoped: {scopeParts.join(", ")}
                  </span>
                )}
                {tokenScope === null && t.isActive && (
                  <span className="text-xs text-fg-3">All assets</span>
                )}
              </div>
              <p className="text-xs text-fg-3 mt-0.5">
                Created by {t.createdBy.name || t.createdBy.email} · {new Date(t.createdAt).toLocaleDateString()}
                {t.expiresAt && ` · Expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                {t.lastAccessedAt && ` · Last accessed ${new Date(t.lastAccessedAt).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-1 ml-3">
              {t.isActive && (
                <>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(t.id)} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => copyLink(t.token)} title="Copy link">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <a href={`/auditor/${t.token}`} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" title="Open portal">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeMutation.mutate(t.id)}
                      disabled={revokeMutation.isPending}
                      title="Revoke"
                      className="text-red-500 hover:text-red-700"
                    >
                      Revoke
                    </Button>
                  )}
                </>
              )}
              {!t.isActive && canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(t.id)}
                  disabled={deleteMutation.isPending}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {tokenList.length === 0 && !showCreate && (
        <p className="text-sm text-fg-3">No auditor links created yet.</p>
      )}

      {canEdit && !showCreate && editingId === null && (
        <Button variant="line" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create Auditor Link
        </Button>
      )}

      {showCreate && (
        <AuditorTokenForm
          mode="create"
          scopeOptions={opts}
          onSaved={onSaved}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ─── Shared Create/Edit Form ─────────────────────────────────────────────────

function AuditorTokenForm({
  mode,
  tokenId,
  initialName = "",
  initialExpiry = "",
  initialScope = {},
  scopeOptions,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  tokenId?: string;
  initialName?: string;
  initialExpiry?: string;
  initialScope?: AuditorTokenScope;
  scopeOptions?: ScopeOptionsData;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [expiry, setExpiry] = useState(initialExpiry);
  const [scope, setScope] = useState<AuditorTokenScope>(initialScope);
  const [showScopeOptions, setShowScopeOptions] = useState(hasScopeFilters(initialScope));

  const toggleScopeItem = (key: keyof AuditorTokenScope, value: string) => {
    setScope((prev) => {
      const arr = prev[key] || [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  };

  const createMutation = useServerMutation({
    mutationFn: () => createAuditorToken({
      name,
      expiresAt: expiry || null,
      scope: hasScopeFilters(scope) ? scope : null,
    }),
    onSuccess: () => { toast.success("Auditor link created"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });

  const editMutation = useServerMutation({
    mutationFn: () => updateAuditorToken(tokenId!, {
      name,
      expiresAt: expiry || null,
      scope: hasScopeFilters(scope) ? scope : null,
    }),
    onSuccess: () => { toast.success("Auditor link updated"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });

  const isPending = mode === "create" ? createMutation.isPending : editMutation.isPending;
  const onSubmit = () => mode === "create" ? createMutation.mutate() : editMutation.mutate();

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-surface-hover">
      <p className="text-xs font-medium text-fg-2 uppercase tracking-wider">
        {mode === "create" ? "New Auditor Link" : "Edit Auditor Link"}
      </p>
      <div className="space-y-2">
        <Label htmlFor="auditorName">Link Name</Label>
        <Input
          id="auditorName"
          placeholder="e.g. Insurance Auditor 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="auditorExpiry">Expires (optional)</Label>
        <Input
          id="auditorExpiry"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      </div>

      {/* Scope toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowScopeOptions(!showScopeOptions)}
          className="text-sm text-teal-500 hover:text-teal-400 font-medium flex items-center gap-1"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showScopeOptions ? "rotate-90" : ""}`} />
          {showScopeOptions ? "Hide" : "Show"} visibility filters
        </button>
        <p className="text-xs text-fg-3 mt-1">
          {hasScopeFilters(scope)
            ? `Filtered: ${describeScopeFilters(scope)}`
            : "No filters — auditor sees all assets"}
        </p>
      </div>

      {showScopeOptions && scopeOptions && (
        <ScopeEditor scope={scope} onToggle={toggleScopeItem} opts={scopeOptions} />
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onSubmit} disabled={!name.trim() || isPending}>
          {isPending ? (mode === "create" ? "Creating..." : "Saving...") : (mode === "create" ? "Create" : "Save Changes")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Scope Editor (reused for create + edit) ─────────────────────────────────

function ScopeEditor({
  scope,
  onToggle,
  opts,
}: {
  scope: AuditorTokenScope;
  onToggle: (key: keyof AuditorTokenScope, value: string) => void;
  opts: ScopeOptionsData;
}) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      {opts.applianceTypes.length > 0 && (
        <ScopeCheckboxGroup
          label="Categories (Appliance Type)"
          items={opts.applianceTypes.map((v) => ({ value: v, label: CATEGORY_LABELS[v] || v }))}
          selected={scope.categories || []}
          onToggle={(v) => onToggle("categories", v)}
        />
      )}
      {opts.equipmentClasses.length > 0 && (
        <ScopeCheckboxGroup
          label="Equipment Classes"
          items={opts.equipmentClasses.map((v) => ({ value: v, label: CLASS_LABELS[v] || v }))}
          selected={scope.equipmentClasses || []}
          onToggle={(v) => onToggle("equipmentClasses", v)}
        />
      )}
      {opts.locations.length > 0 && (
        <ScopeCheckboxGroup
          label="Locations"
          items={opts.locations.map((v) => ({ value: v, label: v }))}
          selected={scope.locations || []}
          onToggle={(v) => onToggle("locations", v)}
        />
      )}
      {opts.assets.length > 0 && opts.assets.length <= 200 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-fg-2">Specific Assets</Label>
          <p className="text-xs text-fg-3">Select individual assets to include. Leave empty to include all matching assets above.</p>
          <div className="max-h-40 overflow-y-auto rounded border border-border bg-bg-surface p-2 space-y-1">
            {opts.assets.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover rounded px-1 py-0.5">
                <input
                  type="checkbox"
                  checked={(scope.assetIds || []).includes(a.id)}
                  onChange={() => onToggle("assetIds", a.id)}
                  className="h-3 w-3 rounded border-border text-teal-600"
                />
                <span className="font-mono text-fg-2">{a.testTagId}</span>
                <span className="text-fg-3 truncate">{a.description}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scope Helpers ───────────────────────────────────────────────────────────

function hasScopeFilters(scope: AuditorTokenScope): boolean {
  return !!(
    scope.categories?.length ||
    scope.equipmentClasses?.length ||
    scope.locations?.length ||
    scope.assetIds?.length
  );
}

function describeScopeFilters(scope: AuditorTokenScope): string {
  const parts: string[] = [];
  if (scope.categories?.length) parts.push(`${scope.categories.length} categories`);
  if (scope.equipmentClasses?.length) parts.push(`${scope.equipmentClasses.length} classes`);
  if (scope.locations?.length) parts.push(`${scope.locations.length} locations`);
  if (scope.assetIds?.length) parts.push(`${scope.assetIds.length} specific assets`);
  return parts.join(", ");
}

function ScopeCheckboxGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-fg-2">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = selected.includes(item.value);
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onToggle(item.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                isSelected
                  ? "border-teal-500 bg-teal-500/10 text-teal-600 dark:text-teal-400"
                  : "border-border text-fg-3 hover:border-fg-3"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
