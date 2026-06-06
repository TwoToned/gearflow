import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { requestBotStop } from "@/lib/discord/bot-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/discord/stop — ask the out-of-process bot to stop and stay
 * stopped (desiredState=STOPPED). The supervisor loop stops it on its next tick;
 * status flips to not-running immediately because running requires
 * desiredState=RUNNING.
 */
export async function POST(): Promise<NextResponse> {
  await requirePermission("orgSettings", "update");
  return NextResponse.json(await requestBotStop());
}
