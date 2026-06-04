import { withDiscordAuth } from "@/lib/discord/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/me — resolve the actor for the signed Discord invoker.
 *
 * This is what the bot's `RunnerDeps.resolveActor` calls on every interaction.
 * It returns the LIVE link state (never cached), so a demotion/unlink takes
 * effect on the next slash command. Unlinked Discord users get `link: null`
 * (the permission gate in the bot's runner then handles NOT_LINKED).
 */
export const GET = withDiscordAuth(async (ctx) => {
  if (!ctx.actor) {
    return { discordUserId: ctx.actorDiscordUserId, link: null };
  }
  return {
    discordUserId: ctx.actor.discordUserId,
    link: {
      organizationId: ctx.actor.organizationId,
      crewMemberId: ctx.actor.crewMemberId,
      role: ctx.actor.role,
      userName: ctx.actor.userName,
    },
  };
});
