import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { restartBot, getBotState } from "@/lib/discord/bot-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/discord/restart — restarts the in-process bot. Authenticated
 * via the user's Better Auth session + `orgSettings:update` permission, exactly
 * like the server-actions path. Lives as an API route (not a server action)
 * so the client bundle never traces the discord.js import graph.
 */
export async function POST(): Promise<NextResponse> {
  await requirePermission("orgSettings", "update");
  await restartBot();
  return NextResponse.json(getBotState());
}
