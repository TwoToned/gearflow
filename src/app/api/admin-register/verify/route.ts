import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { env } from "@/env";

function safeTokenCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Rate limit: 5 attempts per hour per IP
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = rateLimit(`admin-register:${ip}`, 5, 3600_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  const token = request.nextUrl.searchParams.get("token");

  const enabled = env.SITE_ADMIN_REGISTRATION_ENABLED === "true";
  const secret = env.SITE_ADMIN_SECRET_TOKEN;

  if (!enabled || !secret || !token || !safeTokenCompare(token, secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ valid: true });
}
