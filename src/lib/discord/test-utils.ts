/**
 * Test harness for commands. Builds a CommandContext with spy-able reply/defer
 * and an injected ServiceActor, so a command's execute() runs with zero Discord
 * (and the service it calls runs against a mock db / test prisma).
 */
import type { CommandContext, ReplyOptions } from "./bot-types";
import type { ServiceActor } from "@/lib/services/discord-actor";

export interface MockContext extends CommandContext {
  readonly replies: ReplyOptions[];
  readonly deferred: { ephemeral?: boolean }[];
  readonly logs: { event: string; fields?: Record<string, unknown> }[];
}

export interface MockContextOptions {
  options?: Record<string, string | undefined>;
  actor?: ServiceActor | null;
  organizationId?: string;
  discordUserId?: string;
  guildId?: string | null;
  channelId?: string | null;
  interactionId?: string;
}

export function makeMockContext(opts: MockContextOptions = {}): MockContext {
  const replies: ReplyOptions[] = [];
  const deferred: { ephemeral?: boolean }[] = [];
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];

  return {
    interactionId: opts.interactionId ?? "interaction_1",
    options: opts.options ?? {},
    organizationId: opts.organizationId ?? "org_1",
    discordUserId: opts.discordUserId ?? "discord_123",
    actor: opts.actor === undefined ? null : opts.actor,
    guildId: opts.guildId ?? "guild_1",
    channelId: opts.channelId ?? "channel_1",
    replies,
    deferred,
    logs,
    async reply(o) {
      replies.push(o);
    },
    async defer(o) {
      deferred.push(o ?? {});
    },
    log(event, fields) {
      logs.push({ event, fields });
    },
  };
}
