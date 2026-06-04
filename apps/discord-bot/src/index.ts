/**
 * Bot entrypoint. Bootstrap-then-login flow:
 *
 *  1. Load env (just GEARFLOW_BOT_BEARER + GEARFLOW_ORG_ID, plus optional API_URL).
 *  2. Fetch the full integration config from GearFlow (`GET /v1/integration/bootstrap`).
 *     This returns the Discord bot token, app id, guild id, signing secret, and
 *     all the lifecycle rules — admins manage these from `/settings/discord` and
 *     the bot has no .env for them.
 *  3. Login to Discord with the fetched bot token.
 *  4. On `clientReady`: fetch the guild, build a `DiscordChannelGateway`, start
 *     a recursive `setTimeout` outbox poll loop (default 5s; exponential backoff
 *     to 60s on repeated failure).
 *  5. On `interactionCreate`: dispatch through `handleInteraction` with the
 *     production `RunnerDeps` (live actor resolution + per-actor api client).
 *  6. SIGINT/SIGTERM: stop the poll loop, destroy the Discord client, exit clean.
 *
 * Cursor lives in-memory. The outbox read is status-driven, so a restart with
 * cursor=0 only re-pulls PENDING rows (already-PROCESSED is filtered out).
 */
import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadCommands } from "./registry.js";
import { handleInteraction } from "./runner.js";
import { loadEnv } from "./env.js";
import { assertBootRunnable, BootstrapError, fetchBootstrap } from "./bootstrap.js";
import { buildApiClient, buildRunnerDeps } from "./runner-deps.js";
import { DiscordChannelGateway } from "./discord-channel-gateway.js";
import { pollOnce, type ConsumerDeps } from "./outbox-consumer.js";
import type { BotCommand } from "./types.js";

async function startOutboxLoop(
  intervalMs: number,
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
        console.log(`[outbox] processed=${res.processed} cursor=${cursor} failed=${res.failed}`);
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`[outbox] poll failed (${consecutiveFailures} in a row):`, err);
    }
    const delay =
      consecutiveFailures > 0
        ? Math.min(intervalMs * 2 ** consecutiveFailures, 60_000)
        : intervalMs;
    if (isRunning()) setTimeout(tick, delay);
  };

  setTimeout(tick, 0);
}

async function main(): Promise<void> {
  const env = loadEnv();

  console.log(`Bootstrapping from ${env.GEARFLOW_API_URL} (org=${env.GEARFLOW_ORG_ID})...`);
  let boot;
  try {
    boot = await fetchBootstrap(env);
    assertBootRunnable(boot);
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(`Bootstrap failed: ${err.message}`);
    } else {
      console.error("Bootstrap failed unexpectedly:", err);
    }
    process.exit(1);
  }
  console.log(
    `Bootstrap OK — guild=${boot.guildId}, project category=${boot.projectCategoryId ?? "none"}, archive category=${boot.archiveCategoryId ?? "none"}.`,
  );

  const apiCfg = { env, signingSecret: boot.signingSecret };

  const registry = await loadCommands();
  console.log(`Loaded ${registry.size} commands: ${[...registry.keys()].join(", ")}`);

  const runnerDeps = buildRunnerDeps(apiCfg);
  const systemApi = buildApiClient(apiCfg);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  let running = true;
  const isRunning = () => running;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command: BotCommand | undefined = registry.get(interaction.commandName);
    if (!command) {
      console.warn(`No command registered for /${interaction.commandName}`);
      return;
    }
    try {
      await handleInteraction(interaction, command, runnerDeps);
    } catch (err) {
      console.error(`[interaction] /${interaction.commandName} crashed:`, err);
    }
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag} (id=${c.user.id})`);

    let guild;
    try {
      guild = await c.guilds.fetch(boot.guildId);
    } catch (err) {
      console.error(
        `Failed to fetch guild=${boot.guildId}. Is the bot invited to the server? See the invite URL in apps/discord-bot/README.md.`,
        err,
      );
      return;
    }

    const gateway = new DiscordChannelGateway(guild, c.user.id);
    const consumerDeps: ConsumerDeps = {
      api: systemApi,
      gateway,
      botUserId: c.user.id,
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    };
    console.log(
      `Outbox poll loop starting (every ${env.POLL_INTERVAL_MS}ms, create=${boot.channelCreateOnStatuses.join("|")}, archive=${boot.channelArchiveOnStatuses.join("|")})`,
    );
    void startOutboxLoop(env.POLL_INTERVAL_MS, consumerDeps, isRunning);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    running = false;
    void client.destroy().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(boot.discordBotToken);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
