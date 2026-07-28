import type { NextRequest } from "next/server";
import { dispatchAlias, NO_EXTRA_ARGS } from "@/lib/api/alias";

export const runtime = "nodejs";

/** `GET /api/v1/clients` — curated alias for `clients.list` (design §11). */
export async function GET(request: NextRequest) {
  return dispatchAlias("clients.list", NO_EXTRA_ARGS, request);
}
