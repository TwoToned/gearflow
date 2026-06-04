/**
 * Bot entrypoint. Production wiring (no longer a scaffold):
 *
 *  1. Load + validate env (fail loudly at boot).
 *  2. Load the command registry (fail-fast on dup/missing name).
 *  3. Login to Discord with Guilds + GuildMembers (privileged) intents.
 *  4. On `clientReady`: fetch the configured guild, build a DiscordChannelGateway,
 *     fetch the integration config from GearFlow, and start the outbox poll loop.
 *  5. On `interactionCreate` for slash commands: dispatch through `handleInteraction`
 *     with the production RunnerDeps (live actor resolution + per-actor api client).
 *  6. SIGINT/SIGTERM: stop the poll loop, destroy the Discord client, exit clean.
 *
 * Cursor lives in-memory. The outbox design is robust to a lost cursor: the read
 * side filters by status, so a restart with cursor=0 re-pulls only PENDING rows.
 */
import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadCommands } from "./registry.js";
import { handleInteraction } from "./runner.js";
import { loadEnv, type BotEnv } from "./env.js";
import { buildApiClient, buildRunnerDeps } from "./runner-deps.js";
import { DiscordChannelGateway } from "./discord-channel-gateway.js";
import { pollOnce, type ConsumerDeps } from "./outbox-consumer.js";
import type { BotCommand } from "./types.js";

interface IntegrationConfig {
  isEnabled: boolean;
  guildId: string | null;
  projectCategoryId: string | null;
  alertChannelId: string | null;
  auditChannelId: string | null;
  botUserId: string | null;
}

async function startOutboxLoop(
  env: BotEnv,
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
    // Back off on repeated failure (max 60s), normal interval otherwise.
    const delay =
      consecutiveFailures > 0
        ? Math.min(env.POLL_INTERVAL_MS * 2 ** consecutiveFailures, 60_000)
        : env.POLL_INTERVAL_MS;
    if (isRunning()) setTimeout(tick, delay);
  };

  // Kick off immediately so the bot heartbeats + drains any backlog on start.
  setTimeout(tick, 0);
}

async function main(): Promise<void> {
  const env = loadEnv();

  const registry = await loadCommands();
  console.log(`Loaded ${registry.size} commands: ${[...registry.keys()].join(", ")}`);

  const runnerDeps = buildRunnerDeps(env);
  const systemApi = buildApiClient(env);

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
      // handleInteraction renders its own BotErrors; this catches anything that
      // escaped (e.g. the reply itself failed). Don't crash the process.
      console.error(`[interaction] /${interaction.commandName} crashed:`, err);
    }
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag} (id=${c.user.id})`);

    let guild;
    try {
      guild = await c.guilds.fetch(env.DISCORD_GUILD_ID);
    } catch (err) {
      console.error(
        `Failed to fetch DISCORD_GUILD_ID=${env.DISCORD_GUILD_ID}. ` +
          `Is the bot invited to the guild? Use the invite URL in the README.`,
        err,
      );
      // Keep the process alive for slash commands the bot can still answer in
      // other guilds, but the channel sync loop is disabled.
      return;
    }

    const gateway = new DiscordChannelGateway(guild, c.user.id);

    // Pull the per-org integration config. Admins can change projectCategoryId
    // without restarting — we refresh it inside the consumer via this same call
    // every Nth poll if needed, but for v1 we read once at startup.
    let config: IntegrationConfig;
    try {
      config = await systemApi.get<IntegrationConfig>("/integration/config");
    } catch (err) {
      console.error(
        "Failed to load integration config from GearFlow. " +
          "Confirm GEARFLOW_API_URL, GEARFLOW_BOT_BEARER, GEARFLOW_ORG_ID, and that the org has an enabled DiscordIntegration row.",
        err,
      );
      return;
    }
    if (!config.isEnabled) {
      console.warn("Discord integration is DISABLED in GearFlow settings. Slash commands answer, but channel sync is paused.");
      return;
    }

    const consumerDeps: ConsumerDeps = {
      api: systemApi,
      gateway,
      categoryId: config.projectCategoryId,
      botUserId: c.user.id,
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    };
    console.log(`Outbox poll loop starting (every ${env.POLL_INTERVAL_MS}ms, category=${config.projectCategoryId ?? "none"})`);
    void startOutboxLoop(env, consumerDeps, isRunning);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    running = false;
    void client.destroy().finally(() => process.exit(0));
    // Hard timeout: if discord.js hangs on destroy, force exit after 5s.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(env.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
