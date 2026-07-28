import { NextResponse, type NextRequest } from "next/server";
import { dispatchAlias } from "@/lib/api/alias";
import { toErrorEnvelope } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * `POST /api/v1/projects/{id}/line-items` — curated alias for
 * `lineItemWrites.addNative` (design §11). Body: the SAME envelope
 * `/ops/{operation}` takes — `{"args": {"fields": {...}, ...}, "idempotencyKey":
 * "..."}` — with `projectId` merged in from the path, so the caller never
 * repeats the id that's already in the URL.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = request.headers.get("x-request-id");

  let body: { args?: Record<string, unknown>; idempotencyKey?: string };
  const text = await request.text();
  try {
    body = text.length ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      toErrorEnvelope(Object.assign(new Error("Invalid JSON body."), { code: "VALIDATION_FAILED" }), { requestId }),
      { status: 400 },
    );
  }

  return dispatchAlias(
    "lineItemWrites.addNative",
    { ...(body.args ?? {}), projectId: id },
    request,
    { idempotencyKey: body.idempotencyKey },
  );
}
