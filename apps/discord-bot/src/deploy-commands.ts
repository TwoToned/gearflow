/**
 * Deploy slash commands to ONE guild (instant propagation). Never global-on-boot
 * (global takes up to 1h + re-PUT-on-boot is a rate-limit/audit hazard).
 *
 *   npm run deploy-commands -- --guild <guildId>
 *
 * Converts the framework-free CommandData into discord.js builders here, so command
 * files stay testable without discord.js.
 */
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { loadCommands } from "./registry.js";
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
  const guildIdx = process.argv.indexOf("--guild");
  const guildId = guildIdx >= 0 ? process.argv[guildIdx + 1] : process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("Pass --guild <id> or set DISCORD_GUILD_ID");

  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!token || !appId) throw new Error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID");

  const registry = await loadCommands();
  const body = [...registry.values()].map((c) => toBuilder(c.data).toJSON());

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
  console.log(`Deployed ${body.length} commands to guild ${guildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
