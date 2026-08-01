import { ConvexError } from "convex/values";
import { ApiKeyAuthError } from "../api-key";
import { AgentTokenError } from "./agent-token";

/**
 * The API/MCP error envelope (docs/designs/api-mcp-reimplementation.md §10).
 *
 * This is a MAPPING, not a re-invention. The Convex guards already throw
 * `ConvexError` with stable, meaningful codes — `PROJECT_LOCKED`,
 * `FINANCIALS_LOCKED`, `JUSTIFICATION_REQUIRED`, `BULK_TOO_LARGE`, `NOT_FOUND`,
 * `RateLimited`, … — because the browser branches on them today. Inventing a
 * parallel API vocabulary would be a second copy of a business fact (R-3.1) and
 * would drift the moment a guard changed. So the envelope adds only what a
 * *machine* consumer needs on top of the code the app already produces:
 *
 *   • `category`  — coarse bucket, so an agent can branch without knowing every code
 *   • `retryable` — is trying the identical call again ever going to work?
 *   • `recovery`  — the concrete next step, because "no" is useless to an agent
 *   • `requiredScope` — for the one failure an operator can fix by widening a key
 *
 * Two rules carried forward from the removed build, both learned the hard way:
 *
 *   1. `MISSING_SCOPE` (the key is too narrow — an operator can widen it) is
 *      DISTINCT from `FORBIDDEN` (the acting user's role forbids it — widening
 *      the key changes nothing). Conflating them sends agents down a recovery
 *      path that cannot work.
 *   2. An overbooking rejection returns `conflicts[]` AND `suggestions[]`, not
 *      just "no". The availability bundle already computes both.
 */

type ErrorCategory =
  /** The credential itself: missing, invalid, revoked, expired. */
  | "auth"
  /** The key's scopes don't cover the operation. Operator-fixable. */
  | "scope"
  /** The acting user's role, or org isolation, forbids it. Not key-fixable. */
  | "permission"
  /** A business gate said no: lifecycle locks, blocking comments, money bounds. */
  | "gate"
  /** The request was malformed or violated a bound. */
  | "validation"
  /** State conflict: overbooking, duplicate id, idempotency-key reuse. */
  | "conflict"
  /** The named row/operation doesn't exist (or isn't visible). */
  | "not_found"
  /** Budget exhausted. Always retryable, with a delay. */
  | "rate_limit"
  /** Anything unclassified. Never leaks an internal message — see below. */
  | "internal";

interface ApiErrorRecovery {
  /** A stable machine token naming the next step (`open_unlock_session`, …). */
  action: string;
  /** One human sentence an agent can surface to its operator verbatim. */
  hint: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    category: ErrorCategory;
    retryable: boolean;
    message: string;
    recovery: ApiErrorRecovery | null;
    /** Set only for `MISSING_SCOPE`: the exact scope string to add to the key. */
    requiredScope: string | null;
    requestId: string | null;
    details: Record<string, unknown> | null;
  };
}

interface CodeSpec {
  category: ErrorCategory;
  retryable: boolean;
  recovery: ApiErrorRecovery | null;
  /** HTTP status for the REST surface. MCP ignores it. */
  status: number;
}

/**
 * The code table. Every entry corresponds to a code some guard in `convex/` (or
 * the API key path) actually throws today — grep before adding a row, and add the
 * guard first if it doesn't exist. An unknown code is not a crash; it degrades to
 * {@link UNKNOWN_SPEC}, which is deliberately conservative (`internal`,
 * non-retryable) so a new guard can never accidentally be advertised as safe to
 * retry.
 */
const CODE_SPECS: Record<string, CodeSpec> = {
  // ── auth ──────────────────────────────────────────────────────────────────
  MISSING_CREDENTIALS: {
    category: "auth",
    retryable: false,
    status: 401,
    recovery: {
      action: "provide_bearer_token",
      hint: "Send the API key as `Authorization: Bearer <key>`.",
    },
  },
  INVALID_KEY: {
    category: "auth",
    retryable: false,
    status: 401,
    recovery: { action: "check_key", hint: "The API key was not recognised. Check it was copied in full." },
  },
  KEY_INACTIVE: {
    category: "auth",
    retryable: false,
    status: 401,
    recovery: { action: "issue_new_key", hint: "This key was revoked. An org admin must issue a new one." },
  },
  KEY_EXPIRED: {
    category: "auth",
    retryable: false,
    status: 401,
    recovery: { action: "issue_new_key", hint: "This key has expired. An org admin must issue a new one." },
  },
  ORG_KILL_SWITCH: {
    category: "auth",
    retryable: false,
    status: 403,
    recovery: { action: "contact_admin", hint: "API access is switched off for this organization." },
  },
  ORG_ARCHIVED: {
    category: "auth",
    retryable: false,
    status: 403,
    recovery: { action: "contact_admin", hint: "This organization has been archived." },
  },

  // ── scope vs permission: the distinction that matters most ────────────────
  MISSING_SCOPE: {
    category: "scope",
    retryable: false,
    status: 403,
    recovery: {
      action: "grant_scope",
      hint: "The key is too narrow. An org admin can add the listed scope in Settings → API keys.",
    },
  },
  FORBIDDEN: {
    category: "permission",
    retryable: false,
    status: 403,
    recovery: {
      action: "use_different_actor",
      hint: "The user this key acts as does not have this permission. Widening the key will not help.",
    },
  },
  AGENT_READ_NOT_MIGRATED: {
    category: "permission",
    retryable: false,
    status: 403,
    recovery: {
      action: "use_supported_operation",
      hint: "This read is not exposed to API keys yet. `list_operations` shows what is.",
    },
  },
  FORBIDDEN_HARD_LOCK_OVERRIDE: {
    category: "permission",
    retryable: false,
    status: 403,
    recovery: {
      action: "escalate_to_manager",
      hint: "Only an org admin/owner or an assigned project manager can act inside a full unlock session.",
    },
  },

  // ── gates ─────────────────────────────────────────────────────────────────
  PROJECT_LOCKED: {
    category: "gate",
    retryable: false,
    status: 409,
    recovery: {
      action: "open_unlock_session",
      hint: "The project is completed and hard-locked. A manager must open a FULL unlock session first.",
    },
  },
  FINANCIALS_LOCKED: {
    category: "gate",
    retryable: false,
    status: 409,
    recovery: {
      action: "open_unlock_session",
      hint: "A manager must open an unlock session on the project's Financials tab before money fields can change.",
    },
  },
  JUSTIFICATION_REQUIRED: {
    category: "gate",
    retryable: true,
    status: 409,
    recovery: {
      action: "retry_with_justification",
      hint: "Re-send the same call with a `justification` of at least 10 characters explaining the change.",
    },
  },
  BLOCKING_COMMENTS: {
    category: "gate",
    retryable: false,
    status: 409,
    recovery: {
      action: "resolve_blocking_comments",
      hint: "Unresolved blocking comments must be resolved before this project can be sent out.",
    },
  },
  WRITES_DISABLED: {
    category: "gate",
    retryable: true,
    status: 503,
    recovery: { action: "retry_later", hint: "Writes are temporarily disabled for this domain." },
  },
  ASSET_IN_KIT: {
    category: "gate",
    retryable: false,
    status: 409,
    recovery: {
      action: "add_kit_instead",
      hint: "This asset belongs to a kit. Add the kit to the project, or remove the asset from the kit first.",
    },
  },
  CONFIRMATION_REQUIRED: {
    category: "gate",
    retryable: true,
    status: 409,
    recovery: {
      action: "confirm_with_human",
      hint: "Show the summary to a human, then re-send the identical call with `confirm: true`.",
    },
  },
  // ── validation ────────────────────────────────────────────────────────────
  INVALID_NUMBER: {
    category: "validation",
    retryable: false,
    status: 400,
    recovery: { action: "fix_arguments", hint: "A numeric field was NaN, infinite, or out of range." },
  },
  VALIDATION_FAILED: {
    category: "validation",
    retryable: false,
    status: 400,
    recovery: { action: "fix_arguments", hint: "See `details.issues` for the fields that failed validation." },
  },
  BULK_TOO_LARGE: {
    category: "validation",
    retryable: true,
    status: 400,
    recovery: {
      action: "split_batch",
      hint: "Split the array into smaller batches (API keys are capped at 50 items per call) and retry.",
    },
  },

  // ── conflict ──────────────────────────────────────────────────────────────
  INVENTORY_CONFLICT: {
    category: "conflict",
    retryable: false,
    status: 409,
    recovery: {
      action: "choose_alternative",
      hint: "Not enough stock for these dates. `details.suggestions` lists substitutes that are free.",
    },
  },
  IDEMPOTENT_IN_PROGRESS: {
    category: "conflict",
    retryable: true,
    status: 409,
    recovery: {
      action: "retry_after_delay",
      hint: "An earlier call with this idempotency key is still running. Retry shortly with the SAME key.",
    },
  },
  DOCUMENT_NOT_READY: {
    category: "conflict",
    retryable: true,
    status: 409,
    recovery: {
      action: "retry_after_delay",
      hint: "The document was sent/issued but its PDF is still generating (or failed). Retry shortly, or check the Finance tab.",
    },
  },
  IDEMPOTENCY_KEY_REUSED: {
    category: "conflict",
    retryable: false,
    status: 409,
    recovery: {
      action: "use_new_idempotency_key",
      hint: "This key was already used for a different call. Generate a new idempotency key.",
    },
  },
  ALREADY_EXISTS: {
    category: "conflict",
    retryable: false,
    status: 409,
    recovery: { action: "fetch_existing", hint: "A row with this id already exists." },
  },

  // ── not found / limits ────────────────────────────────────────────────────
  NOT_FOUND: {
    category: "not_found",
    retryable: false,
    status: 404,
    recovery: { action: "check_id", hint: "No such row in this organization." },
  },
  UNKNOWN_OPERATION: {
    category: "not_found",
    retryable: false,
    status: 404,
    recovery: { action: "list_operations", hint: "No such operation. `list_operations` enumerates the surface." },
  },
  RateLimited: {
    category: "rate_limit",
    retryable: true,
    status: 429,
    recovery: {
      action: "retry_after",
      hint: "Rate limit exceeded. Wait `details.retryAfter` milliseconds before retrying.",
    },
  },
};

const UNKNOWN_SPEC: CodeSpec = {
  category: "internal",
  retryable: false,
  status: 500,
  recovery: null,
};

/** Look up a code's classification, falling back to the conservative unknown spec. */
function specForCode(code: string): CodeSpec {
  return CODE_SPECS[code] ?? UNKNOWN_SPEC;
}

/** Every code the envelope knows how to classify. Used by the docs generator and
 *  by the "a stable code never disappears" compatibility check. */
export const KNOWN_ERROR_CODES = Object.freeze(Object.keys(CODE_SPECS).sort());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pull `{ code, message, … }` out of whatever was thrown.
 *
 * Convex guards throw two shapes: `new ConvexError("plain message")` (the older
 * org/permission guards) and `new ConvexError({ code, message, … })` (everything
 * added since). Handle both, and recognise the rate limiter's `kind: "RateLimited"`
 * payload, which names its discriminator `kind` rather than `code`.
 */
interface Extracted {
  code: string;
  message: string;
  data: Record<string, unknown>;
}

const UNKNOWN: Extracted = {
  code: "INTERNAL_ERROR",
  message: "An unexpected error occurred.",
  data: {},
};

/** A ConvexError's payload is either a bare string (the older guards) or an object
 *  carrying a `code` — or, for the rate limiter, a `kind`. Both shapes here. */
function extractConvex(err: ConvexError<never>): Extracted {
  const data: unknown = err.data;
  if (typeof data === "string") {
    return { code: inferCodeFromMessage(data), message: data, data: {} };
  }
  if (!isRecord(data)) return { ...UNKNOWN, message: err.message };

  const discriminator = typeof data.code === "string" ? data.code : data.kind;
  return {
    code: typeof discriminator === "string" ? discriminator : "INTERNAL_ERROR",
    message: typeof data.message === "string" ? data.message : err.message,
    data,
  };
}

function extract(err: unknown): Extracted {
  if (err instanceof ApiKeyAuthError) {
    return {
      code: err.code,
      message: err.message,
      data: err.requiredScope ? { requiredScope: err.requiredScope } : {},
    };
  }
  if (err instanceof AgentTokenError) {
    return { code: err.code, message: err.message, data: {} };
  }
  if (err instanceof ConvexError) return extractConvex(err as ConvexError<never>);
  // Dispatcher-thrown errors (missing bearer token, unknown operation, envelope/
  // business validation) are plain `Error`s carrying a `.code` matching a
  // `CODE_SPECS` key — `Object.assign(new Error(message), { code })`, the same
  // pattern used throughout src/lib/api/dispatcher.ts. Recognise that shape
  // generically rather than adding a bespoke error class per call site.
  if (err instanceof Error && typeof (err as unknown as { code?: unknown }).code === "string") {
    const withDetails = err as unknown as { code: string; details?: unknown };
    return {
      code: withDetails.code,
      message: err.message,
      data: isRecord(withDetails.details) ? withDetails.details : {},
    };
  }
  return UNKNOWN;
}

/**
 * The pre-`code` guards (`requireService`, `requireOrgRead`, `requireOrgPermission`)
 * throw bare-string `ConvexError`s. Rather than rewrite ~600 call sites to satisfy
 * the API, recognise their three fixed messages here. This is a translation of an
 * existing contract, not a new one — the strings are literals in
 * `convex/lib/auth.ts` and `agentAuthGuards.test.ts` pins them.
 */
function inferCodeFromMessage(message: string): string {
  if (/^Unauthorized/i.test(message)) return "UNAUTHORIZED";
  if (/organization mismatch/i.test(message)) return "FORBIDDEN";
  if (/not a member/i.test(message)) return "FORBIDDEN";
  if (/insufficient permissions/i.test(message)) return "FORBIDDEN";
  if (/already exists/i.test(message)) return "ALREADY_EXISTS";
  if (/not found/i.test(message)) return "NOT_FOUND";
  return "INTERNAL_ERROR";
}

/** Details keys that are structural, not payload — never echoed into `details`. */
const RESERVED_DETAIL_KEYS = new Set(["code", "kind", "message", "requiredScope"]);

export interface ToEnvelopeOptions {
  requestId?: string | null;
}

/**
 * Convert any thrown value into the wire envelope.
 *
 * `internal`-category errors deliberately return a FIXED message: an unmapped
 * throw can carry a stack, a query fragment, or another org's row in its text,
 * and this envelope goes to a third party. The real message still reaches the
 * Convex logs and PostHog; the caller gets a request id to quote.
 */
export function toErrorEnvelope(
  err: unknown,
  { requestId = null }: ToEnvelopeOptions = {},
): ApiErrorEnvelope {
  const { code, message, data } = extract(err);
  const spec = specForCode(code);

  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!RESERVED_DETAIL_KEYS.has(key)) details[key] = value;
  }

  return {
    error: {
      code,
      category: spec.category,
      retryable: spec.retryable,
      message:
        spec.category === "internal"
          ? "An unexpected error occurred. Quote the requestId when reporting it."
          : message,
      recovery: spec.recovery,
      requiredScope: typeof data.requiredScope === "string" ? data.requiredScope : null,
      requestId,
      details: Object.keys(details).length ? details : null,
    },
  };
}

/** HTTP status for the REST surface. MCP surfaces the envelope in-band instead. */
export function statusForError(err: unknown): number {
  return specForCode(extract(err).code).status;
}
