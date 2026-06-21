"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshSSOProviders } from "@/hooks/use-sso-providers";
import { refreshSSOSettings } from "@/hooks/use-sso-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteSSOProvider, updateSSOProviderMeta, patchProviderOidcConfig } from "@/server/sso";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Copy, Check, Loader2, Search, MoreVertical, Pencil } from "lucide-react";
import { PROVIDER_ICONS, getIconComponent } from "@/lib/sso-icons";

function generateProviderId(): string {
  return `sso-${crypto.randomUUID().slice(0, 8)}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Provider {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  type: "saml" | "oidc";
  createdAt: string | Date;
  oidcConfig: Record<string, unknown> | null;
  samlConfig: Record<string, unknown> | null;
}

interface ProviderMeta {
  displayName?: string;
  icon?: string;
}

interface Props {
  providers: Provider[];
  loading: boolean;
  canUpdate: boolean;
  providerMeta?: Record<string, ProviderMeta>;
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export function SSOProviderSection({ providers, loading, canUpdate, providerMeta = {} }: Props) {
  const [addOpen, setAddOpen] = useState(false);

  if (loading) {
    return <div className="h-20 animate-pulse rounded bg-bg-inset" />;
  }

  return (
    <div className="space-y-4">
      {providers.length === 0 ? (
        <p className="text-sm text-fg-3">
          No SSO providers configured. Add one to enable SSO for your organization.
        </p>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              meta={providerMeta[provider.providerId]}
              canUpdate={canUpdate}
            />
          ))}
        </div>
      )}

      {canUpdate && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="line" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add SSO Provider</DialogTitle>
            </DialogHeader>
            <AddProviderForm onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      {/* SP Metadata — per-provider URLs are shown in each provider's edit dialog */}
    </div>
  );
}

// ─── Provider Row ─────────────────────────────────────────────────────────────

function ProviderRow({ provider, meta, canUpdate }: { provider: Provider; meta?: ProviderMeta; canUpdate: boolean }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteSSOProvider(provider.providerId),
    onSuccess: () => {
      refreshSSOProviders(orgId);
      toast.success("Provider deleted");
      setConfirmDelete(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const IconComp = getIconComponent(meta?.icon);
  const displayName = meta?.displayName || provider.providerId;

  return (
    <>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-inset shrink-0">
            <IconComp className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            <p className="text-xs text-fg-3">
              {provider.type.toUpperCase()} &middot; {provider.domain}
            </p>
          </div>
        </div>
        {canUpdate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Provider</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
          </DialogHeader>
          <EditProviderForm
            provider={provider}
            meta={meta}
            onSuccess={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Provider</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-fg-3">
            Are you sure you want to delete <strong>{displayName}</strong>? Users will no longer be able to sign in via this provider.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="line" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Helper: call Better Auth SSO update endpoint ───────────────────────────

async function updateBetterAuthProvider(
  providerId: string,
  data: {
    issuer?: string;
    domain?: string;
    oidcConfig?: Record<string, unknown>;
    samlConfig?: { entryPoint?: string; cert?: string };
  },
) {
  const res = await fetch("/api/auth/sso/update-provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ providerId, ...data }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `Failed to update provider (${res.status})`);
  }
  return res.json();
}

// ─── Edit Provider Form ──────────────────────────────────────────────────────

function EditProviderForm({
  provider,
  meta,
  onSuccess,
}: {
  provider: Provider;
  meta?: ProviderMeta;
  onSuccess: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [submitting, setSubmitting] = useState(false);

  // Display meta
  const [displayName, setDisplayName] = useState(meta?.displayName || provider.providerId);
  const [icon, setIcon] = useState(meta?.icon || "key");

  // Editable provider fields
  const [issuer, setIssuer] = useState(provider.issuer);
  const [domain, setDomain] = useState(provider.domain);

  // OIDC fields
  const [oidcClientId, setOidcClientId] = useState(
    (provider.oidcConfig?.clientId as string) || "",
  );
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcEmailClaim, setOidcEmailClaim] = useState(
    ((provider.oidcConfig?.mapping as Record<string, string> | undefined)?.email) || "",
  );

  // SAML fields
  const [samlEntryPoint, setSamlEntryPoint] = useState(
    (provider.samlConfig?.entryPoint as string) || "",
  );
  const [samlCert, setSamlCert] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 1. Update provider config via Better Auth API (issuer, domain, secrets)
      const providerUpdate: Parameters<typeof updateBetterAuthProvider>[1] = {};

      if (issuer !== provider.issuer) providerUpdate.issuer = issuer;
      if (domain !== provider.domain) providerUpdate.domain = domain;

      if (provider.type === "oidc") {
        const oidcUpdate: Record<string, unknown> = {};
        if (oidcClientId !== (provider.oidcConfig?.clientId as string || "")) {
          oidcUpdate.clientId = oidcClientId;
        }
        if (oidcClientSecret) {
          oidcUpdate.clientSecret = oidcClientSecret;
        }
        // Email claim mapping (e.g. "preferred_username" for Microsoft Entra)
        const currentMapping = (provider.oidcConfig?.mapping as Record<string, string> | undefined)?.email || "";
        if (oidcEmailClaim !== currentMapping) {
          oidcUpdate.mapping = oidcEmailClaim
            ? { email: oidcEmailClaim }
            : {}; // clear mapping if empty (use default "email")
        }
        if (Object.keys(oidcUpdate).length > 0) providerUpdate.oidcConfig = oidcUpdate;
      }

      if (provider.type === "saml") {
        const samlUpdate: { entryPoint?: string; cert?: string } = {};
        if (samlEntryPoint !== (provider.samlConfig?.entryPoint as string || "")) {
          samlUpdate.entryPoint = samlEntryPoint;
        }
        if (samlCert) {
          samlUpdate.cert = samlCert;
        }
        if (Object.keys(samlUpdate).length > 0) providerUpdate.samlConfig = samlUpdate;
      }

      if (Object.keys(providerUpdate).length > 0) {
        await updateBetterAuthProvider(provider.providerId, providerUpdate);
      }

      // 2. Always ensure ID token mode is on (userinfo endpoints are unreliable across IdPs)
      if (provider.type === "oidc") {
        await patchProviderOidcConfig(provider.providerId, { useIdTokenOnly: true });
      }

      // 3. Update display meta (name + icon) via server action
      await updateSSOProviderMeta(provider.providerId, { displayName, icon });

      refreshSSOProviders(orgId);
      refreshSSOSettings(orgId);
      toast.success("Provider updated");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update provider");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 min-w-0 overflow-hidden">
      {/* Display meta */}
      <div className="space-y-1">
        <Label htmlFor="edit-display-name">Display Name</Label>
        <Input
          id="edit-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <Label>Icon</Label>
        <IconPickerDropdown value={icon} onChange={setIcon} />
      </div>

      {/* Provider config */}
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-fg-3">
            {provider.type.toUpperCase()} Configuration
          </p>
          <span className="text-xs font-mono text-fg-3">{provider.providerId}</span>
        </div>

        <div className="space-y-1">
          <Label htmlFor="edit-issuer">Issuer URL</Label>
          <Input
            id="edit-issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="edit-domain">Email Domain</Label>
          <Input
            id="edit-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </div>

        {provider.type === "oidc" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="edit-client-id">Client ID</Label>
              <Input
                id="edit-client-id"
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-client-secret">Client Secret</Label>
              <Input
                id="edit-client-secret"
                type="password"
                placeholder="Leave blank to keep current secret"
                value={oidcClientSecret}
                onChange={(e) => setOidcClientSecret(e.target.value)}
              />
              <p className="text-xs text-fg-3">Only fill this in if you need to rotate the secret.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-email-claim">Email Claim</Label>
              <Input
                id="edit-email-claim"
                placeholder="email (default)"
                value={oidcEmailClaim}
                onChange={(e) => setOidcEmailClaim(e.target.value)}
              />
              <p className="text-xs text-fg-3">
                Override which OIDC claim is used for the user&apos;s email. For Microsoft Entra, use{" "}
                <code className="text-xs bg-bg-inset px-1 rounded">preferred_username</code>.
              </p>
            </div>
          </>
        )}

        {provider.type === "saml" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="edit-entry-point">SSO URL</Label>
              <Input
                id="edit-entry-point"
                value={samlEntryPoint}
                onChange={(e) => setSamlEntryPoint(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-cert">Certificate (X.509 PEM)</Label>
              <Textarea
                id="edit-cert"
                rows={3}
                placeholder="Leave blank to keep current certificate"
                value={samlCert}
                onChange={(e) => setSamlCert(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-fg-3">Only fill this in if the certificate has been rotated.</p>
            </div>
          </>
        )}
      </div>

      {/* Callback URLs */}
      <div className="rounded-md border border-dashed p-3 space-y-1.5 min-w-0 overflow-hidden">
        <p className="text-xs font-medium text-fg-3">Callback URLs</p>
        {provider.type === "saml" ? (
          <>
            <CopyField label="ACS URL" value={`${baseUrl}/api/auth/sso/saml2/callback/${provider.providerId}`} />
            <CopyField label="Metadata" value={`${baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${provider.providerId}`} />
          </>
        ) : (
          <CopyField label="Redirect URI" value={`${baseUrl}/api/auth/sso/callback/${provider.providerId}`} />
        )}
      </div>

      <Button type="submit" className="w-full" disabled={submitting || !displayName.trim()}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save Changes
      </Button>
    </form>
  );
}

// ─── Copy Field ───────────────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-fg-3 shrink-0">{label}:</span>
      <code className="text-xs bg-bg-inset px-1.5 py-0.5 rounded min-w-0 truncate">{value}</code>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 text-fg-3 hover:text-fg"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ─── Icon Picker Dropdown ─────────────────────────────────────────────────────

function IconPickerDropdown({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = PROVIDER_ICONS.find((i) => i.id === value);
  const SelectedIcon = selected?.Icon ?? getIconComponent();

  const filtered = useMemo(() => {
    if (!search.trim()) return PROVIDER_ICONS;
    const q = search.toLowerCase();
    return PROVIDER_ICONS.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.id.includes(q) ||
        i.keywords.some((k) => k.includes(q))
    );
  }, [search]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={cn(
          "flex items-center gap-2 w-full rounded-md border px-3 py-2 text-sm",
          "hover:bg-accent transition-colors",
          open && "ring-2 ring-ring"
        )}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-bg-inset shrink-0">
          <SelectedIcon className="h-4 w-4" />
        </div>
        <span className="flex-1 text-left">{selected?.label || "Select icon..."}</span>
        <Search className="h-3.5 w-3.5 text-fg-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="p-2 border-b">
            <Input
              ref={inputRef}
              placeholder="Search icons..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-fg-3 text-center py-3">No icons found</p>
            ) : (
              filtered.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded px-2 py-1.5 text-sm transition-colors",
                    value === id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent text-fg"
                  )}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-bg-inset shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span>{label}</span>
                  {value === id && <Check className="h-3.5 w-3.5 ml-auto" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Provider Form ────────────────────────────────────────────────────────

function AddProviderForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: activeOrg } = useActiveOrganization();
  const [tab, setTab] = useState<"oidc" | "saml">("oidc");
  const [submitting, setSubmitting] = useState(false);

  // Shared fields
  const [displayName, setDisplayName] = useState("");
  const [icon, setIcon] = useState("microsoft");

  // Auto-generated random provider ID
  const [providerId] = useState(() => generateProviderId());

  // OIDC fields
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcDomain, setOidcDomain] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcEmailClaim, setOidcEmailClaim] = useState("");

  // SAML fields
  const [samlIssuer, setSamlIssuer] = useState("");
  const [samlDomain, setSamlDomain] = useState("");
  const [samlEntryPoint, setSamlEntryPoint] = useState("");
  const [samlCert, setSamlCert] = useState("");

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const callbackUrl = `${baseUrl}/api/auth/sso/callback/${providerId}`;

  const saveProviderMeta = async (pid: string) => {
    try {
      await updateSSOProviderMeta(pid, { displayName, icon });
    } catch {
      // non-critical — provider is still registered
    }
  };

  const handleOidcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await authClient.sso.register({
        providerId,
        issuer: oidcIssuer,
        domain: oidcDomain,
        organizationId: activeOrg?.id,
        oidcConfig: {
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
          ...(oidcEmailClaim ? { mapping: { id: "sub", email: oidcEmailClaim, name: "name" } } : {}),
        },
      });
      if (result.error) {
        toast.error(result.error.message || "Failed to register provider");
        return;
      }
      await saveProviderMeta(providerId);
      // Force ID token mode — userinfo endpoints are unreliable across IdPs
      await patchProviderOidcConfig(providerId, { useIdTokenOnly: true });
      refreshSSOProviders(activeOrg?.id);
      toast.success("OIDC provider added");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register provider");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSamlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await authClient.sso.register({
        providerId,
        issuer: samlIssuer,
        domain: samlDomain,
        organizationId: activeOrg?.id,
        samlConfig: {
          entryPoint: samlEntryPoint,
          cert: samlCert,
          callbackUrl: `${baseUrl}/api/auth/sso/saml2/callback/${providerId}`,
          spMetadata: {},
        },
      });
      if (result.error) {
        toast.error(result.error.message || "Failed to register provider");
        return;
      }
      await saveProviderMeta(providerId);
      refreshSSOProviders(activeOrg?.id);
      toast.success("SAML provider added");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register provider");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0 overflow-hidden">
      {/* Shared: Display Name + Icon */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="provider-name">Display Name</Label>
          <Input
            id="provider-name"
            placeholder="e.g. Microsoft Entra, Okta, Google Workspace"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Icon</Label>
          <IconPickerDropdown value={icon} onChange={setIcon} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "oidc" | "saml")}>
        <TabsList className="w-full">
          <TabsTrigger value="oidc" className="flex-1">OIDC</TabsTrigger>
          <TabsTrigger value="saml" className="flex-1">SAML</TabsTrigger>
        </TabsList>

        <TabsContent value="oidc">
          <form onSubmit={handleOidcSubmit} className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label htmlFor="oidc-issuer">Issuer URL</Label>
              <Input id="oidc-issuer" placeholder="https://login.microsoftonline.com/{tenant}/v2.0" value={oidcIssuer} onChange={(e) => setOidcIssuer(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oidc-domain">Email Domain</Label>
              <Input id="oidc-domain" placeholder="acmecorp.com" value={oidcDomain} onChange={(e) => setOidcDomain(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oidc-client-id">Client ID</Label>
              <Input id="oidc-client-id" value={oidcClientId} onChange={(e) => setOidcClientId(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oidc-secret">Client Secret</Label>
              <Input id="oidc-secret" type="password" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oidc-email-claim">Email Claim (optional)</Label>
              <Input id="oidc-email-claim" placeholder="email (default)" value={oidcEmailClaim} onChange={(e) => setOidcEmailClaim(e.target.value)} />
              <p className="text-xs text-fg-3">
                Override which OIDC claim is used for the user&apos;s email. For Microsoft Entra, use{" "}
                <code className="text-xs bg-bg-inset px-1 rounded">preferred_username</code> or{" "}
                <code className="text-xs bg-bg-inset px-1 rounded">upn</code>.
              </p>
            </div>

            {/* Callback URL display */}
            <div className="rounded-md border border-dashed p-3 space-y-1.5 min-w-0 overflow-hidden">
              <p className="text-xs font-medium text-fg-3">Add this Redirect URI to your identity provider</p>
              <CopyField label="Redirect URI" value={callbackUrl} />
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !displayName.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add OIDC Provider
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="saml">
          <form onSubmit={handleSamlSubmit} className="space-y-3 mt-3">
            <div className="space-y-1">
              <Label htmlFor="saml-issuer">IdP Entity ID / Issuer</Label>
              <Input id="saml-issuer" placeholder="http://www.okta.com/exk..." value={samlIssuer} onChange={(e) => setSamlIssuer(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="saml-domain">Email Domain</Label>
              <Input id="saml-domain" placeholder="acmecorp.com" value={samlDomain} onChange={(e) => setSamlDomain(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="saml-entry">SSO URL</Label>
              <Input id="saml-entry" placeholder="https://acme.okta.com/app/.../sso/saml" value={samlEntryPoint} onChange={(e) => setSamlEntryPoint(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="saml-cert">Certificate (X.509 PEM)</Label>
              <Textarea id="saml-cert" rows={4} placeholder="-----BEGIN CERTIFICATE-----" value={samlCert} onChange={(e) => setSamlCert(e.target.value)} required className="font-mono text-xs" />
            </div>

            {/* Callback URLs display */}
            <div className="rounded-md border border-dashed p-3 space-y-1.5 min-w-0 overflow-hidden">
              <p className="text-xs font-medium text-fg-3">Add these URLs to your identity provider</p>
              <CopyField label="ACS URL" value={`${baseUrl}/api/auth/sso/saml2/callback/${providerId}`} />
              <CopyField label="Metadata" value={`${baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`} />
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !displayName.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add SAML Provider
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
