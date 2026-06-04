import { NextResponse } from "next/server";
import { DISCORD_API_VERSION } from "@/lib/discord/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/health — unauthenticated liveness probe so the bot's
 * `doctor` and any external monitor can confirm the app is reachable without
 * burning a signed request. No data leaks (just version + status).
 */
export async function GET() {
  return NextResponse.json({ ok: true, status: "up", apiVersion: DISCORD_API_VERSION });
}
