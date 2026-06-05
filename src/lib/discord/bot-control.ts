/**
 * Web-side control plane for the out-of-process Discord bot.
 *
 * The bot runs in its own process (`gearflow-discord-bot`), so the web app can't
 * call its start/stop functions directly. Instead it writes intent to the
 * `discord_integration` row and reads liveness from the bot's heartbeat. This
 * module deliberately imports ONLY prisma — never `bot-process` / discord.js —
 * so the web bundle stays free of the gateway client. The supervisor loop in the
 * bot process reconciles the running bot to this intent
 * (see src/lib/discord/bot-supervisor.ts).
 */
import { prisma } from "@/lib/prisma";
import type { DesiredState } from "@/lib/discord/bot-supervisor";

// A heartbeat older than this means the bot is not connected. Generous relative
// to the bot's ~15s heartbeat cadence to avoid flapping on a slow tick.
const HEARTBEAT_STALE_MS = Number(process.env.DISCORD_HEARTBEAT_STALE_MS ?? 60_000);

export interface BotStatus {
  /** True only when intent is RUNNING AND the heartbeat is fresh. */
  running: boolean;
  desiredState: DesiredState;
  organizationId: string | null;
  lastHeartbeatAt: string | null;
  /** Last startup failure surfaced by the bot process (null when healthy). */
  startError: string | null;
  pid: number | null;
}

function enabledWhere() {
  const explicit = process.env.GEARFLOW_DISCORD_ORG_ID;
  return explicit
    ? { organizationId: explicit, isEnabled: true }
    : { isEnabled: true };
}

export async function getBotStatus(now: Date = new Date()): Promise<BotStatus> {
  const row = await prisma.discordIntegration.findFirst({
    where: enabledWhere(),
    select: {
      organizationId: true,
      botDesiredState: true,
      lastHeartbeatAt: true,
      botStartError: true,
      botPid: true,
    },
  });
  if (!row) {
    return {
      running: false,
      desiredState: "RUNNING",
      organizationId: null,
      lastHeartbeatAt: null,
      startError: null,
      pid: null,
    };
  }
  const fresh =
    row.lastHeartbeatAt != null &&
    now.getTime() - row.lastHeartbeatAt.getTime() < HEARTBEAT_STALE_MS;
  return {
    running: row.botDesiredState === "RUNNING" && fresh,
    desiredState: row.botDesiredState,
    organizationId: row.organizationId,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    startError: row.botStartError,
    pid: row.botPid,
  };
}

/** Ask the bot process to (re)start and reload config. Returns fresh status. */
export async function requestBotRestart(): Promise<BotStatus> {
  await prisma.discordIntegration.updateMany({
    where: enabledWhere(),
    data: { botDesiredState: "RUNNING", botRestartRequestedAt: new Date() },
  });
  return getBotStatus();
}

/** Ask the bot process to stop (and stay stopped). Returns fresh status. */
export async function requestBotStop(): Promise<BotStatus> {
  await prisma.discordIntegration.updateMany({
    where: enabledWhere(),
    data: { botDesiredState: "STOPPED" },
  });
  return getBotStatus();
}
