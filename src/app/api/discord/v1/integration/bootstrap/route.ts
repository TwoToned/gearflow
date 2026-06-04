import { DiscordApiError } from "@/lib/discord/api-errors";
import { withBotAuth } from "@/lib/discord/route-auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret, isEncrypted, SecretVaultError } from "@/lib/crypto/secret-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/discord/v1/integration/bootstrap — the one-call config drop the bot
 * reads on startup. Returns EVERY field needed to login to Discord and to sign
 * subsequent per-org requests, including the decrypted Discord bot token.
 *
 * Auth: global bot Bearer only (withBotAuth). The Bearer is the deployment-level
 * trust root; if it's stolen, an attacker can already read the outbox + post acks,
 * so handing them the Discord token via this route is not a fresh exposure. We
 * document this in the route comment so future maintainers don't add a second
 * gate that doesn't help.
 *
 * Single-org-per-process for v1: the caller passes `x-gearflow-org`. Multi-org
 * deployments will need an enabled-integration enumeration endpoint later.
 */
export const GET = withBotAuth(async (ctx) => {
  if (!ctx.organizationId) {
    throw new DiscordApiError("VALIDATION", "Missing x-gearflow-org header.");
  }
  const row = await prisma.discordIntegration.findUnique({
    where: { organizationId: ctx.organizationId },
    select: {
      isEnabled: true,
      signingSecret: true,
      discordBotToken: true,
      discordApplicationId: true,
      guildId: true,
      projectCategoryId: true,
      archiveCategoryId: true,
      alertChannelId: true,
      auditChannelId: true,
      channelCreateOnStatuses: true,
      channelArchiveOnStatuses: true,
      postWelcomeOnCreate: true,
      postFaultsToProjectChannel: true,
      botUserId: true,
    },
  });
  if (!row) {
    throw new DiscordApiError("ORG_NOT_CONFIGURED", "No Discord integration for this org.");
  }

  // Decrypt the bot token if present. If decrypt fails (e.g. BETTER_AUTH_SECRET
  // rotated since the token was stored), surface a clear error so the operator
  // knows to re-paste the token on the admin page rather than getting a confusing
  // Discord login failure.
  let discordBotToken: string | null = null;
  if (row.discordBotToken) {
    if (!isEncrypted(row.discordBotToken)) {
      throw new DiscordApiError("INTERNAL", "Stored Discord bot token is not in the expected format.");
    }
    try {
      discordBotToken = decryptSecret(row.discordBotToken);
    } catch (err) {
      if (err instanceof SecretVaultError) {
        throw new DiscordApiError(
          "INTERNAL",
          "Failed to decrypt the stored Discord bot token. Re-paste it on the admin page.",
        );
      }
      throw err;
    }
  }

  return {
    isEnabled: row.isEnabled,
    signingSecret: row.signingSecret,
    discordBotToken,
    discordApplicationId: row.discordApplicationId,
    guildId: row.guildId,
    projectCategoryId: row.projectCategoryId,
    archiveCategoryId: row.archiveCategoryId,
    alertChannelId: row.alertChannelId,
    auditChannelId: row.auditChannelId,
    channelCreateOnStatuses: row.channelCreateOnStatuses,
    channelArchiveOnStatuses: row.channelArchiveOnStatuses,
    postWelcomeOnCreate: row.postWelcomeOnCreate,
    postFaultsToProjectChannel: row.postFaultsToProjectChannel,
    botUserId: row.botUserId,
  };
});
