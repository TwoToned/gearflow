import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withValidatedBody } from "@/lib/api-validation";

// Simple in-memory rate limiter: 5 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const orgLookup = withValidatedBody(
  z.object({ email: z.string().email() }),
  async ({ email }) => {
    const normalized = email.toLowerCase().trim();
    const domain = normalized.split("@")[1];

    // Find SSO providers matching this email domain
    const providers = await prisma.ssoProvider.findMany({
      where: { domain },
      select: {
        organizationId: true,
        organization: {
          select: { slug: true, name: true },
        },
      },
    });

    // Deduplicate by org and only return orgs that exist
    const orgMap = new Map<string, { orgSlug: string; orgName: string; hasSSO: boolean }>();
    for (const p of providers) {
      if (p.organizationId && p.organization) {
        orgMap.set(p.organizationId, {
          orgSlug: p.organization.slug,
          orgName: p.organization.name,
          hasSSO: true,
        });
      }
    }

    return NextResponse.json({ orgs: Array.from(orgMap.values()) });
  },
);

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  return orgLookup(request);
}
