/**
 * Test harness: build a CommandContext with spy-able reply/defer and a stubbed
 * api client, so a command's execute() can be asserted with ZERO Discord and ZERO
 * network. This is the payoff of keeping the command contract framework-free.
 */
import type { CommandContext, GearFlowApiClient, ReplyOptions, ResolvedActor } from "./types.js";

export interface MockContext extends CommandContext {
  readonly replies: ReplyOptions[];
  readonly deferred: { ephemeral?: boolean }[];
  readonly logs: { event: string; fields?: Record<string, unknown> }[];
}

export interface MockContextOptions {
  options?: Record<string, string | undefined>;
  actor?: Partial<ResolvedActor>;
  guildId?: string | null;
  channelId?: string | null;
  api?: Partial<GearFlowApiClient>;
}

export function makeMockContext(opts: MockContextOptions = {}): MockContext {
  const replies: ReplyOptions[] = [];
  const deferred: { ephemeral?: boolean }[] = [];
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];

  const api: GearFlowApiClient = {
    get: opts.api?.get ?? (async () => ({}) as never),
    post: opts.api?.post ?? (async () => ({}) as never),
  };

  const actor: ResolvedActor = {
    discordUserId: opts.actor?.discordUserId ?? "discord_123",
    link:
      opts.actor?.link ??
      (opts.actor && "link" in opts.actor
        ? null
        : { organizationId: "org_1", crewMemberId: "crew_1", role: "staff" }),
  };

  return {
    interactionId: "interaction_1",
    options: opts.options ?? {},
    actor,
    guildId: opts.guildId ?? "guild_1",
    channelId: opts.channelId ?? "channel_1",
    api,
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
