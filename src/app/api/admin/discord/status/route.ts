import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { getBotStatus } from "@/lib/discord/bot-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/discord/status — read the bot's running state.
 *
 * The bot runs in a separate process, so this derives status from the DB
 * heartbeat (fresh heartbeat + desiredState=RUNNING => running). Imports only
 * bot-control (prisma), never discord.js.
 */
export async function GET(): Promise<NextResponse> {
  await requirePermission("orgSettings", "read");
  return NextResponse.json(await getBotStatus());
}
