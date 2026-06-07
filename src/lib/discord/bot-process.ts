/**
 * In-process Discord bot lifecycle. Started by `instrumentation.ts` on Next.js
 * server boot; reads its configuration directly from the DB (no env, no HMAC,
 * no separate process). Slash commands and the outbox poller call services in
 * the same process — invariants run exactly once via the shared service layer.
 *
 * Hot-reload safety (Next dev): a `globalThis` singleton holds the active
 * client + a "stop" function so each restart cleanly destroys the previous bot
 * before starting a new one.
 */
import { Client, Events, GatewayIntentBits } from "discord.js";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto/secret-vault";
import { DiscordChannelGateway } from "./discord-channel-gateway";
import { loadCommands } from "./registry";
import { handleInteraction } from "./runner";
import { pollOnce, type ConsumerDeps } from "./outbox-consumer";
import type { BotCommand } from "./bot-types";
import type { SupervisorDeps, SupervisorState } from "./bot-supervisor";

const POLL_INTERVAL_MS = Number(process.env.DISCORD_POLL_INTERVAL_MS ?? 5000);

/** Guarded logger: only emits console.log in non-production environments. */
function devLog(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
}

interface BotRuntime {
  organizationId: string;
  client: Client;
  stop: () => Promise<void>;
}

const globalRef = globalThis as unknown as { __gearflowDiscordBot?: BotRuntime };

/**
 * Resolve the single enabled DiscordIntegration in the DB. We're single-tenant
 * for v1 — if there's exactly one enabled row, we use it; zero means the admin
 * hasn't enabled the integration yet (silently skip); more than one (future
 * multi-tenant) means the admin needs to set `GEARFLOW_DISCORD_ORG_ID` env to
 * disambiguate.
 */
async function resolveActiveIntegration(): Promise<{
  organizationId: string;
  discordBotToken: string;
  discordApplicationId: string | null;
  guildId: string;
  botUserId: string | null;
} | null> {
  const explicit = process.env.GEARFLOW_DISCORD_ORG_ID;
  const candidates = await prisma.discordIntegration.findMany({
    where: explicit
      ? { organizationId: explicit, isEnabled: true }
      : { isEnabled: true },
    select: {
      organizationId: true,
      discordBotToken: true,
      discordApplicationId: true,
      guildId: true,
      botUserId: true,
    },
  });

  if (candidates.length === 0) {
    devLog("[discord-bot] no enabled DiscordIntegration — skipping bot startup.");
    return null;
  }
  if (candidates.length > 1) {
    console.warn(
      `[discord-bot] ${candidates.length} enabled integrations found. Set GEARFLOW_DISCORD_ORG_ID to disambiguate. Skipping bot startup.`,
    );
    return null;
  }

  const row = candidates[0]!;
  if (!row.discordBotToken) {
    console.warn(
      "[discord-bot] integration enabled but Discord bot token is not set. Paste it at /settings/discord. Skipping bot startup.",
    );
    return null;
  }
  if (!row.guildId) {
    console.warn(
      "[discord-bot] integration enabled but guild id is not set. Paste it at /settings/discord. Skipping bot startup.",
    );
    return null;
  }
  let decrypted: string;
  try {
    decrypted = decryptSecret(row.discordBotToken);
  } catch (err) {
    console.error(
      "[discord-bot] failed to decrypt the stored Discord bot token. Re-paste it at /settings/discord. Skipping bot startup.",
      err,
    );
    return null;
  }
  return {
    organizationId: row.organizationId,
    discordBotToken: decrypted,
    discordApplicationId: row.discordApplicationId,
    guildId: row.guildId,
    botUserId: row.botUserId,
  };
}

async function startOutboxLoop(
  deps: ConsumerDeps,
  isRunning: () => boolean,
): Promise<void> {
  let cursor = 0;
  let consecutiveFailures = 0;

  const tick = async (): Promise<void> => {
    if (!isRunning()) return;
    try {
      const res = await pollOnce(cursor, deps);
      cursor = res.cursor;
      consecutiveFailures = 0;
      if (res.processed > 0) {
        devLog(`[discord-bot] outbox processed=${res.processed} cursor=${cursor} failed=${res.failed}`);
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`[discord-bot] outbox poll failed (${consecutiveFailures}):`, err);
    }
    const delay =
      consecutiveFailures > 0
        ? Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, 60_000)
        : POLL_INTERVAL_MS;
    if (isRunning()) setTimeout(tick, delay);
  };

  setTimeout(tick, 0);
}

/** Start the bot. No-op if already running, or if the integration isn't enabled. */
export async function startBot(): Promise<void> {
  if (globalRef.__gearflowDiscordBot) {
    devLog("[discord-bot] already running, skipping start.");
    return;
  }
  const config = await resolveActiveIntegration();
  if (!config) return;

  const registry = loadCommands();
  devLog(
    `[discord-bot] starting (org=${config.organizationId}, guild=${config.guildId}, commands=${[...registry.keys()].join(",")})`,
  );

  // Only `Guilds` — non-privileged. We previously also requested `GuildMembers`,
  // but Discord rejects logins for that intent unless the "Server Members
  // Intent" toggle is enabled in the Developer Portal. The only consumer was
  // `guild.members.fetch(id)` (single-ID lookup) in discord-channel-gateway,
  // which falls back to a REST call and works fine without the intent. The
  // intent is only required for full-list `.fetch()` (no args), GUILD_MEMBERS_CHUNK
  // events, or GuildMember{Add,Remove,Update} listeners — none of which we use.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  // CRITICAL: discord.js `Client` is a Node EventEmitter. A gateway/websocket
  // `error` or `shardError` emitted with NO listener is re-thrown by Node as an
  // uncaught exception — which kills the entire process. This was the root cause
  // of intermittent Cloudflare 502s: a transient Discord network blip crashed
  // the web server, pm2 restarted it, and users hit a dead origin during the
  // cold start. Listen, log (-> pm2 stderr), and report — never let a recoverable
  // gateway hiccup take the process down.
  client.on(Events.Error, (err) => {
    console.error("[discord-bot] client error:", err);
    Sentry.captureException(err, { tags: { scope: "discord-bot", kind: "client-error" } });
  });
  client.on(Events.ShardError, (err, shardId) => {
    console.error(`[discord-bot] shard ${shardId} websocket error:`, err);
    Sentry.captureException(err, { tags: { scope: "discord-bot", kind: "shard-error" } });
  });

  let running = true;
  const isRunning = () => running;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command: BotCommand | undefined = registry.get(interaction.commandName);
    if (!command) {
      console.warn(`[discord-bot] no command registered for /${interaction.commandName}`);
      return;
    }
    try {
      await handleInteraction(interaction, command, { organizationId: config.organizationId });
    } catch (err) {
      // handleInteraction already renders BotErrors; this catches anything that
      // escaped (e.g. the reply itself failed). Don't crash the web server.
      console.error(`[discord-bot] /${interaction.commandName} crashed:`, err);
    }
  });

  client.once(Events.ClientReady, async (c) => {
    devLog(`[discord-bot] logged in as ${c.user.tag} (id=${c.user.id})`);
    // Healthy start — clear any stale startup error the admin page is showing.
    await prisma.discordIntegration
      .update({
        where: { organizationId: config.organizationId },
        data: { botStartError: null, botPid: process.pid },
      })
      .catch((err) => console.warn("[discord-bot] failed to clear botStartError:", err));
    // Stamp the bot's Discord user id so the admin page can show it.
    if (c.user.id !== config.botUserId) {
      await prisma.discordIntegration
        .update({
          where: { organizationId: config.organizationId },
          data: { botUserId: c.user.id },
        })
        .catch((err) => console.warn("[discord-bot] failed to stamp botUserId:", err));
    }

    let guild;
    try {
      guild = await c.guilds.fetch(config.guildId);
    } catch (err) {
      console.error(
        `[discord-bot] failed to fetch guild=${config.guildId}. Is the bot invited to the server? Skipping the outbox loop; slash commands will still answer.`,
        err,
      );
      return;
    }

    const gateway = new DiscordChannelGateway(guild, c.user.id);
    const consumerDeps: ConsumerDeps = {
      organizationId: config.organizationId,
      gateway,
      botUserId: c.user.id,
      log: (event, fields) =>
        devLog(JSON.stringify({ scope: "discord-bot", event, ...fields })),
    };
    devLog(`[discord-bot] outbox poll loop starting (every ${POLL_INTERVAL_MS}ms)`);
    void startOutboxLoop(consumerDeps, isRunning);
  });

  const stop = async (): Promise<void> => {
    running = false;
    try {
      await client.destroy();
    } catch (err) {
      console.warn("[discord-bot] client.destroy errored:", err);
    }
    if (globalRef.__gearflowDiscordBot?.client === client) {
      delete globalRef.__gearflowDiscordBot;
    }
  };

  globalRef.__gearflowDiscordBot = {
    organizationId: config.organizationId,
    client,
    stop,
  };

  try {
    // Race login + ClientReady against a timeout so the admin-page restart
    // returns once the gateway handshake completes (or fails). Without this,
    // the post-restart status read happens before isReady() flips to true.
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        client.off(Events.ClientReady, onReady);
        reject(new Error("Timed out waiting for ClientReady (10s)"));
      }, 10_000);
      client.once(Events.ClientReady, onReady);
      client.login(config.discordBotToken).catch((err) => {
        clearTimeout(timer);
        client.off(Events.ClientReady, onReady);
        reject(err);
      });
    });
  } catch (err) {
    console.error("[discord-bot] login or ready handshake failed:", err);
    // Surface the failure on the admin page (v2 doc item 2.2) so an operator
    // can tell "wrong token" from "ECONNREFUSED" without SSHing into pm2.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.discordIntegration
      .update({
        where: { organizationId: config.organizationId },
        data: { botStartError: message },
      })
      .catch((e) => console.warn("[discord-bot] failed to record botStartError:", e));
    await stop();
  }
}

/** Stop the running bot. Idempotent. */
export async function stopBot(): Promise<void> {
  const existing = globalRef.__gearflowDiscordBot;
  if (!existing) return;
  devLog("[discord-bot] stopping...");
  await existing.stop();
}

/**
 * Stop the running bot (if any) and start a fresh one with the current
 * `DiscordIntegration` row. Use this after an admin save to apply changes
 * without restarting the whole Next.js server. Idempotent.
 */
export async function restartBot(): Promise<void> {
  await stopBot();
  await startBot();
}

/**
 * True when a bot instance is registered AND its Discord WS is open. Read by
 * the admin page to render Running / Stopped without polling Discord.
 */
export function isBotRunning(): boolean {
  const existing = globalRef.__gearflowDiscordBot;
  if (!existing) return false;
  // discord.js Client.isReady() returns true once the gateway handshake is done.
  return existing.client.isReady();
}

/** Diagnostic info for the admin page. */
export function getBotState(): { running: boolean; organizationId: string | null } {
  const existing = globalRef.__gearflowDiscordBot;
  if (!existing) return { running: false, organizationId: null };
  return { running: existing.client.isReady(), organizationId: existing.organizationId };
}

// --- Cross-process control plane (used by the standalone bot supervisor) ---

/** Resolve the enabled integration's organizationId (the unique update key), or null. */
async function resolveEnabledOrgId(): Promise<string | null> {
  const explicit = process.env.GEARFLOW_DISCORD_ORG_ID;
  const row = await prisma.discordIntegration.findFirst({
    where: explicit ? { organizationId: explicit, isEnabled: true } : { isEnabled: true },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

/** Read cross-process control intent for the supervisor. null = no enabled integration. */
export async function readBotControlState(): Promise<SupervisorState | null> {
  const explicit = process.env.GEARFLOW_DISCORD_ORG_ID;
  const row = await prisma.discordIntegration.findFirst({
    where: explicit ? { organizationId: explicit, isEnabled: true } : { isEnabled: true },
    select: { botDesiredState: true, botRestartRequestedAt: true },
  });
  if (!row) return null;
  return {
    desiredState: row.botDesiredState,
    restartRequestedAt: row.botRestartRequestedAt,
  };
}

/** Stamp liveness on the enabled integration row. */
export async function writeBotHeartbeat(): Promise<void> {
  const orgId = await resolveEnabledOrgId();
  if (!orgId) return;
  await prisma.discordIntegration.update({
    where: { organizationId: orgId },
    data: { lastHeartbeatAt: new Date(), botPid: process.pid },
  });
}

/** Wire the supervisor reconcile loop to the DB + the in-process bot lifecycle. */
export function createSupervisorDeps(): SupervisorDeps {
  return {
    readState: readBotControlState,
    isRunning: isBotRunning,
    start: startBot,
    stop: stopBot,
    writeHeartbeat: writeBotHeartbeat,
    log: (msg) => devLog(`[discord-supervisor] ${msg}`),
  };
}
