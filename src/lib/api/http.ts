import type { ActorContext } from "../actor-context";
import { getApiKeyActorContext, ApiKeyAuthError } from "../api-key";
import { ApiError } from "./errors";

/**
 * Transport-agnostic helpers shared by the REST routes (and later the MCP adapter):
 * pull the bearer token, resolve it to an ActorContext, and turn any thrown error
 * into the ONE agent-native wire envelope. Kept free of `next/server` so it's pure
 * and unit-testable; the route handlers do the framework Response wrapping.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

/** Extract the token from an `Authorization: Bearer <token>` header, or null. */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

/** HTTP status per error code. Anything unmapped falls back to 400/500. */
const STATUS_BY_CODE: Record<string, number> = {
  // auth
  INVALID_KEY: 401,
  KEY_INACTIVE: 401,
  KEY_EXPIRED: 401,
  ORG_KILL_SWITCH: 403,
  MISSING_SCOPE: 403,
  FORBIDDEN: 403,
  // request
  VALIDATION_ERROR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  // domain
  INVENTORY_CONFLICT: 409,
  STALE_PREVIEW: 409,
  NOT_FOUND: 404,
};

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requiredScope?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Map any thrown value to `{ status, body }` with the structured envelope. Known
 * API errors surface their code/message; anything else becomes an opaque 500 so we
 * never leak internals to a caller.
 */
export function toErrorEnvelope(err: unknown): { status: number; body: ErrorEnvelope } {
  if (err instanceof ApiError) {
    return {
      status: STATUS_BY_CODE[err.code] ?? 400,
      body: {
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
          requiredScope: err.requiredScope,
          details: err.details,
        },
      },
    };
  }

  if (err instanceof ApiKeyAuthError) {
    return {
      status: STATUS_BY_CODE[err.code] ?? 401,
      body: {
        error: {
          code: err.code,
          message: err.message,
          retryable: false,
          requiredScope: err.requiredScope,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL",
        message: "An unexpected error occurred.",
        retryable: true,
      },
    },
  };
}

/**
 * Resolve an Authorization header to an ActorContext, or throw an ApiKeyAuthError.
 * The single entry point every API route uses to authenticate a request.
 */
export async function authenticateApiRequest(
  authHeader: string | null | undefined,
): Promise<ActorContext> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    throw new ApiKeyAuthError("INVALID_KEY", "Missing 'Authorization: Bearer <key>' header.");
  }
  return getApiKeyActorContext(token);
}
