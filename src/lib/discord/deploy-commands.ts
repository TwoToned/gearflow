/**
 * Convert the framework-free CommandData into discord.js builders and PUT them
 * to Discord, guild-scoped. Guild-scoped is instant; global takes up to 1h to
 * propagate, so we never use it.
 */
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { ALL_COMMANDS } from "./registry";
import type { CommandData } from "./bot-types";

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

export interface DeployResult {
  deployed: number;
  commandNames: string[];
}

export async function deployCommands(opts: {
  discordBotToken: string;
  discordApplicationId: string;
  guildId: string;
}): Promise<DeployResult> {
  const body = ALL_COMMANDS.map((c) => toBuilder(c.data).toJSON());
  const rest = new REST({ version: "10" }).setToken(opts.discordBotToken);
  await rest.put(Routes.applicationGuildCommands(opts.discordApplicationId, opts.guildId), { body });
  return { deployed: body.length, commandNames: ALL_COMMANDS.map((c) => c.data.name) };
}
