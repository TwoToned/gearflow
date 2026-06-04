/**
 * Discord internal-API error contract.
 *
 * Locked BEFORE any command or endpoint is written (per /autoplan DX review):
 * retrofitting machine-readable codes after commands ship is a breaking change
 * across the whole bot. This module is FRAMEWORK-FREE on purpose — both the
 * Next.js routes (`src/app/api/discord/v1/*`) and the standalone bot import the
 * same `DiscordApiErrorCode` union and switch on it exhaustively (with a
 * `never` default) so a new code cannot ship without Discord-facing copy.
 *
 * NOTE: this is a plain `src/lib/*` module, NOT a `"use server"` file. Never
 * re-export these types from a server-action module (Next's transform emits a
 * runtime reference that crashes SSR — see CLAUDE.md).
 */

/** Closed set of error codes the bot branches on. Keep in sync with the bot. */
export const DISCORD_API_ERROR_CODES = [
  "NOT_LINKED", // Discord user has no DiscordAccountLink in this org
  "FORBIDDEN", // linked, but lacks the required GearFlow role/permission
  "ORG_NOT_CONFIGURED", // no enabled DiscordIntegration for this guild/org
  "ASSET_NOT_FOUND", // asset code did not resolve
  "ASSET_OUT_OF_SERVICE", // asset is unavailable for the requested action
  "PROJECT_NOT_FOUND",
  "VALIDATION", // request body failed validation
  "RATE_LIMITED", // too many attempts (e.g. /link)
  "CONFLICT", // state conflict (e.g. already linked)
  "IDEMPOTENCY_CONFLICT", // same Idempotency-Key, different payload
  "SIGNATURE_INVALID", // HMAC / auth failed
  "INTERNAL", // unexpected server error
] as const;

export type DiscordApiErrorCode = (typeof DISCORD_API_ERROR_CODES)[number];

/** Default HTTP status + retryability per code. */
const CODE_META: Record<DiscordApiErrorCode, { status: number; retryable: boolean }> = {
  NOT_LINKED: { status: 403, retryable: false },
  FORBIDDEN: { status: 403, retryable: false },
  ORG_NOT_CONFIGURED: { status: 409, retryable: false },
  ASSET_NOT_FOUND: { status: 404, retryable: false },
  ASSET_OUT_OF_SERVICE: { status: 409, retryable: false },
  PROJECT_NOT_FOUND: { status: 404, retryable: false },
  VALIDATION: { status: 400, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  CONFLICT: { status: 409, retryable: false },
  IDEMPOTENCY_CONFLICT: { status: 409, retryable: false },
  SIGNATURE_INVALID: { status: 401, retryable: false },
  INTERNAL: { status: 500, retryable: true },
};

export const DISCORD_API_VERSION = "discord.v1";

export interface DiscordApiErrorBody {
  ok: false;
  error: {
    code: DiscordApiErrorCode;
    /** Safe-to-log message; the bot prefers its own per-code copy. */
    message: string;
    retryable: boolean;
    /** Optional hint the bot may surface to the user. */
    userAction?: string;
    /** Machine-readable extras (e.g. requiredRole, retryAfterSeconds, code). */
    details?: Record<string, unknown>;
  };
  meta: { requestId: string; apiVersion: string };
}

export interface DiscordApiSuccessBody<T> {
  ok: true;
  data: T;
  meta: { requestId: string; apiVersion: string };
}

/** Thrown anywhere in a discord route's handler; caught by the route wrapper. */
export class DiscordApiError extends Error {
  readonly code: DiscordApiErrorCode;
  readonly retryable: boolean;
  readonly userAction?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DiscordApiErrorCode,
    message: string,
    opts?: { userAction?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "DiscordApiError";
    this.code = code;
    this.retryable = CODE_META[code].retryable;
    this.userAction = opts?.userAction;
    this.details = opts?.details;
  }

  /** HTTP status this error maps to. */
  get status(): number {
    return CODE_META[this.code].status;
  }
}

/** Stable request id for correlation across the app and the bot's logs. */
export function newRequestId(): string {
  // crypto.randomUUID is available in Node 18+ and the edge/Next runtime.
  return `req_${crypto.randomUUID()}`;
}

/** Build the error envelope `{ body, status }`. Route does NextResponse.json. */
export function discordErrorBody(
  err: DiscordApiError,
  requestId: string = newRequestId(),
): { body: DiscordApiErrorBody; status: number } {
  return {
    status: err.status,
    body: {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        ...(err.userAction ? { userAction: err.userAction } : {}),
        ...(err.details ? { details: err.details } : {}),
      },
      meta: { requestId, apiVersion: DISCORD_API_VERSION },
    },
  };
}

/** Build the success envelope `{ body, status }`. */
export function discordSuccessBody<T>(
  data: T,
  requestId: string = newRequestId(),
): { body: DiscordApiSuccessBody<T>; status: number } {
  return {
    status: 200,
    body: { ok: true, data, meta: { requestId, apiVersion: DISCORD_API_VERSION } },
  };
}
