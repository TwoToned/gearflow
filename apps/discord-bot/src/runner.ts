/**
 * Discord.js adapter: turns a ChatInputCommandInteraction into a framework-free
 * CommandContext, resolves the linked actor + live role via GearFlow, enforces the
 * permission gate and ephemeral default, and renders any thrown BotError.
 *
 * SCAFFOLD — wiring intentionally minimal; flesh out actor resolution + embed/file
 * mapping as commands land. The contract (types.ts) is the stable part.
 */
import type { ChatInputCommandInteraction } from "discord.js";
import type { BotCommand, CommandContext, GearFlowApiClient, ResolvedActor } from "./types.js";
import { BotError, botErrorMessage } from "./errors.js";

export interface RunnerDeps {
  /** Resolve the Discord user → org link + live role (checked per interaction, never cached). */
  resolveActor(discordUserId: string, guildId: string | null): Promise<ResolvedActor>;
  /** Build a per-org signing api client for the resolved org. */
  apiFor(actor: ResolvedActor): GearFlowApiClient;
}

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  command: BotCommand,
  deps: RunnerDeps,
): Promise<void> {
  const actor = await deps.resolveActor(interaction.user.id, interaction.guildId);

  // Permission gate (live).
  const gate = command.requiredPermission;
  if (gate.kind !== "none" && !actor.link) {
    await interaction.reply({ content: botErrorMessage("NOT_LINKED"), ephemeral: true });
    return;
  }
  if (gate.kind === "gearflowRole" && !(actor.link?.role && gate.anyOf.includes(actor.link.role))) {
    await interaction.reply({
      content: botErrorMessage("FORBIDDEN", { requiredRole: gate.anyOf.join(" or "), actualRole: actor.link?.role }),
      ephemeral: true,
    });
    return;
  }

  const ctx: CommandContext = {
    interactionId: interaction.id,
    options: optionMap(interaction),
    actor,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    api: deps.apiFor(actor),
    async reply(o) {
      const ephemeral = o.ephemeral ?? command.defaultEphemeral;
      const payload = { content: o.content, embeds: o.embeds as never, files: mapFiles(o.files), ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload as never);
      else await interaction.reply(payload as never);
    },
    async defer(o) {
      await interaction.deferReply({ ephemeral: o?.ephemeral ?? command.defaultEphemeral });
    },
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  };

  try {
    await command.execute(ctx);
  } catch (err) {
    const message = err instanceof BotError ? botErrorMessage(err.code, err.details) : botErrorMessage("INTERNAL");
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message });
    else await interaction.reply({ content: message, ephemeral: true });
    if (!(err instanceof BotError)) console.error(err);
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
