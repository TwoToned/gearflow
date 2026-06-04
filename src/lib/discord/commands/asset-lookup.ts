/**
 * `/asset lookup [code]` — read-only. Calls `getAssetForDiscord` directly (in-process).
 */
import type { BotCommand, CommandContext } from "../bot-types";
import { getAssetForDiscord } from "@/lib/services/asset-service";

export const command: BotCommand = {
  data: {
    name: "asset",
    description: "Look up a GearFlow asset by code",
    options: [
      { name: "code", description: "Asset tag, e.g. TTP-042", type: "string", required: true },
    ],
  },
  requiredPermission: { kind: "linkedUser" },
  defaultEphemeral: true,
  async execute(ctx: CommandContext): Promise<void> {
    const code = (ctx.options.code ?? "").trim();
    if (!code) {
      await ctx.reply({ content: "Provide an asset code, e.g. `/asset code:TTP-042`." });
      return;
    }
    await ctx.defer({ ephemeral: true });
    ctx.log("asset.lookup", { code });

    // actor is non-null because requiredPermission gates linkedUser.
    const asset = await getAssetForDiscord(ctx.actor!, code);

    await ctx.reply({
      embeds: [
        {
          title: `${asset.assetTag} — ${asset.description}`,
          fields: [
            { name: "Status", value: asset.status, inline: true },
            { name: "Test & Tag", value: asset.testTagStatus ?? "—", inline: true },
            {
              name: "Assigned to",
              value: asset.currentProject
                ? `${asset.currentProject.projectNumber} · ${asset.currentProject.name}`
                : "Not assigned",
            },
          ],
        },
      ],
    });
  },
};
