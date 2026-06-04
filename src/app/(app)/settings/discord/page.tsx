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
  ChevronDown,
  ChevronUp,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import {
  discordIntegrationConfigSchema,
  type DiscordIntegrationConfigValues,
} from "@/lib/validations/discord-integration";
import {
  getDiscordIntegrationSettings,
  ensureDiscordIntegration,
  updateDiscordIntegrationConfig,
  setDiscordIntegrationEnabled,
  regenerateDiscordSigningSecret,
  unlinkDiscordAccount,
} from "@/server/discord-integration";
import { useActiveOrganization } from "@/lib/auth-client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FadeIn } from "@/components/ui/motion";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/** How fresh a heartbeat must be to count the bot as online. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

type RosterRow = {
  crewMemberId: string;
  name: string;
  email: string | null;
  discordUserId: string | null;
  linkedAt: string | null;
};

function connectionStatus(lastHeartbeatAt: Date | string | null | undefined): {
  intent: "success" | "warning" | "neutral";
  label: string;
} {
  if (!lastHeartbeatAt) return { intent: "neutral", label: "Never connected" };
  const age = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (age <= ONLINE_WINDOW_MS) return { intent: "success", label: "Connected" };
  return { intent: "warning", label: "Offline" };
}

export default function DiscordSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<RosterRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["discord-integration", orgId],
    queryFn: () => getDiscordIntegrationSettings(),
    enabled: !!orgId,
  });

  const integration = data?.integration ?? null;
  const roster = (data?.roster ?? []) as RosterRow[];
  const summary = data?.summary ?? { linkedCount: 0, totalCrew: 0 };
  const recentActivity = data?.recentActivity ?? [];
  const conn = connectionStatus(integration?.lastHeartbeatAt);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["discord-integration", orgId] });

  const form = useForm<DiscordIntegrationConfigValues>({
    resolver: zodResolver(discordIntegrationConfigSchema),
    values: {
      guildId: integration?.guildId ?? "",
      projectCategoryId: integration?.projectCategoryId ?? "",
      alertChannelId: integration?.alertChannelId ?? "",
      auditChannelId: integration?.auditChannelId ?? "",
      linkTokenTtlMinutes: integration?.linkTokenTtlMinutes ?? 15,
      enrollmentOpen: integration?.enrollmentOpen ?? true,
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!integration) await ensureDiscordIntegration();
      return setDiscordIntegrationEnabled(enabled);
    },
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? "Discord integration enabled" : "Discord integration disabled");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const saveConfig = useMutation({
    mutationFn: (values: DiscordIntegrationConfigValues) => updateDiscordIntegrationConfig(values),
    onSuccess: () => {
      toast.success("Settings saved");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateDiscordSigningSecret(),
    onSuccess: () => {
      toast.success("Signing secret regenerated — update the bot's config");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to regenerate"),
  });

  const unlink = useMutation({
    mutationFn: (crewMemberId: string) => unlinkDiscordAccount(crewMemberId),
    onSuccess: () => {
      toast.success("Discord account unlinked");
      setUnlinkTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to unlink"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin text-fg-3" />
      </div>
    );
  }

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6 py-2">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-fg-1">Discord Integration</h1>
        <p className="text-sm text-fg-3">
          Connect your Discord server so crew get project channels and can act on assets from Discord.
        </p>
      </header>

      {/* Connection health — leads the page, renders from the heartbeat, never blocks on the bot. */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <StatusIndicator intent={conn.intent} label={conn.label} />
            </div>
            <p className="text-xs text-fg-3">
              {integration?.lastHeartbeatAt
                ? `Last heartbeat ${formatDistanceToNow(new Date(integration.lastHeartbeatAt), { addSuffix: true })}`
                : "The bot hasn't checked in yet. Start the bot service with this org's signing secret."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled" className="text-sm text-fg-2">
              {integration?.isEnabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="enabled"
              checked={!!integration?.isEnabled}
              disabled={toggleEnabled.isPending}
              onCheckedChange={(v) => toggleEnabled.mutate(v)}
            />
          </div>
        </div>
        {integration?.isEnabled && conn.intent !== "success" && (
          <p className="mt-3 text-xs text-warning">
            Integration is enabled but the bot is not connected — events are queued and will sync once it reconnects.
          </p>
        )}
      </section>

      {/* Linked accounts roster — partial is the steady state; show everyone. */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-1">Linked accounts</h2>
          <span className="text-xs text-fg-3">
            {summary.linkedCount} of {summary.totalCrew} linked
          </span>
        </div>
        {roster.length === 0 ? (
          <p className="text-sm text-fg-3">No active crew members yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {roster.map((r) => (
              <li key={r.crewMemberId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg-1">{r.name}</p>
                  <p className="truncate text-xs text-fg-3">{r.email ?? "No email"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusIndicator
                    variant="pill"
                    intent={r.discordUserId ? "success" : "neutral"}
                    label={r.discordUserId ? "Linked" : "Pending"}
                  />
                  {r.discordUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-fg-3 hover:text-error"
                      onClick={() => setUnlinkTarget(r)}
                    >
                      <Unlink className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Set-once config — demoted below the high-frequency views, collapsible. */}
      <section className="rounded-lg bg-bg-surface surface-ring">
        <button
          type="button"
          className="flex w-full items-center justify-between p-5"
          onClick={() => setShowConfig((s) => !s)}
        >
          <h2 className="text-sm font-semibold text-fg-1">Configuration</h2>
          {showConfig ? <ChevronUp className="size-4 text-fg-3" /> : <ChevronDown className="size-4 text-fg-3" />}
        </button>
        {showConfig && (
          <form className="space-y-4 px-5 pb-5" onSubmit={form.handleSubmit((v) => saveConfig.mutate(v))}>
            <Field label="Guild (server) ID" hint="The Discord server this org is bound to.">
              <Input {...form.register("guildId")} placeholder="e.g. 123456789012345678" />
            </Field>
            <Field label="Project category ID" hint="New project channels are created under this category.">
              <Input {...form.register("projectCategoryId")} placeholder="Category channel id" />
            </Field>
            <Field label="Asset alert channel ID" hint="Out-of-service faults are posted here.">
              <Input {...form.register("alertChannelId")} placeholder="Channel id" />
            </Field>
            <Field label="Audit log channel ID" hint="Automated bot action feed.">
              <Input {...form.register("auditChannelId")} placeholder="Channel id" />
            </Field>
            <Field label="Enrollment link expiry (minutes)" hint="How long a /link email stays valid.">
              <Input type="number" min={5} max={1440} {...form.register("linkTokenTtlMinutes")} />
            </Field>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-fg-2">Open enrollment</Label>
                <p className="text-xs text-fg-3">Allow crew to self-enroll with /link.</p>
              </div>
              <Controller
                control={form.control}
                name="enrollmentOpen"
                render={({ field }) => (
                  <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={saveConfig.isPending}>
                {saveConfig.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save settings
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Signing secret — show/hide + copy + regenerate. */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <h2 className="mb-1 text-sm font-semibold text-fg-1">Signing secret</h2>
        <p className="mb-3 text-xs text-fg-3">
          The bot signs every request with this per-org secret. Keep it private; regenerating requires updating the bot.
        </p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            type={showSecret ? "text" : "password"}
            value={(integration?.signingSecret as string) ?? "—"}
            className="font-mono text-xs"
          />
          <Button variant="outline" size="sm" onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!integration?.signingSecret}
            onClick={() => {
              navigator.clipboard.writeText((integration?.signingSecret as string) ?? "");
              toast.success("Copied");
            }}
          >
            <Copy className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
            <RefreshCw className={`size-4 ${regenerate.isPending ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </section>

      {/* Recent activity from the existing audit log (no second feed). */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <h2 className="mb-3 text-sm font-semibold text-fg-1">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-fg-3">No Discord activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg-2">{a.summary}</span>
                <span className="shrink-0 text-xs text-fg-3">
                  {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unlink confirm — Dialog (no AlertDialog in this project). */}
      <Dialog open={!!unlinkTarget} onOpenChange={(o) => !o && setUnlinkTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Discord account</DialogTitle>
            <DialogDescription>
              Remove the Discord link for <strong>{unlinkTarget?.name}</strong>? They will lose channel access until they
              run <code>/link</code> again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnlinkTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={unlink.isPending}
              onClick={() => unlinkTarget && unlink.mutate(unlinkTarget.crewMemberId)}
            >
              {unlink.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-fg-2">{label}</Label>
      {children}
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
}
