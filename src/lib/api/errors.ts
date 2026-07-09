/**
 * Structured, agent-native errors for the API/MCP layer. Every failure an agent
 * can hit carries a STABLE machine-readable `code` (never message-parsed), whether
 * it's `retryable`, and typed `details` — so an autonomous agent can decide what to
 * do next instead of giving up. Adapters (MCP/REST) serialize these into the wire
 * envelope. See docs/designs/api-mcp-agent-access.md (§"Agent-native error envelope").
 */

export type ApiErrorCode =
  // auth / scope (also emitted by ApiKeyAuthError at the auth boundary)
  | "MISSING_SCOPE"
  | "FORBIDDEN"
  // request shape
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_KEY_REQUIRED"
  /** An irreversible or stock-affecting write needs an explicit `confirm: true`. */
  | "CONFIRMATION_REQUIRED"
  /** A call with this idempotencyKey is in flight, or died before recording its result. */
  | "IDEMPOTENCY_IN_PROGRESS"
  // domain
  | "INVENTORY_CONFLICT"
  | "STALE_PREVIEW"
  | "NOT_FOUND"
  /** Unexpected server-side failure. Never carries internal detail. */
  | "INTERNAL";

export interface ApiErrorOptions {
  /** True when the same call may succeed later (rate limit, transient lock, stale preview). */
  retryable?: boolean;
  /** For MISSING_SCOPE: the exact `resource:action` the caller lacked. */
  requiredScope?: string;
  /** Typed, per-code payload the agent can act on (e.g. conflicts[] + suggestions[]). */
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly requiredScope?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, opts: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.requiredScope = opts.requiredScope;
    this.details = opts.details;
  }
}
