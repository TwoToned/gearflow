import { DiscordApiError } from "@/lib/discord/api-errors";
import { requireLinkedActor, withDiscordAuth } from "@/lib/discord/route-auth";
import { reportAssetFault } from "@/lib/services/asset-fault-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/discord/v1/asset/:code/fault
 * body: { description, severity: "MINOR"|"MAJOR", holdForRepair?: boolean }
 *
 * Any linked crew may file; the holdForRepair status flip needs maintenance:create.
 * Idempotent on the Discord interaction id (Idempotency-Key header).
 */
export const POST = withDiscordAuth<{ code: string }>(async (ctx) => {
  const actor = requireLinkedActor(ctx);
  const body = (ctx.json ?? {}) as {
    description?: unknown;
    severity?: unknown;
    holdForRepair?: unknown;
  };
  const description = typeof body.description === "string" ? body.description : "";
  const severity = body.severity === "MAJOR" ? "MAJOR" : body.severity === "MINOR" ? "MINOR" : null;
  if (!severity) {
    throw new DiscordApiError("VALIDATION", "Severity must be MINOR or MAJOR.", {
      details: { field: "severity" },
    });
  }

  return reportAssetFault(actor, {
    code: decodeURIComponent(ctx.params.code),
    description,
    severity,
    holdForRepair: body.holdForRepair === true,
    idempotencyKey: ctx.idempotencyKey,
  });
});
