/**
 * Env validation. Fails loudly at boot — every required var listed at once,
 * no silent "undefined" defaults that surface as a 401 three hours into a shift.
 */

const REQUIRED = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
  "GEARFLOW_API_URL",
  "GEARFLOW_BOT_BEARER",
  "GEARFLOW_DISCORD_SIGNING_SECRET",
  "GEARFLOW_ORG_ID",
] as const;

type Required = (typeof REQUIRED)[number];

export interface BotEnv extends Record<Required, string> {
  /** How often to poll the outbox, in ms. Defaults to 5s — also drives the heartbeat. */
  POLL_INTERVAL_MS: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BotEnv {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}\n` +
        `Copy apps/discord-bot/.env.example to apps/discord-bot/.env and fill them in.`,
    );
  }
  const intervalRaw = source.POLL_INTERVAL_MS;
  const interval = intervalRaw ? Number(intervalRaw) : 5000;
  if (!Number.isFinite(interval) || interval < 500) {
    throw new Error(`POLL_INTERVAL_MS must be a number >= 500, got ${intervalRaw}`);
  }
  return {
    DISCORD_BOT_TOKEN: source.DISCORD_BOT_TOKEN!,
    DISCORD_APPLICATION_ID: source.DISCORD_APPLICATION_ID!,
    DISCORD_GUILD_ID: source.DISCORD_GUILD_ID!,
    GEARFLOW_API_URL: source.GEARFLOW_API_URL!,
    GEARFLOW_BOT_BEARER: source.GEARFLOW_BOT_BEARER!,
    GEARFLOW_DISCORD_SIGNING_SECRET: source.GEARFLOW_DISCORD_SIGNING_SECRET!,
    GEARFLOW_ORG_ID: source.GEARFLOW_ORG_ID!,
    POLL_INTERVAL_MS: interval,
  };
}
