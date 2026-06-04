/**
 * Discord-facing error rendering.
 *
 * The code union MUST mirror `src/lib/discord/api-errors.ts` in the GearFlow app
 * (DISCORD_API_ERROR_CODES). When the two services share a package this becomes a
 * single import; until then, keep them in sync — the contract test below + the
 * exhaustive `never` switch guarantee a new code can't ship without copy here.
 *
 * Copy follows problem → cause → fix (per /autoplan DX review).
 */

export const BOT_ERROR_CODES = [
  "NOT_LINKED",
  "FORBIDDEN",
  "ORG_NOT_CONFIGURED",
  "ASSET_NOT_FOUND",
  "ASSET_OUT_OF_SERVICE",
  "PROJECT_NOT_FOUND",
  "VALIDATION",
  "RATE_LIMITED",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "SIGNATURE_INVALID",
  "INTERNAL",
] as const;

export type BotErrorCode = (typeof BOT_ERROR_CODES)[number];

/** Thrown by the api client when an endpoint returns an error envelope. */
export class BotError extends Error {
  readonly code: BotErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BotErrorCode,
    message: string,
    opts?: { retryable?: boolean; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "BotError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.details = opts?.details;
  }
}

/**
 * Map a code to the message shown ephemerally to the Discord user.
 * Exhaustive: the `never` default makes adding a code to the union a compile error
 * here until copy is provided.
 */
export function botErrorMessage(code: BotErrorCode, details?: Record<string, unknown>): string {
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
      return "I couldn't authenticate with GearFlow. This is a bot config issue — please tell an admin.";
    case "INTERNAL":
      return "Something went wrong on GearFlow's side. Try again in a moment; if it persists, tell an admin.";
    default: {
      const _exhaustive: never = code;
      return `Unexpected error (${_exhaustive}).`;
    }
  }
}
