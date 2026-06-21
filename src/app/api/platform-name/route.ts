import { NextResponse } from "next/server";
import { env } from "@/env";

/**
 * Platform branding for client readers (sidebar, top bar, favicon, auth pages).
 *
 * OVERRIDE: the brand name comes from env (`PLATFORM_NAME`, default "RVLT Flow")
 * and the icon is intentionally null — the DB `SiteSettings.platformName/Icon`
 * row is NOT used for display. The product brand is RVLT Flow; the sidebar
 * renders the RvltFlowLogo for the default brand.
 */
export async function GET() {
  return NextResponse.json({
    name: env.PLATFORM_NAME,
    icon: null,
  });
}
