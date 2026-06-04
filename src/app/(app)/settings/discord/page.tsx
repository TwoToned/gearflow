"use client";

import { useState } from "react";
import { useForm, Controller, type Control } from "react-hook-form";
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
  setDiscordCredentials,
  deployDiscordCommands,
  restartDiscordBot,
  stopDiscordBot,
  unlinkDiscordAccount,
} from "@/server/discord-integration";

// Subset of ProjectStatus the form uses — kept as a string literal type so the
// page doesn't import generated Prisma types client-side.
type ProjectStatusLiteral =
  | "ENQUIRY"
  | "QUOTING"
  | "QUOTED"
  | "CONFIRMED"
  | "PREPPING"
  | "CHECKED_OUT"
  | "ON_SITE"
  | "RETURNED"
  | "COMPLETED"
  | "INVOICED"
  | "CANCELLED";

const ALL_PROJECT_STATUSES: { value: ProjectStatusLiteral; label: string }[] = [
  { value: "ENQUIRY", label: "Enquiry" },
  { value: "QUOTING", label: "Quoting" },
  { value: "QUOTED", label: "Quoted" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PREPPING", label: "Prepping" },
  { value: "CHECKED_OUT", label: "Checked out" },
  { value: "ON_SITE", label: "On site" },
  { value: "RETURNED", label: "Returned" },
  { value: "COMPLETED", label: "Completed" },
  { value: "INVOICED", label: "Invoiced" },
  { value: "CANCELLED", label: "Cancelled" },
];
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
      discordApplicationId: integration?.discordApplicationId ?? "",
      projectCategoryId: integration?.projectCategoryId ?? "",
      archiveCategoryId: integration?.archiveCategoryId ?? "",
      alertChannelId: integration?.alertChannelId ?? "",
      auditChannelId: integration?.auditChannelId ?? "",
      channelCreateOnStatuses: (integration?.channelCreateOnStatuses ?? ["CONFIRMED"]) as ProjectStatusLiteral[],
      channelArchiveOnStatuses: (integration?.channelArchiveOnStatuses ?? [
        "COMPLETED",
        "INVOICED",
        "RETURNED",
        "CANCELLED",
      ]) as ProjectStatusLiteral[],
      postWelcomeOnCreate: integration?.postWelcomeOnCreate ?? true,
      postFaultsToProjectChannel: integration?.postFaultsToProjectChannel ?? true,
      linkTokenTtlMinutes: integration?.linkTokenTtlMinutes ?? 15,
      enrollmentOpen: integration?.enrollmentOpen ?? true,
    },
  });

  // Restart the in-process bot so config changes take effect without a Next.js
  // server restart. Toast on failure; never block the original save. Always
  // invalidate so the page re-reads the bot.running state.
  const applyBotRestart = async () => {
    try {
      const state = await restartDiscordBot();
      toast.success(state.running ? "Bot restarted — running" : "Bot restarted — still offline (check config)");
    } catch (e) {
      toast.error(e instanceof Error ? `Bot restart failed: ${e.message}` : "Bot restart failed");
    }
    invalidate();
  };

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!integration) await ensureDiscordIntegration();
      return setDiscordIntegrationEnabled(enabled);
    },
    onSuccess: async (_r, enabled) => {
      toast.success(enabled ? "Discord integration enabled" : "Discord integration disabled");
      invalidate();
      // Enable → start the bot. Disable → stop it. Both happen in-process.
      if (enabled) {
        await applyBotRestart();
      } else {
        try {
          await stopDiscordBot();
          toast.success("Bot stopped");
        } catch (e) {
          toast.error(e instanceof Error ? `Bot stop failed: ${e.message}` : "Bot stop failed");
        }
        invalidate();
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const saveConfig = useMutation({
    mutationFn: (values: DiscordIntegrationConfigValues) => updateDiscordIntegrationConfig(values),
    onSuccess: async () => {
      toast.success("Settings saved");
      invalidate();
      // Lifecycle rules / category ids / behavior toggles all affect the
      // running bot — restart so the new spec takes effect on the next poll.
      if (integration?.isEnabled) await applyBotRestart();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateDiscordSigningSecret(),
    onSuccess: () => {
      toast.success("Signing secret regenerated");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to regenerate"),
  });

  const [pendingBotToken, setPendingBotToken] = useState("");
  const saveBotToken = useMutation({
    mutationFn: (val: string | null) => setDiscordCredentials({ discordBotToken: val }),
    onSuccess: async (_r, val) => {
      toast.success(val === null ? "Discord bot token cleared" : "Discord bot token saved");
      setPendingBotToken("");
      invalidate();
      // Token change → restart (or stop if cleared). The running bot held the
      // old token in memory; it needs a fresh login to use the new one.
      if (val === null) {
        try {
          await stopDiscordBot();
        } catch {
          /* swallow; toast covered the save itself */
        }
        invalidate();
      } else if (integration?.isEnabled) {
        await applyBotRestart();
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save token"),
  });

  const deployCommands = useMutation({
    mutationFn: async () => {
      const deploy = await deployDiscordCommands();
      // After pushing the command registry to Discord, restart the bot so its
      // in-memory command set matches what Discord will route to it.
      const state = await restartDiscordBot().catch(() => ({ running: false }));
      return { ...deploy, botRunning: state.running };
    },
    onSuccess: (r) => {
      toast.success(
        `Deployed ${r.deployed} commands: ${r.commandNames.join(", ")} — bot ${r.botRunning ? "running" : "offline"}`,
      );
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to deploy commands"),
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
            <div className="flex items-center gap-3">
              <StatusIndicator intent={conn.intent} label={conn.label} />
              <StatusIndicator
                variant="pill"
                intent={data?.bot?.running ? "success" : "neutral"}
                label={data?.bot?.running ? "Bot running" : "Bot stopped"}
              />
            </div>
            <p className="text-xs text-fg-3">
              {integration?.lastHeartbeatAt
                ? `Last heartbeat ${formatDistanceToNow(new Date(integration.lastHeartbeatAt), { addSuffix: true })}`
                : "The bot hasn't checked in yet. Enable the integration and click Deploy commands & start bot below."}
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
          <form className="space-y-6 px-5 pb-5" onSubmit={form.handleSubmit((v) => saveConfig.mutate(v))}>
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-fg-3">Discord identity</legend>
              <Field label="Discord application ID" hint="From the Developer Portal — used by deploy-commands.">
                <Input {...form.register("discordApplicationId")} placeholder="e.g. 987654321098765432" />
              </Field>
              <Field label="Guild (server) ID" hint="The Discord server this org is bound to.">
                <Input {...form.register("guildId")} placeholder="e.g. 123456789012345678" />
              </Field>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-fg-3">Channels</legend>
              <Field label="Project category ID" hint="Active project channels are created here.">
                <Input {...form.register("projectCategoryId")} placeholder="Category channel id" />
              </Field>
              <Field
                label="Archive category ID"
                hint="Channels move here when a project enters an archive status (leave blank to lock in place)."
              >
                <Input {...form.register("archiveCategoryId")} placeholder="Category channel id (optional)" />
              </Field>
              <Field label="Asset alert channel ID" hint="Out-of-service faults are posted here.">
                <Input {...form.register("alertChannelId")} placeholder="Channel id" />
              </Field>
              <Field label="Audit log channel ID" hint="Automated bot action feed.">
                <Input {...form.register("auditChannelId")} placeholder="Channel id" />
              </Field>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                Channel lifecycle rules
              </legend>
              <div className="space-y-2">
                <Label className="text-sm text-fg-2">Create channel when status is…</Label>
                <p className="text-xs text-fg-3">
                  Once a project hits any of these, it gets a channel. Earlier statuses (e.g. Enquiry) skip the noise.
                </p>
                <Controller
                  control={form.control}
                  name="channelCreateOnStatuses"
                  render={({ field }) => (
                    <StatusCheckboxGroup
                      value={(field.value ?? []) as ProjectStatusLiteral[]}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-fg-2">Archive channel when status is…</Label>
                <p className="text-xs text-fg-3">
                  The bot moves the channel to the archive category and locks it. Empty = channels are never auto-archived.
                </p>
                <Controller
                  control={form.control}
                  name="channelArchiveOnStatuses"
                  render={({ field }) => (
                    <StatusCheckboxGroup
                      value={(field.value ?? []) as ProjectStatusLiteral[]}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-fg-3">Behavior</legend>
              <ToggleRow
                label="Post welcome embed on channel creation"
                hint="The bot posts a project summary the first time a channel is made."
                control={form.control}
                name="postWelcomeOnCreate"
              />
              <ToggleRow
                label="Echo fault reports in the project channel"
                hint="When /asset fault runs, post a summary to the project's channel in addition to the alert channel."
                control={form.control}
                name="postFaultsToProjectChannel"
              />
              <ToggleRow
                label="Open enrollment"
                hint="Allow crew to self-enroll with /link."
                control={form.control}
                name="enrollmentOpen"
              />
              <Field label="Enrollment link expiry (minutes)" hint="How long a /link email stays valid.">
                <Input type="number" min={5} max={1440} {...form.register("linkTokenTtlMinutes")} />
              </Field>
            </fieldset>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveConfig.isPending}>
                {saveConfig.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save settings
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Bot credentials — Discord token. Stored encrypted at rest; never shown back. */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <h2 className="mb-1 text-sm font-semibold text-fg-1">Bot credentials</h2>
        <p className="mb-3 text-xs text-fg-3">
          The Discord bot token from the Developer Portal. Stored encrypted at rest; the bot fetches it on startup so there&apos;s no .env on the host.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder={
              integration?.hasDiscordBotToken
                ? "Token configured (paste a new value to rotate)"
                : "Paste the bot token here"
            }
            value={pendingBotToken}
            onChange={(e) => setPendingBotToken(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saveBotToken.isPending || pendingBotToken.trim() === ""}
            onClick={() => saveBotToken.mutate(pendingBotToken.trim())}
          >
            {saveBotToken.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
          {integration?.hasDiscordBotToken && (
            <Button
              variant="ghost"
              size="sm"
              className="text-fg-3 hover:text-error"
              disabled={saveBotToken.isPending}
              onClick={() => saveBotToken.mutate(null)}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-fg-3">
          <StatusIndicator
            variant="pill"
            intent={integration?.hasDiscordBotToken ? "success" : "warning"}
            label={integration?.hasDiscordBotToken ? "Token configured" : "Not set"}
          />
        </p>
      </section>

      {/* Deploy & start — one-click bring-up. Pushes commands to Discord then
          restarts the in-process bot so it picks up the latest config. */}
      <section className="rounded-lg bg-bg-surface p-5 surface-ring">
        <h2 className="mb-1 text-sm font-semibold text-fg-1">Deploy &amp; start bot</h2>
        <p className="mb-3 text-xs text-fg-3">
          Pushes the slash command registry to your Discord server (guild-scoped, instant) AND restarts the bot in this Next.js process so it logs in with the latest credentials and config. No server restart needed.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={
            deployCommands.isPending ||
            !integration?.hasDiscordBotToken ||
            !integration?.discordApplicationId ||
            !integration?.guildId
          }
          onClick={() => deployCommands.mutate()}
        >
          {deployCommands.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Deploy commands &amp; start bot
        </Button>
        {(!integration?.hasDiscordBotToken ||
          !integration?.discordApplicationId ||
          !integration?.guildId) && (
          <p className="mt-2 text-xs text-fg-3">
            Fill in the bot token, application id, and guild id above first.
          </p>
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

function StatusCheckboxGroup({
  value,
  onChange,
}: {
  value: ProjectStatusLiteral[];
  onChange: (v: ProjectStatusLiteral[]) => void;
}) {
  const toggle = (s: ProjectStatusLiteral) => {
    if (value.includes(s)) onChange(value.filter((x) => x !== s));
    else onChange([...value, s]);
  };
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border p-3 sm:grid-cols-3">
      {ALL_PROJECT_STATUSES.map((s) => {
        const checked = value.includes(s.value);
        return (
          <label
            key={s.value}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-fg-2 hover:bg-bg-2"
          >
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={checked}
              onChange={() => toggle(s.value)}
            />
            <span>{s.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function ToggleRow<TName extends "postWelcomeOnCreate" | "postFaultsToProjectChannel" | "enrollmentOpen">({
  label,
  hint,
  control,
  name,
}: {
  label: string;
  hint: string;
  control: Control<DiscordIntegrationConfigValues>;
  name: TName;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-sm text-fg-2">{label}</Label>
        <p className="text-xs text-fg-3">{hint}</p>
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch checked={!!field.value} onCheckedChange={field.onChange} />
        )}
      />
    </div>
  );
}
