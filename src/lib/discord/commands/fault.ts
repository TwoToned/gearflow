/**
 * `/fault` — logs an asset fault as a DamageEvent. Open to any linked crew
 * (product intent: report from your phone); the server gates the "take out of
 * service" status flip on `maintenance:create`.
 *
 * v1 uses slash-command options (not a modal — modals can't hold file uploads).
 * The confirmation posts in-channel (shared state), per the design review.
 * Idempotent on the Discord interaction id.
 */
import type { BotCommand, CommandContext } from "../bot-types";
import { reportAssetFault } from "@/lib/services/asset-fault-service";

export const command: BotCommand = {
  data: {
    name: "fault",
    description: "Log a fault against a GearFlow asset",
    options: [
      { name: "code", description: "Asset tag, e.g. TTP-042", type: "string", required: true },
      { name: "description", description: "What's wrong with it", type: "string", required: true },
      {
        name: "severity",
        description: "How bad is it",
        type: "string",
        required: true,
        choices: [
          { name: "Minor", value: "MINOR" },
          { name: "Major", value: "MAJOR" },
        ],
      },
      {
        name: "hold",
        description: "Take it out of service for repair (needs maintenance permission)",
        type: "boolean",
      },
    ],
  },
  requiredPermission: { kind: "linkedUser" },
  defaultEphemeral: false,
  async execute(ctx: CommandContext): Promise<void> {
    const code = (ctx.options.code ?? "").trim();
    const description = (ctx.options.description ?? "").trim();
    const severity = ctx.options.severity === "MAJOR" ? "MAJOR" : "MINOR";
    const holdForRepair = ctx.options.hold === "true";

    if (!code || !description) {
      await ctx.reply({ content: "Provide both an asset code and a description.", ephemeral: true });
      return;
    }
    await ctx.defer();
    ctx.log("asset.fault", { code, severity, holdForRepair });

    // actor is non-null because requiredPermission gates linkedUser.
    const res = await reportAssetFault(ctx.actor!, {
      code,
      description,
      severity,
      holdForRepair,
      idempotencyKey: ctx.interactionId,
    });

    const statusLine = res.statusChanged
      ? `Taken out of service → **${res.newStatus}**`
      : res.holdForRepair
        ? "Could not auto-hold (it may be checked out) — flagged for repair on return"
        : "Status unchanged";

    await ctx.reply({
      embeds: [
        {
          title: `🔧 Fault logged — ${res.assetTag}`,
          description,
          fields: [
            { name: "Severity", value: res.severity, inline: true },
            { name: "Status", value: statusLine, inline: true },
          ],
          footer: res.idempotentReplay ? { text: "Already logged — no duplicate created." } : undefined,
        },
      ],
    });
  },
};
