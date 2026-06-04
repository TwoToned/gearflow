import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { getCrewActiveProjects } from "@/lib/services/channel-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/crew/:crewMemberId/channels — the crew member's linked
 * Discord id + their active project ids. Drives retroactive channel grants when a
 * crew member links AFTER being assigned (discord.link.confirmed).
 */
export const GET = withBotAuth<{ crewMemberId: string }>(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  return getCrewActiveProjects(ctx.params.crewMemberId, ctx.organizationId);
});
