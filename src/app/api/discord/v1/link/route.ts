import { DiscordApiError } from "@/lib/discord/api-errors";
import { withDiscordAuth } from "@/lib/discord/route-auth";
import { startDiscordLink } from "@/lib/services/discord-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/discord/v1/link  body: { email }
 *
 * Starts enrollment for the invoking (signed) Discord user. The response is
 * CONSTANT ("pending") whether or not the email matched — no enumeration oracle.
 * The only non-constant branch is "already_linked", which is about the caller's
 * own account and safe to reveal. All hardening lives in startDiscordLink.
 */
export const POST = withDiscordAuth(async (ctx) => {
  if (!ctx.actorDiscordUserId) {
    throw new DiscordApiError("VALIDATION", "Missing Discord actor.");
  }
  const body = (ctx.json ?? {}) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email : "";
  if (!email.trim()) {
    throw new DiscordApiError("VALIDATION", "An email is required.", { details: { field: "email" } });
  }

  return startDiscordLink({
    organizationId: ctx.organizationId,
    discordUserId: ctx.actorDiscordUserId,
    email,
  });
});
