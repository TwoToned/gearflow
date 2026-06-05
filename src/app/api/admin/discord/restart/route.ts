import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { requestBotRestart } from "@/lib/discord/bot-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/discord/restart — ask the out-of-process bot to (re)start and
 * reload config. Writes intent to the DB (desiredState=RUNNING +
 * botRestartRequestedAt); the bot's supervisor loop actions it on its next tick.
 * Authenticated via Better Auth session + `orgSettings:update`.
 */
export async function POST(): Promise<NextResponse> {
  await requirePermission("orgSettings", "update");
  return NextResponse.json(await requestBotRestart());
}
