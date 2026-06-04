import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto/secret-vault";
import { deployCommands } from "@/lib/discord/deploy-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/discord/deploy-commands — pushes the slash command registry
 * to Discord using the stored bot token + app id + guild id. Lives as an API
 * route (not a server action) so the client bundle never traces the discord.js
 * import graph. Same `orgSettings:update` gate, same logActivity row.
 */
export async function POST(): Promise<NextResponse> {
  const { organizationId, userId, userName } = await requirePermission(
    "orgSettings",
    "update",
  );
  const row = await prisma.discordIntegration.findUnique({ where: { organizationId } });
  if (!row) {
    return NextResponse.json(
      { error: "Discord integration is not configured yet." },
      { status: 400 },
    );
  }
  const missing: string[] = [];
  if (!row.discordBotToken) missing.push("bot token");
  if (!row.discordApplicationId) missing.push("application id");
  if (!row.guildId) missing.push("guild id");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Cannot deploy commands — missing: ${missing.join(", ")}. Fill these in above and save first.` },
      { status: 400 },
    );
  }
  let token: string;
  try {
    token = decryptSecret(row.discordBotToken!);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt the stored Discord bot token. Re-paste it and try again." },
      { status: 500 },
    );
  }

  const result = await deployCommands({
    discordBotToken: token,
    discordApplicationId: row.discordApplicationId!,
    guildId: row.guildId!,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "discord_integration",
    entityId: row.id,
    entityName: "Discord Integration",
    summary: `Deployed ${result.deployed} slash commands to guild`,
    details: { commands: result.commandNames },
  });

  return NextResponse.json(result);
}
