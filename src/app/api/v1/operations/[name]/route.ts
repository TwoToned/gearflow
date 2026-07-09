import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, toErrorEnvelope } from "@/lib/api/http";
import { describeOperation } from "@/lib/api/dispatch";

export const runtime = "nodejs";

const V1 = { "X-GearFlow-API-Version": "v1" };

/**
 * GET /api/v1/operations/:name — the full call signature for one operation:
 * parameters (name, type, required), required scope, and whether it needs
 * `confirm: true`. Call this before POSTing to /api/v1/ops/:name.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    await authenticateApiRequest(request.headers.get("authorization"));
    const { name } = await params;
    return NextResponse.json(describeOperation(decodeURIComponent(name)), { headers: V1 });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err);
    return NextResponse.json(body, { status, headers: V1 });
  }
}
