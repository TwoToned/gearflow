"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus, Trash2, Clock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  setOrgApiKillSwitch,
} from "@/server/api-keys";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  isActive: boolean;
  actingUserId: string;
  expiresAt: string | Date | null;
  lastUsedAt: string | Date | null;
  revokedAt: string | Date | null;
  createdAt: string | Date;
}

// v1 scope presets. Scopes are `resource:action` strings; effective permission is
// the intersection of these and the acting user's live role.
const SCOPE_PRESETS = [
  {
    value: "reserve",
    label: "Reserve gear",
    description: "Read availability + reserve items on projects (project:manage_line_items).",
    scopes: ["project:manage_line_items"],
  },
  {
    value: "full",
    label: "Full access",
    description: "Every action the acting user's role allows (*).",
    scopes: ["*"],
  },
] as const;

function formatDate(date: string | Date | null) {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseScopes(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function mcpConfig(origin: string, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        "rvlt-flow": {
          url: `${origin}/api/v1/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Copy failed");
  }
}

export default function ApiKeysSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const [createOpen, setCreateOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const [name, setName] = useState("");
  const [preset, setPreset] = useState<string>("reserve");

  const { data, isLoading, refetch } = useServerQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const keys = (data as { keys: ApiKeyRow[] } | undefined)?.keys ?? [];
  const killSwitchOn = !!(data as { apiKillSwitchAt: string | null } | undefined)?.apiKillSwitchAt;

  const createMutation = useServerMutation({
    mutationFn: createApiKey,
    onSuccess: (result) => {
      setNewToken((result as { token: string }).token);
      refetch();
      toast.success("API key created");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = useServerMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      refetch();
      toast.success("API key revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const killSwitchMutation = useServerMutation({
    mutationFn: setOrgApiKillSwitch,
    onSuccess: () => {
      refetch();
      toast.success("Updated org API access");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleCreate() {
    if (!name.trim()) {
      toast.error("Please enter a key name");
      return;
    }
    const scopes = SCOPE_PRESETS.find((p) => p.value === preset)?.scopes ?? [];
    createMutation.mutate({ name: name.trim(), scopes: [...scopes] });
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setNewToken(null);
    setName("");
    setPreset("reserve");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <FadeIn>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="t-title text-ink">API keys</h2>
            <p className="text-sm text-fg-3 mt-1 max-w-prose">
              Connect AI agents and scripts to RVLT Flow. Each key acts on behalf of a user
              and is bound by that user&apos;s permissions. Point an MCP client at{" "}
              <code className="text-xs">/api/v1/mcp</code> or call the REST API with{" "}
              <code className="text-xs">Authorization: Bearer</code>. Full agent docs:{" "}
              <a href="/llms.txt" target="_blank" rel="noreferrer" className="underline">
                /llms.txt
              </a>
              .
            </p>
          </div>
          {canEdit && (
            <Dialog open={createOpen} onOpenChange={(o: boolean) => (o ? setCreateOpen(true) : handleCloseCreate())}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> Create key
                </Button>
              </DialogTrigger>
              <DialogContent>
                {newToken ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>Key created — copy it now</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-fg-3">
                      This secret is shown once and can&apos;t be retrieved again.
                    </p>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label>Secret</Label>
                        <div className="flex gap-2">
                          <Input readOnly value={newToken} className="font-mono text-xs" />
                          <Button variant="line" size="icon" onClick={() => copy(newToken, "Secret")}>
                            <Copy className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>MCP client config</Label>
                        <pre className="rounded-md border bg-bg-inset/50 p-3 text-xs overflow-x-auto">
                          {mcpConfig(origin, newToken)}
                        </pre>
                        <Button variant="line" size="sm" onClick={() => copy(mcpConfig(origin, newToken), "MCP config")}>
                          <Copy className="size-4" /> Copy MCP config
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label>Test it</Label>
                        <pre className="rounded-md border bg-bg-inset/50 p-3 text-xs overflow-x-auto">
                          {`curl -H "Authorization: Bearer ${newToken}" ${origin}/api/v1/whoami`}
                        </pre>
                      </div>
                    </div>
                    <DialogClose asChild>
                      <Button onClick={handleCloseCreate}>Done</Button>
                    </DialogClose>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>Create API key</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <Label htmlFor="key-name">Name</Label>
                        <Input
                          id="key-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Booking agent (Claude)"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Scope</Label>
                        {SCOPE_PRESETS.map((p) => (
                          <label
                            key={p.value}
                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                              preset === p.value ? "border-primary bg-primary/5" : "hover:bg-bg-inset/50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="scope-preset"
                              value={p.value}
                              checked={preset === p.value}
                              onChange={() => setPreset(p.value)}
                              className="mt-0.5"
                            />
                            <div>
                              <div className="text-sm font-medium">{p.label}</div>
                              <div className="text-xs text-fg-3">{p.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    <Button onClick={handleCreate} disabled={createMutation.isPending}>
                      {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                      Create key
                    </Button>
                  </>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className={`size-5 mt-0.5 ${killSwitchOn ? "text-red" : "text-fg-3"}`} />
              <div>
                <div className="text-sm font-medium">Org-wide kill switch</div>
                <div className="text-xs text-fg-3">
                  When on, every API key for this organisation is rejected instantly.
                </div>
              </div>
            </div>
            <Switch
              checked={killSwitchOn}
              disabled={killSwitchMutation.isPending}
              onCheckedChange={(v: boolean) => killSwitchMutation.mutate(v)}
              aria-label="Org-wide API kill switch"
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-fg-3" />
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <KeyRound className="size-8 mx-auto text-fg-3" />
            <p className="text-sm text-fg-3 mt-2">No API keys yet.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {keys.map((k) => {
              const revoked = !k.isActive || !!k.revokedAt;
              return (
                <div key={k.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{k.name}</span>
                      <code className="text-xs text-fg-3">{k.prefix}…</code>
                      {revoked && <span className="text-xs text-red">revoked</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-fg-3">
                      <span>{parseScopes(k.scopes).join(", ") || "no scopes"}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> Last used {formatDate(k.lastUsedAt)}
                      </span>
                    </div>
                  </div>
                  {canEdit && !revoked && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                      aria-label={`Revoke ${k.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Revoke API key "${revokeTarget?.name ?? ""}"?`}
        description="Any agent or script using this key stops working immediately. This can't be undone."
        confirmLabel="Revoke key"
        onConfirm={() => {
          if (revokeTarget) {
            revokeMutation.mutate(revokeTarget.id);
            setRevokeTarget(null);
          }
        }}
        pending={revokeMutation.isPending}
      />
    </FadeIn>
  );
}
