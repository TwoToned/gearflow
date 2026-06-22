import { NextResponse } from "next/server";
import { getSiteSettingsFromConvex } from "@/lib/site-settings-read";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSiteSettingsFromConvex();
  return NextResponse.json({ policy: settings.registrationPolicy });
}
