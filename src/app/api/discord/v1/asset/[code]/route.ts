import { getAssetForDiscord } from "@/lib/services/asset-service";
import { requireLinkedActor, withDiscordAuth } from "@/lib/discord/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/asset/:code — asset lookup for the bot's `/asset lookup`.
 * Per-org HMAC + a linked actor; enforces `asset:read` server-side.
 */
export const GET = withDiscordAuth<{ code: string }>(async (ctx) => {
  const actor = requireLinkedActor(ctx);
  const code = decodeURIComponent(ctx.params.code);
  return getAssetForDiscord(actor, code);
});
