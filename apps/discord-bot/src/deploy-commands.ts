/**
 * Deploy slash commands to ONE guild (instant propagation). Never global-on-boot
 * (global takes up to 1h + re-PUT-on-boot is a rate-limit/audit hazard).
 *
 *   npm run deploy-commands
 *
 * Reads the Discord bot token + application id + guild id from the GearFlow
 * bootstrap call (no .env for them — they live in the admin page). Override
 * the guild with `--guild <id>` for dev work.
 *
 * Converts the framework-free CommandData into discord.js builders here, so
 * command files stay testable without discord.js.
 */
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { loadCommands } from "./registry.js";
import { loadEnv } from "./env.js";
import { fetchBootstrap, BootstrapError } from "./bootstrap.js";
import type { CommandData } from "./types.js";

function toBuilder(data: CommandData): SlashCommandBuilder {
  const b = new SlashCommandBuilder().setName(data.name).setDescription(data.description);
  for (const opt of data.options ?? []) {
    if (opt.type === "string") {
      b.addStringOption((o) => {
        o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required);
        if (opt.choices) o.addChoices(...opt.choices);
        return o;
      });
    } else if (opt.type === "integer") {
      b.addIntegerOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
    } else if (opt.type === "boolean") {
      b.addBooleanOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
    } else {
      b.addUserOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
    }
  }
  return b;
}

async function main(): Promise<void> {
  const env = loadEnv();
  let boot;
  try {
    boot = await fetchBootstrap(env);
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(`Bootstrap failed: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const guildIdx = process.argv.indexOf("--guild");
  const guildId = guildIdx >= 0 ? process.argv[guildIdx + 1] : boot.guildId;
  if (!guildId) {
    throw new Error("No guild id. Set it at GearFlow → Settings → Discord or pass --guild <id>.");
  }
  if (!boot.discordBotToken) {
    throw new Error("No Discord bot token in the GearFlow admin page — paste it there first.");
  }
  if (!boot.discordApplicationId) {
    throw new Error("No Discord application id in the GearFlow admin page — paste it there first.");
  }

  const registry = await loadCommands();
  const body = [...registry.values()].map((c) => toBuilder(c.data).toJSON());

  const rest = new REST({ version: "10" }).setToken(boot.discordBotToken);
  await rest.put(Routes.applicationGuildCommands(boot.discordApplicationId, guildId), { body });
  console.log(`Deployed ${body.length} commands to guild ${guildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
