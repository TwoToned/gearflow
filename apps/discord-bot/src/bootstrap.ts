/**
 * Bootstrap: fetch the full integration config from GearFlow before logging in
 * to Discord. The bot needs the Discord token + app id + guild id + signing
 * secret + status rules all in one shot, which is exactly what
 * `GET /api/discord/v1/integration/bootstrap` returns.
 *
 * Authenticated by the global bot Bearer (the one secret on the bot host); the
 * per-org signing secret comes BACK in the response (chicken/egg solved at the
 * Bearer trust layer).
 */
import type { BotEnv } from "./env.js";

export interface BootstrapConfig {
  isEnabled: boolean;
  signingSecret: string;
  discordBotToken: string | null;
  discordApplicationId: string | null;
  guildId: string | null;
  projectCategoryId: string | null;
  archiveCategoryId: string | null;
  alertChannelId: string | null;
  auditChannelId: string | null;
  channelCreateOnStatuses: string[];
  channelArchiveOnStatuses: string[];
  postWelcomeOnCreate: boolean;
  postFaultsToProjectChannel: boolean;
  botUserId: string | null;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapError";
  }
}

export async function fetchBootstrap(env: BotEnv, fetchImpl: typeof fetch = fetch): Promise<BootstrapConfig> {
  const url = `${env.GEARFLOW_API_URL}/api/discord/v1/integration/bootstrap`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${env.GEARFLOW_BOT_BEARER}`,
        "x-gearflow-org": env.GEARFLOW_ORG_ID,
      },
    });
  } catch (err) {
    throw new BootstrapError(
      `Could not reach ${url}. Is GEARFLOW_API_URL correct and GearFlow up? Underlying: ${(err as Error).message}`,
    );
  }
  let body: Envelope<BootstrapConfig>;
  try {
    body = (await res.json()) as Envelope<BootstrapConfig>;
  } catch {
    throw new BootstrapError(`Bootstrap returned a non-JSON response (status ${res.status}).`);
  }
  if (!body.ok || !body.data) {
    const code = body.error?.code ?? "UNKNOWN";
    const message = body.error?.message ?? "Bootstrap failed";
    if (code === "SIGNATURE_INVALID") {
      throw new BootstrapError(
        `GEARFLOW_BOT_BEARER rejected by the app. Check that the app's DISCORD_BOT_TOKEN env matches GEARFLOW_BOT_BEARER.`,
      );
    }
    if (code === "ORG_NOT_CONFIGURED") {
      throw new BootstrapError(
        `No Discord integration found for GEARFLOW_ORG_ID=${env.GEARFLOW_ORG_ID}. Enable it at GearFlow → Settings → Discord first.`,
      );
    }
    throw new BootstrapError(`[${code}] ${message}`);
  }
  return body.data;
}

/** Assert the bootstrap config has everything needed to actually run. */
export function assertBootRunnable(config: BootstrapConfig): asserts config is BootstrapConfig & {
  discordBotToken: string;
  discordApplicationId: string;
  guildId: string;
} {
  if (!config.isEnabled) {
    throw new BootstrapError("Discord integration is disabled in GearFlow settings.");
  }
  const missing: string[] = [];
  if (!config.discordBotToken) missing.push("Discord bot token");
  if (!config.discordApplicationId) missing.push("Discord application id");
  if (!config.guildId) missing.push("Guild id");
  if (missing.length > 0) {
    throw new BootstrapError(
      `Bootstrap config is incomplete (missing: ${missing.join(", ")}). Fill these in at GearFlow → Settings → Discord.`,
    );
  }
}
