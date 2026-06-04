import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import {
  readOutboxEvents,
  recordDiscordHeartbeat,
} from "@/lib/services/outbox-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/outbox?since=<cursor>&limit=<n>&botUserId=<id>
 *
 * The bot's only stateful interaction: pull undelivered events for its org and
 * record a heartbeat. Gated by the global bot Bearer (no per-org HMAC — there's
 * no body to sign). Org comes from the `x-gearflow-org` header.
 */
export const GET = withBotAuth(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  const url = new URL(ctx.request.url);
  const sinceRaw = Number(url.searchParams.get("since") ?? "0");
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100;
  const botUserId = url.searchParams.get("botUserId");

  // Heartbeat on every poll; UI derives online/offline from lastHeartbeatAt.
  await recordDiscordHeartbeat(ctx.organizationId, botUserId);

  const events = await readOutboxEvents(ctx.organizationId, since, limit);
  const cursor = events.length > 0 ? events[events.length - 1].id : since;
  return { events, cursor };
});
