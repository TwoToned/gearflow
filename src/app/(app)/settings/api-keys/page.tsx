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
  /** Phase 7 (#1003) — "oauth" for a claude.ai/desktop-connector grant, "manual"
   *  for a hand-minted key. Both are the SAME `apiKeys` row shape, listed and
   *  revoked identically — this only changes what the row's badge/label shows. */
  origin: "manual" | "oauth";
  oauthClientName: string | null;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  lastRotatedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
}

interface RevealTarget {
  token: string;
  name: string;
}
interface IdNameTarget {
  id: string;
  name: string;
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
  const [revealToken, setRevealToken] = useState<RevealTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<IdNameTarget | null>(null);
  const [logTarget, setLogTarget] = useState<IdNameTarget | null>(null);

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

  const cols = buildApiKeyColumns({
    canManage,
    onViewLog: (t) => setLogTarget(t),
    onRevoke: (t) => setRevokeTarget(t),
    onRotated: (name, token) => {
      setRevealToken({ token, name });
      refetch();
    },
  });

  if (!canManage && !isLoading) return <AccessDenied />;

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

        <ApiKeyListCard
          keys={keys}
          cols={cols}
          isLoading={isLoading}
          canManage={canManage}
          onCreateClick={() => setCreateOpen(true)}
        />

        {canManage && <KillSwitchCard orgId={orgId} apiKillSwitchAt={apiKillSwitchAt} onToggled={refetch} />}
      </div>

      <ApiKeyDialogs
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
        revealToken={revealToken}
        onRevealClose={() => setRevealToken(null)}
        onCreated={(token, name) => {
          setCreateOpen(false);
          setRevealToken({ token, name });
          refetch();
        }}
        logTarget={logTarget}
        onLogClose={() => setLogTarget(null)}
        revokeTarget={revokeTarget}
        onRevokeClose={() => setRevokeTarget(null)}
        onRevoke={revokeMutation.mutate}
        revokePending={revokeMutation.isPending}
      />
    </FadeIn>
  );
}

/** Every dialog the page can open, in one place — split out so their `??`
 *  fallback props don't add to ApiKeysSettingsPage's own complexity (R-3.6). */
function ApiKeyDialogs({
  createOpen,
  onCreateOpenChange,
  onCreated,
  revealToken,
  onRevealClose,
  logTarget,
  onLogClose,
  revokeTarget,
  onRevokeClose,
  onRevoke,
  revokePending,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onCreated: (token: string, name: string) => void;
  revealToken: RevealTarget | null;
  onRevealClose: () => void;
  logTarget: IdNameTarget | null;
  onLogClose: () => void;
  revokeTarget: IdNameTarget | null;
  onRevokeClose: () => void;
  onRevoke: (id: string) => void;
  revokePending: boolean;
}) {
  return (
    <>
      <CreateApiKeyDialog open={createOpen} onOpenChange={onCreateOpenChange} onCreated={onCreated} />

      <TokenRevealDialog
        open={!!revealToken}
        onOpenChange={(open) => !open && onRevealClose()}
        token={revealToken?.token ?? ""}
        keyName={revealToken?.name ?? ""}
      />

      <RequestLogDialog
        open={!!logTarget}
        onOpenChange={(open) => !open && onLogClose()}
        apiKeyId={logTarget?.id ?? null}
        keyName={logTarget?.name ?? ""}
      />

      <RevokeKeyDialog target={revokeTarget} onClose={onRevokeClose} onRevoked={onRevoke} pending={revokePending} />
    </>
  );
}

function AccessDenied() {
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

function RevokeKeyDialog({
  target,
  onClose,
  onRevoked,
  pending,
}: {
  target: IdNameTarget | null;
  onClose: () => void;
  onRevoked: (id: string) => void;
  pending: boolean;
}) {
  return (
    <DeleteDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={`Revoke "${target?.name ?? ""}"?`}
      description="This key stops authenticating immediately — every in-flight request using it will start failing. This cannot be undone; mint a new key to replace it."
      confirmLabel="Revoke key"
      onConfirm={() => {
        if (!target) return;
        onRevoked(target.id);
        onClose();
      }}
      pending={pending}
    />
  );
}

/** Builds the key-list table/card columns — split out of the page component
 *  so the `canManage` actions-column branch doesn't add to its complexity
 *  (R-3.6). Cell renderers are independent closures, not evaluated here. */
function buildApiKeyColumns({
  canManage,
  onViewLog,
  onRevoke,
  onRotated,
}: {
  canManage: boolean;
  onViewLog: (t: IdNameTarget) => void;
  onRevoke: (t: IdNameTarget) => void;
  onRotated: (name: string, token: string) => void;
}): ColumnDef<ApiKeyRow>[] {
  const cols: ColumnDef<ApiKeyRow>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      cell: (key) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{key.name}</span>
            {key.origin === "oauth" && <Badge status="neutral">OAuth</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-xs text-fg-3">{key.prefix}…</p>
          {key.oauthClientName && <p className="mt-0.5 text-xs text-fg-3">Connected app: {key.oauthClientName}</p>}
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
      cell: (key) => <ScopesCell keyRow={key} />,
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
        <KeyRowActions key={key.id} keyRow={key} onViewLog={onViewLog} onRevoke={onRevoke} onRotated={onRotated} />
      ),
    });
  }
  return cols;
}

function ScopesCell({ keyRow }: { keyRow: ApiKeyRow }) {
  const scopes = JSON.parse(keyRow.scopes || "[]") as string[];
  if (scopes.length === 0) return <span className="text-fg-3">None</span>;
  if (scopes.includes("*")) return <Badge status="primary">All scopes</Badge>;
  return (
    <span className="text-xs text-fg-3">
      {scopes.length} scope{scopes.length !== 1 ? "s" : ""}
      {keyRow.noFinancials ? " · no financials" : ""}
    </span>
  );
}

function KeyRowActions({
  keyRow,
  onViewLog,
  onRevoke,
  onRotated,
}: {
  keyRow: ApiKeyRow;
  onViewLog: (t: IdNameTarget) => void;
  onRevoke: (t: IdNameTarget) => void;
  onRotated: (name: string, token: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`View request log for ${keyRow.name}`}
        onClick={() => onViewLog({ id: keyRow.id, name: keyRow.name })}
      >
        <FileClock className="h-3.5 w-3.5" />
      </Button>
      {!keyRow.revokedAt && (
        <>
          {/* OAuth grants rotate automatically via the client's refresh_token
           *  flow — manual rotation here would mint a NEW access token the
           *  client never asked for and doesn't know to use (#1003). */}
          {keyRow.origin === "manual" && (
            <RotateKeyButton
              keyId={keyRow.id}
              keyName={keyRow.name}
              onRotated={(token) => onRotated(keyRow.name, token)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            aria-label={`Revoke ${keyRow.name}`}
            onClick={() => onRevoke({ id: keyRow.id, name: keyRow.name })}
          >
            <Ban className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

/** The "API keys" settings card — key-list table/mobile-list plus the
 *  loading/empty states. Split out of the page component (R-3.6). */
function ApiKeyListCard({
  keys,
  cols,
  isLoading,
  canManage,
  onCreateClick,
}: {
  keys: ApiKeyRow[];
  cols: ColumnDef<ApiKeyRow>[];
  isLoading: boolean;
  canManage: boolean;
  onCreateClick: () => void;
}) {
  return (
    <SettingsCard>
      <FormSection
        title="API keys"
        description="Keys mint a short-lived agent token, scoped bearer credentials for the API and MCP server (FEATUREDOCS/56). The raw secret is shown once, at creation."
      >
        <div className="sm:col-span-2 space-y-4">
          <div className="flex items-center justify-end">
            {canManage && (
              <Button size="sm" onClick={onCreateClick}>
                <Plus className="mr-2 h-4 w-4" />
                Create key
              </Button>
            )}
          </div>

          <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
            <ApiKeyListBody keys={keys} cols={cols} isLoading={isLoading} canManage={canManage} />
          </div>
        </div>
      </FormSection>
    </SettingsCard>
  );
}

function ApiKeyListBody({
  keys,
  cols,
  isLoading,
  canManage,
}: {
  keys: ApiKeyRow[];
  cols: ColumnDef<ApiKeyRow>[];
  isLoading: boolean;
  canManage: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }
  if (keys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-fg-3">
        <KeyRound className="mb-2 h-8 w-8 opacity-50" />
        <p className="font-medium">No API keys yet</p>
        <p className="mt-1 text-xs">
          Create one, or use &ldquo;Connect an AI Agent&rdquo; above for a ready-to-paste MCP config.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="hidden md:block">
        <ApiKeyTable keys={keys} cols={cols} canManage={canManage} />
      </div>
      <MobileCardList className="md:hidden" data={keys} columns={cols} getRowId={(k) => k.id} />
    </>
  );
}

function ApiKeyTable({
  keys,
  cols,
  canManage,
}: {
  keys: ApiKeyRow[];
  cols: ColumnDef<ApiKeyRow>[];
  canManage: boolean;
}) {
  const nameCol = cols.find((c) => c.id === "name")!;
  const statusCol = cols.find((c) => c.id === "status")!;
  const scopesCol = cols.find((c) => c.id === "scopes")!;
  const lastUsedCol = cols.find((c) => c.id === "lastUsed")!;
  const expiresCol = cols.find((c) => c.id === "expires")!;
  const actionsCol = cols.find((c) => c.id === "actions");

  return (
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
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell>{nameCol.cell?.(key)}</TableCell>
            <TableCell>{statusCol.cell?.(key)}</TableCell>
            <TableCell>{scopesCol.cell?.(key)}</TableCell>
            <TableCell className="hidden sm:table-cell">{lastUsedCol.cell?.(key)}</TableCell>
            <TableCell className="hidden md:table-cell">{expiresCol.cell?.(key)}</TableCell>
            {actionsCol && <TableCell>{actionsCol.cell?.(key)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
