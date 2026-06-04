/**
 * Discord-facing error copy. Used by the runner to render thrown
 * `DiscordApiError`s as ephemeral replies. The bot is in-process now, so we
 * can switch on the error code directly without a separate BotError class.
 */
import type { DiscordApiErrorCode } from "@/lib/discord/api-errors";

/** Map a code → user-facing copy. Exhaustive via `never` default. */
export function botErrorMessage(
  code: DiscordApiErrorCode,
  details?: Record<string, unknown>,
): string {
  switch (code) {
    case "NOT_LINKED":
      return "Your Discord account isn't linked to GearFlow yet. Run `/link your@email.com` to connect — you'll get an email to confirm.";
    case "FORBIDDEN": {
      const required = details?.requiredRole;
      const actual = details?.actualRole;
      if (required) {
        return `This needs the **${required}** role${actual ? ` (you're **${actual}**)` : ""}. Ask a PM or admin to update your assignment.`;
      }
      return "You don't have permission to do that. Ask a PM or admin to update your role.";
    }
    case "ORG_NOT_CONFIGURED":
      return "This server isn't connected to a GearFlow organisation yet. An admin needs to finish setup in GearFlow → Settings → Discord.";
    case "ASSET_NOT_FOUND":
      return `No asset matches **${details?.code ?? "that code"}**. Check the asset tag (e.g. \`TTP-042\`) and try again.`;
    case "ASSET_OUT_OF_SERVICE":
      return `**${details?.code ?? "That asset"}** is flagged out of service and can't be used. Run \`/asset lookup ${details?.code ?? ""}\` for details.`;
    case "PROJECT_NOT_FOUND":
      return "This channel isn't linked to a GearFlow project. Run this in a project channel, or ask an admin to sync it.";
    case "VALIDATION":
      return `That didn't look right${details?.field ? ` (check **${details.field}**)` : ""}. Fix the input and try again.`;
    case "RATE_LIMITED": {
      const retryAfter = details?.retryAfterSeconds;
      return `Too many attempts. Try again${retryAfter ? ` in **${retryAfter}s**` : " shortly"}.`;
    }
    case "CONFLICT":
      return "That's already done or conflicts with the current state. Check `/project info` or `/asset lookup` for the latest.";
    case "IDEMPOTENCY_CONFLICT":
      return "Looks like that action was already submitted. No changes were made twice.";
    case "SIGNATURE_INVALID":
      return "I couldn't authenticate that request. This is a bot config issue — please tell an admin.";
    case "INTERNAL":
      return "Something went wrong on GearFlow's side. Try again in a moment; if it persists, tell an admin.";
    default: {
      const _exhaustive: never = code;
      return `Unexpected error (${String(_exhaustive)}).`;
    }
  }
}
