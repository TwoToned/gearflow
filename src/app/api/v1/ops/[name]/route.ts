import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope } from "@/lib/api/http";
import { invokeOperation } from "@/lib/api/dispatch";

export const runtime = "nodejs";

const V1 = { "X-GearFlow-API-Version": "v1" };

/**
 * POST /api/v1/ops/:name — invoke any operation the app exposes.
 *
 * Body: `{ arguments?: {...}, confirm?: boolean, idempotencyKey?: string }`
 * (an `Idempotency-Key` header works too). Arguments are keyed by parameter name —
 * `GET /api/v1/operations/:name` returns the signature.
 *
 * The operation runs the same guarded server action the web UI runs, as the key's
 * acting user. Irreversible and stock-affecting writes require `confirm: true` and
 * an idempotencyKey; anything else commits directly. Errors use the shared envelope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const actor = await authenticateApiRequest(request.headers.get("authorization"));
    const { name } = await params;
    const body = await request.json().catch(() => ({}));

    const result = await invokeOperation(actor, {
      operation: decodeURIComponent(name),
      arguments: body.arguments ?? {},
      confirm: body.confirm === true,
      idempotencyKey:
        body.idempotencyKey ?? request.headers.get("idempotency-key") ?? undefined,
    });

    return NextResponse.json(result, { headers: V1 });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, { status, headers: V1 });
  }
}
