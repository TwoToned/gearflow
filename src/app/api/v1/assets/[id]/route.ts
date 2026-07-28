import type { NextRequest } from "next/server";
import { dispatchAlias } from "@/lib/api/alias";

export const runtime = "nodejs";

/** `GET /api/v1/assets/{id}` — curated alias for `assets.getById` (design §11). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return dispatchAlias("assets.getById", { id }, request);
}
