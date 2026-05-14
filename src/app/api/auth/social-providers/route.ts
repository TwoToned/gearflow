import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";

/**
 * Returns which social login providers are available.
 * A provider is available if:
 * 1. Its env vars are configured (GOOGLE_CLIENT_ID, etc.)
 * 2. It's enabled in SiteSettings (socialLoginGoogle, socialLoginMicrosoft)
 */
export async function GET() {
  const settings = await prisma.siteSettings.findFirst();

  const providers: string[] = [];
  if (env.GOOGLE_CLIENT_ID && settings?.socialLoginGoogle) {
    providers.push("google");
  }
  if (env.MICROSOFT_CLIENT_ID && settings?.socialLoginMicrosoft) {
    providers.push("microsoft");
  }
  return NextResponse.json({ providers });
}
