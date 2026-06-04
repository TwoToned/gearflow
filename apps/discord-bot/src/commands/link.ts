/**
 * /link [email] — starts GearFlow account enrollment. Open to anyone in the guild
 * (the invoker is by definition not yet linked). Always ephemeral. The server
 * returns a CONSTANT result for unmatched emails, so this command renders one
 * fixed "if that email is on file…" message and never reveals whether the email
 * exists. The only non-constant branch is "already_linked" (the caller's own
 * account, safe to show).
 */
import type { BotCommand, CommandContext } from "../types.js";

interface StartLinkResponse {
  status: "already_linked" | "pending";
  linkedToName?: string;
}

export const command: BotCommand = {
  data: {
    name: "link",
    description: "Connect your Discord account to your GearFlow crew profile",
    options: [
      { name: "email", description: "The email on your GearFlow crew profile", type: "string", required: true },
    ],
  },
  requiredPermission: { kind: "none" },
  defaultEphemeral: true,
  async execute(ctx: CommandContext): Promise<void> {
    const email = (ctx.options.email ?? "").trim();
    if (!email) {
      await ctx.reply({ content: "Provide your email, e.g. `/link email:you@example.com`." });
      return;
    }

    await ctx.defer({ ephemeral: true });
    ctx.log("link.start");

    const res = await ctx.api.post<StartLinkResponse>("/link", { email });

    if (res.status === "already_linked") {
      await ctx.reply({
        content: `You're already linked${res.linkedToName ? ` as **${res.linkedToName}**` : ""}. If that's wrong, ask an admin to unlink you first.`,
      });
      return;
    }

    await ctx.reply({
      content:
        "If that email is on a GearFlow crew profile, I've sent a confirmation link to it. Open the email and click **Confirm Discord link** — it expires shortly and works once.",
    });
  },
};
