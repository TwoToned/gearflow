import type { NextRequest } from "next/server";
import { dispatchAlias, NO_EXTRA_ARGS } from "@/lib/api/alias";

export const runtime = "nodejs";

/** `GET /api/v1/assets` — curated alias for `assets.list` (design §11). */
export async function GET(request: NextRequest) {
  return dispatchAlias("assets.list", NO_EXTRA_ARGS, request);
}
