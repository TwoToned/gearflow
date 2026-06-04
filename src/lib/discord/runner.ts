/**
 * discord.js adapter: turns a ChatInputCommandInteraction into a framework-free
 * CommandContext, resolves the linked actor (live, never cached), enforces the
 * permission gate + ephemeral default, and renders any thrown `DiscordApiError`.
 *
 * In-process: no HMAC, no Bearer, no api client. Commands call services
 * directly with the resolved `ServiceActor`.
 */
import type { ChatInputCommandInteraction } from "discord.js";
import type { BotCommand, CommandContext, ReplyOptions } from "./bot-types";
import { DiscordApiError } from "@/lib/discord/api-errors";
import { resolveDiscordActor, type ServiceActor } from "@/lib/services/discord-actor";
import { botErrorMessage } from "./bot-errors";

/** Runtime deps the runner consumes per interaction. */
export interface RunnerDeps {
  /** Which org this bot process serves. */
  organizationId: string;
  /** Optional override (tests). Defaults to the production resolver. */
  resolveActor?: (discordUserId: string) => Promise<ServiceActor | null>;
}

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  command: BotCommand,
  deps: RunnerDeps,
): Promise<void> {
  const discordUserId = interaction.user.id;
  const resolve = deps.resolveActor ?? ((id) => resolveDiscordActor(deps.organizationId, id));
  const actor = await resolve(discordUserId);

  // Permission gate (live).
  const gate = command.requiredPermission;
  if (gate.kind !== "none" && !actor) {
    await interaction.reply({ content: botErrorMessage("NOT_LINKED"), ephemeral: true });
    return;
  }
  if (
    gate.kind === "gearflowRole" &&
    !(actor?.role && gate.anyOf.includes(actor.role))
  ) {
    await interaction.reply({
      content: botErrorMessage("FORBIDDEN", {
        requiredRole: gate.anyOf.join(" or "),
        actualRole: actor?.role,
      }),
      ephemeral: true,
    });
    return;
  }

  const ctx: CommandContext = {
    interactionId: interaction.id,
    options: optionMap(interaction),
    organizationId: deps.organizationId,
    discordUserId,
    actor,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    async reply(o: ReplyOptions) {
      const ephemeral = o.ephemeral ?? command.defaultEphemeral;
      const payload = {
        content: o.content,
        embeds: o.embeds as never,
        files: mapFiles(o.files),
        ephemeral,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload as never);
      } else {
        await interaction.reply(payload as never);
      }
    },
    async defer(o) {
      await interaction.deferReply({ ephemeral: o?.ephemeral ?? command.defaultEphemeral });
    },
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  };

  try {
    await command.execute(ctx);
  } catch (err) {
    const message =
      err instanceof DiscordApiError
        ? botErrorMessage(err.code, err.details)
        : botErrorMessage("INTERNAL");
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
    if (!(err instanceof DiscordApiError)) console.error(err);
  }
}

function optionMap(interaction: ChatInputCommandInteraction): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const opt of interaction.options.data) out[opt.name] = opt.value?.toString();
  return out;
}

function mapFiles(files?: { name: string; data: Buffer | Uint8Array }[]) {
  return files?.map((f) => ({ attachment: Buffer.from(f.data), name: f.name }));
}
