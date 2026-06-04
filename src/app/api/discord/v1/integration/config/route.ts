import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/integration/config — bootstrap config the bot reads on
 * startup (and periodically refreshes — admins may change the category id from
 * the settings page without restarting the bot).
 *
 * Bearer-only (system read; no per-user actor). The bot already has the org's
 * signingSecret out of band (env), so we don't return it here.
 */
export const GET = withBotAuth(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  const integration = await prisma.discordIntegration.findUnique({
    where: { organizationId: ctx.organizationId },
    select: {
      isEnabled: true,
      guildId: true,
      projectCategoryId: true,
      alertChannelId: true,
      auditChannelId: true,
      botUserId: true,
    },
  });
  if (!integration) {
    throw new DiscordApiError("ORG_NOT_CONFIGURED", "No Discord integration for this org.");
  }
  return integration;
});
