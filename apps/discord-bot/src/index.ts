/**
 * Bot entrypoint. SCAFFOLD — boots the client, loads the registry, and routes
 * interactions through the runner. Actor resolution + outbox polling are wired as
 * those endpoints land (see FEATUREDOCS/48 TODO).
 *
 * Required gateway intents: Guilds, GuildMembers (PRIVILEGED — toggle on in the
 * Developer Portal or member events never arrive). See README.
 */
import { Client, GatewayIntentBits } from "discord.js";
import { loadCommands } from "./registry.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

async function main(): Promise<void> {
  const registry = await loadCommands();
  console.log(`Loaded ${registry.size} commands: ${[...registry.keys()].join(", ")}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once("clientReady", (c) => console.log(`Logged in as ${c.user.tag}`));

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = registry.get(interaction.commandName);
    if (!command) return;
    // TODO: wire RunnerDeps (resolveActor via GET /api/discord/v1/me, apiFor via per-org client).
    console.log(`(scaffold) received /${interaction.commandName}`);
  });

  await client.login(env("DISCORD_BOT_TOKEN"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
