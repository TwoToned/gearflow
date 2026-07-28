"use client";
// use-client: interactive settings page (dialogs, forms, live token reveal) (R-8.1.1)

import { useMemo, useState } from "react";
import { Plus, KeyRound, Loader2, RotateCw, Ban, FileClock } from "lucide-react";
import { toast } from "sonner";

import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { listApiKeys, revokeApiKey, rotateApiKey } from "@/server/api-keys";
import { formatDate } from "@/lib/formatters";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import { SettingsCard, FormSection } from "@/components/layout/page-layouts";
import { CreateApiKeyDialog } from "@/components/settings/api-key-create-dialog";
import { TokenRevealDialog } from "@/components/settings/api-key-token-reveal-dialog";
import { RequestLogDialog } from "@/components/settings/api-key-request-log-dialog";
import { ConnectAgentCard } from "@/components/settings/api-key-connect-agent";
import { KillSwitchCard } from "@/components/settings/api-key-kill-switch";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  isActive: boolean;
  actingUserId: string;
  noFinancials: boolean;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  lastRotatedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
}

function keyStatus(key: ApiKeyRow): { label: string; status: "ok" | "warn" | "overbooked" | "neutral" } {
  if (key.revokedAt || !key.isActive) return { label: "Revoked", status: "neutral" };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", status: "warn" };
  }
  return { label: "Active", status: "ok" };
}

export default function ApiKeysSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canManage = useCanDo("orgSettings", "update");

  const [createOpen, setCreateOpen] = useState(false);
  const [revealToken, setRevealToken] = useState<{ token: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading, refetch } = useServerQuery({
    queryKey: ["api-keys", orgId],
    queryFn: () => listApiKeys(),
    enabled: !!orgId,
  });

  const keys = useMemo(() => (data?.keys ?? []) as ApiKeyRow[], [data]);
  const apiKillSwitchAt = data?.apiKillSwitchAt ?? null;

  const revokeMutation = useServerMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      toast.success("API key revoked");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const cols: ColumnDef<ApiKeyRow>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      cell: (key) => (
        <div>
          <span className="font-medium">{key.name}</span>
          <p className="mt-0.5 font-mono text-xs text-fg-3">{key.prefix}…</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (key) => {
        const s = keyStatus(key);
        return <Badge status={s.status}>{s.label}</Badge>;
      },
    },
    {
      id: "scopes",
      header: "Scopes",
      mobile: "meta",
      cell: (key) => {
        const scopes = JSON.parse(key.scopes || "[]") as string[];
        if (scopes.length === 0) return <span className="text-fg-3">None</span>;
        if (scopes.includes("*")) return <Badge status="primary">All scopes</Badge>;
        return (
          <span className="text-xs text-fg-3">
            {scopes.length} scope{scopes.length !== 1 ? "s" : ""}
            {key.noFinancials ? " · no financials" : ""}
          </span>
        );
      },
    },
    {
      id: "lastUsed",
      header: "Last used",
      mobile: "meta",
      cell: (key) => formatDate(key.lastUsedAt),
    },
    {
      id: "expires",
      header: "Expires",
      mobile: "meta",
      cell: (key) => (key.expiresAt ? formatDate(key.expiresAt) : "Never"),
    },
  ];
  if (canManage) {
    cols.push({
      id: "actions",
      header: "Actions",
      mobile: "actions",
      cell: (key) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`View request log for ${key.name}`}
            onClick={() => setLogTarget({ id: key.id, name: key.name })}
          >
            <FileClock className="h-3.5 w-3.5" />
          </Button>
          {!key.revokedAt && (
            <>
              <RotateKeyButton
                keyId={key.id}
                keyName={key.name}
                onRotated={(token) => {
                  setRevealToken({ token, name: key.name });
                  refetch();
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                aria-label={`Revoke ${key.name}`}
                onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      ),
    });
  }

  if (!canManage && !isLoading) {
    return (
      <FadeIn>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="t-title text-ink">Access denied</h2>
          <p className="mt-2 t-body text-muted">
            You don&apos;t have permission to manage API keys for this organization.
          </p>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div className="space-y-6">
        <ConnectAgentCard
          orgId={orgId}
          disabled={!canManage}
          onCreated={(token, name) => {
            setRevealToken({ token, name });
            refetch();
          }}
        />

        <SettingsCard>
          <FormSection
            title="API keys"
            description="Keys mint a short-lived agent token, scoped bearer credentials for the API and MCP server (FEATUREDOCS/56). The raw secret is shown once, at creation."
          >
            <div className="sm:col-span-2 space-y-4">
              <div className="flex items-center justify-end">
                {canManage && (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create key
                  </Button>
                )}
              </div>

              <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-fg-3">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : keys.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-fg-3">
                    <KeyRound className="mb-2 h-8 w-8 opacity-50" />
                    <p className="font-medium">No API keys yet</p>
                    <p className="mt-1 text-xs">
                      Create one, or use &ldquo;Connect an AI Agent&rdquo; above for a ready-to-paste MCP config.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Scopes</TableHead>
                            <TableHead className="hidden sm:table-cell">Last used</TableHead>
                            <TableHead className="hidden md:table-cell">Expires</TableHead>
                            {canManage && <TableHead className="w-[120px]" />}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {keys.map((key) => {
                            const nameCol = cols.find((c) => c.id === "name")!;
                            const statusCol = cols.find((c) => c.id === "status")!;
                            const scopesCol = cols.find((c) => c.id === "scopes")!;
                            const lastUsedCol = cols.find((c) => c.id === "lastUsed")!;
                            const expiresCol = cols.find((c) => c.id === "expires")!;
                            const actionsCol = cols.find((c) => c.id === "actions");
                            return (
                              <TableRow key={key.id}>
                                <TableCell>{nameCol.cell?.(key)}</TableCell>
                                <TableCell>{statusCol.cell?.(key)}</TableCell>
                                <TableCell>{scopesCol.cell?.(key)}</TableCell>
                                <TableCell className="hidden sm:table-cell">{lastUsedCol.cell?.(key)}</TableCell>
                                <TableCell className="hidden md:table-cell">{expiresCol.cell?.(key)}</TableCell>
                                {actionsCol && <TableCell>{actionsCol.cell?.(key)}</TableCell>}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <MobileCardList
                      className="md:hidden"
                      data={keys}
                      columns={cols}
                      getRowId={(k) => k.id}
                    />
                  </>
                )}
              </div>
            </div>
          </FormSection>
        </SettingsCard>

        {canManage && <KillSwitchCard orgId={orgId} apiKillSwitchAt={apiKillSwitchAt} onToggled={refetch} />}
      </div>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(token, name) => {
          setCreateOpen(false);
          setRevealToken({ token, name });
          refetch();
        }}
      />

      <TokenRevealDialog
        open={!!revealToken}
        onOpenChange={(open) => !open && setRevealToken(null)}
        token={revealToken?.token ?? ""}
        keyName={revealToken?.name ?? ""}
      />

      <RequestLogDialog
        open={!!logTarget}
        onOpenChange={(open) => !open && setLogTarget(null)}
        apiKeyId={logTarget?.id ?? null}
        keyName={logTarget?.name ?? ""}
      />

      <DeleteDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Revoke "${revokeTarget?.name ?? ""}"?`}
        description="This key stops authenticating immediately — every in-flight request using it will start failing. This cannot be undone; mint a new key to replace it."
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

function RotateKeyButton({
  keyId,
  keyName,
  onRotated,
}: {
  keyId: string;
  keyName: string;
  onRotated: (token: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rotateMutation = useServerMutation({
    mutationFn: () => rotateApiKey(keyId, 60),
    onSuccess: (res) => {
      toast.success("API key rotated — the previous secret keeps working for 60 minutes");
      onRotated(res.token);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Rotate ${keyName}`}
        onClick={() => setConfirmOpen(true)}
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
      <DeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Rotate "${keyName}"?`}
        description="Mints a new secret and shows it once. The current secret keeps working for a 60-minute grace window so an in-flight client can roll over."
        confirmLabel="Rotate key"
        onConfirm={() => {
          rotateMutation.mutate();
          setConfirmOpen(false);
        }}
        pending={rotateMutation.isPending}
      />
    </>
  );
}
