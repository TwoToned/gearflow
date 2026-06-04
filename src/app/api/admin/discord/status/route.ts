import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { getBotState } from "@/lib/discord/bot-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/discord/status — read the in-process bot's running state.
 * Separated from getDiscordIntegrationSettings so the client never imports a
 * server module that transitively imports discord.js (which Turbopack's client
 * bundler can't trace through).
 */
export async function GET(): Promise<NextResponse> {
  await requirePermission("orgSettings", "read");
  return NextResponse.json(getBotState());
}
