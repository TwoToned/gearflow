import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { stopBot, getBotState } from "@/lib/discord/bot-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  await requirePermission("orgSettings", "update");
  await stopBot();
  return NextResponse.json(getBotState());
}
