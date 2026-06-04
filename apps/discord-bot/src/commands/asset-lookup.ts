/**
 * /asset lookup [code] — read-only. Reference implementation for the command
 * contract: declarative gate, ephemeral by default, all data via the api client,
 * zero discord.js in execute() so it's unit-testable against a mock context.
 */
import type { BotCommand, CommandContext } from "../types.js";

interface AssetLookupResult {
  assetTag: string;
  description: string;
  status: string;
  testTagStatus: string | null;
  currentProject: { projectNumber: string; name: string } | null;
}

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

    const asset = await ctx.api.get<AssetLookupResult>(`/asset/${encodeURIComponent(code)}`);

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
