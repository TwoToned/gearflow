import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { recordProjectChannelId } from "@/lib/services/channel-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/discord/v1/project/:id/channel  body: { discordChannelId }
 *
 * Idempotently records the created channel id (guard: only when currently null).
 * Returns the EFFECTIVE id so a losing concurrent creator can discard its channel.
 */
export const POST = withBotAuth<{ id: string }>(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  const body = (await ctx.request.json().catch(() => null)) as { discordChannelId?: unknown } | null;
  const channelId = typeof body?.discordChannelId === "string" ? body.discordChannelId : "";
  if (!channelId) {
    throw new DiscordApiError("VALIDATION", "discordChannelId is required.", {
      details: { field: "discordChannelId" },
    });
  }
  return recordProjectChannelId(ctx.params.id, ctx.organizationId, channelId);
});
