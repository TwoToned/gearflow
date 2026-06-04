import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { getProjectChannelSpec } from "@/lib/services/channel-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/project/:id/channel-spec — the desired channel state the
 * bot converges to (name, archive flag, existing channel id, linked member set,
 * pending-access count). Bearer-gated system read.
 */
export const GET = withBotAuth<{ id: string }>(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  return getProjectChannelSpec(ctx.params.id, ctx.organizationId);
});
