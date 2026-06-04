/**
 * Bot env. Only the bare minimum needed to bootstrap from GearFlow stays here;
 * everything else (Discord token, app id, guild id, category ids, signing
 * secret, status rules, behavior toggles) lives in the GearFlow admin page at
 * /settings/discord. The bot fetches that config on startup via the bootstrap
 * route.
 *
 * Required:
 *   GEARFLOW_BOT_BEARER  — global Bearer that authenticates this process against
 *                          /api/discord/v1/* (matches the app's DISCORD_BOT_TOKEN).
 *   GEARFLOW_ORG_ID      — which org's integration to fetch (single-org per process).
 *
 * Optional:
 *   GEARFLOW_API_URL     — defaults to https://home.twotoned.com.au.
 *   POLL_INTERVAL_MS     — outbox poll cadence (default 5000; min 500).
 */

const REQUIRED = ["GEARFLOW_BOT_BEARER", "GEARFLOW_ORG_ID"] as const;
type Required = (typeof REQUIRED)[number];

export interface BotEnv extends Record<Required, string> {
  GEARFLOW_API_URL: string;
  POLL_INTERVAL_MS: number;
}

const DEFAULT_API_URL = "https://home.twotoned.com.au";

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BotEnv {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}\n` +
        `Copy apps/discord-bot/.env.example to apps/discord-bot/.env and fill them in.\n` +
        `Everything else (Discord token, guild id, channel ids, rules) is configured at GearFlow → Settings → Discord.`,
    );
  }
  const intervalRaw = source.POLL_INTERVAL_MS;
  const interval = intervalRaw ? Number(intervalRaw) : 5000;
  if (!Number.isFinite(interval) || interval < 500) {
    throw new Error(`POLL_INTERVAL_MS must be a number >= 500, got ${intervalRaw}`);
  }
  return {
    GEARFLOW_BOT_BEARER: source.GEARFLOW_BOT_BEARER!,
    GEARFLOW_ORG_ID: source.GEARFLOW_ORG_ID!,
    GEARFLOW_API_URL: source.GEARFLOW_API_URL ?? DEFAULT_API_URL,
    POLL_INTERVAL_MS: interval,
  };
}
