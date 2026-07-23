import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { withValidatedBody } from "@/lib/api-validation";
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

const promoteSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});

const promote = withValidatedBody(promoteSchema, async ({ token, email }) => {
  const enabled = env.SITE_ADMIN_REGISTRATION_ENABLED === "true";
  const secret = env.SITE_ADMIN_SECRET_TOKEN;

  if (!enabled || !secret || !safeTokenCompare(token, secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "admin" },
  });

  return NextResponse.json({ success: true });
});

export async function POST(request: NextRequest) {
  // Rate limit: 5 attempts per hour per IP
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = rateLimit(`admin-promote:${ip}`, 5, 3600_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  return promote(request);
}
