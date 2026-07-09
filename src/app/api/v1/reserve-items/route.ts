import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope } from "@/lib/api/http";
import { reserveItems } from "@/lib/api/reserve-items";
import { convexReservationPort } from "@/lib/api/reserve-port";

const V1 = { "X-RVLT-Api-Version": "v1" };

/**
 * POST /api/v1/reserve-items
 *
 * The REST facade for the `reserve_items` capability verb. Body:
 *   { projectId, items: [{ modelId, quantity }], confirm?, idempotencyKey? }
 * confirm=false (default) previews availability without writing; confirm=true
 * commits and requires an idempotencyKey (also accepted via the Idempotency-Key
 * header). Auth: `Authorization: Bearer <api key>`. Errors use the shared envelope.
 * See docs/designs/api-mcp-agent-access.md.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticateApiRequest(request.headers.get("authorization"));
    const body = await request.json().catch(() => ({}));

    const result = await reserveItems(
      actor,
      {
        projectId: body.projectId,
        items: body.items,
        confirm: body.confirm === true,
        idempotencyKey:
          body.idempotencyKey ?? request.headers.get("idempotency-key") ?? undefined,
      },
      convexReservationPort,
    );

    return NextResponse.json(result, { headers: V1 });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, { status, headers: V1 });
  }
}
