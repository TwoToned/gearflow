import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { ackOutboxEvents } from "@/lib/services/outbox-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/discord/v1/outbox/ack  body: { ids: number[] }
 *
 * The bot acks events it has applied so subsequent polls skip them. Idempotent
 * and org-scoped — re-acking or acking another org's rows is a safe no-op.
 */
export const POST = withBotAuth(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  const body = (await ctx.request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((n): n is number => Number.isInteger(n))
    : null;
  if (!ids) {
    throw new DiscordApiError("VALIDATION", "Body must be { ids: number[] }.", {
      details: { field: "ids" },
    });
  }
  const acked = await ackOutboxEvents(ctx.organizationId, ids);
  return { acked };
});
