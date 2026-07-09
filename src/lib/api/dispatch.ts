import { prisma } from "../prisma";
import { isUserFacingError } from "../errors/user-facing-error";
import { runWithActor } from "../request-actor";
import { ApiKeyAuthError } from "../api-key";
import type { ActorContext } from "../actor-context";
import type { Resource } from "../permissions";
import { getConvexClient } from "../convex-client";
import { authorizeApiOperation } from "./authorize";
import { ApiError, type ApiErrorCode } from "./errors";
import {
  OPERATIONS,
  MODULE_LOADERS,
  PARAM_SCHEMAS,
  type OperationMeta,
  type JsonSchema,
} from "./generated/operations";
import { CONVEX_READS, INJECTED_ARGS, type ConvexReadMeta } from "./convex-reads";
import { TOOL_ALIASES, TOOL_BY_OPERATION } from "./tool-aliases";

/**
 * The one chokepoint for invoking any of the app's server actions over the API or
 * MCP. Both adapters call {@link invokeOperation}; neither imports `src/server`
 * directly.
 *
 * An operation runs the SAME function the web UI runs, inside `runWithActor` so
 * `getOrgContext()`/`requirePermission()` resolve to the API key's identity. That
 * means every business rule, RBAC check, overbooking guard and audit write applies
 * unchanged — there is no parallel write path to keep in sync.
 *
 * Safety rails layered on top:
 * - scope ∩ RBAC is checked here (needed for reads, which never call
 *   `requirePermission` themselves) AND again inside each guarded write.
 * - `dangerous` and availability-affecting writes demand `confirm: true` plus an
 *   `idempotencyKey`, so an agent cannot delete a project or pull stock on a
 *   half-considered first call, and a retry cannot double-apply.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

/**
 * Writes that consume or move physical stock. These get the same speed bump as
 * `dangerous` ops. For reservations prefer the `reserve_items` verb, which offers a
 * true preview (availability + conflicts) before committing.
 */
const AVAILABILITY_AFFECTING = new Set([
  "line-items.addLineItem",
  "line-items.addKitLineItem",
  "line-items.updateLineItemQuantity",
  "warehouse.checkOutItems",
  "warehouse.checkOutKit",
  "warehouse.checkOutKitsBatch",
  "warehouse.checkInItems",
  "warehouse.checkInKit",
  "warehouse.checkInKitsBatch",
  "warehouse.bulkForceReturnAssets",
]);

/**
 * Marks a ledger row reserved but not yet completed. Stored in `result` so no
 * schema migration is needed; it can never collide with a real result because
 * every real result is JSON.
 */
const PENDING_RESULT = "__gearflow_pending__";

/** Marks a ledger row whose operation failed; a replay re-throws the same error. */
const FAILED_KEY = "__gearflow_failed__";

/** Convex rejects arrays over 1000 ids; reject them here with a usable error. */
const MAX_ARRAY_ARG = 1000;

export interface InvokeInput {
  operation: string;
  /** Arguments keyed by the operation's parameter names (see `describeOperation`). */
  arguments?: Record<string, unknown>;
  /** Required for `dangerous` and availability-affecting writes. */
  confirm?: boolean;
  /** Required alongside `confirm` for guarded writes; makes retries safe. */
  idempotencyKey?: string;
}

export interface InvokeResult {
  operation: string;
  kind: "read" | "write";
  /** True when this exact idempotencyKey already ran; `result` is the original. */
  replayed: boolean;
  result: unknown;
}

/** Requires `confirm: true` + an idempotencyKey before it will commit. */
export function isGuardedWrite(meta: OperationMeta): boolean {
  return meta.kind === "write" && (meta.dangerous || AVAILABILITY_AFFECTING.has(meta.name));
}

/** The full catalogue: generated server actions + the bridged Convex-only reads. */
export const ALL_OPERATIONS: Record<string, OperationMeta> = { ...OPERATIONS, ...CONVEX_READS };

// A Convex read must never shadow a server action — the action is the guarded path.
for (const name of Object.keys(CONVEX_READS)) {
  if (OPERATIONS[name]) {
    throw new Error(
      `Convex read '${name}' collides with a generated server-action operation. Rename it in convex-reads.ts.`,
    );
  }
}

function isConvexRead(meta: OperationMeta): meta is ConvexReadMeta {
  return "ref" in meta;
}

/** The number of operations reachable through the API (server actions + Convex reads). */
export const TOTAL_OPERATIONS = Object.keys(ALL_OPERATIONS).length;

export function getOperation(name: string): OperationMeta {
  // Accept an MCP tool name as an alias, so an agent moving between MCP and REST
  // doesn't have to rediscover that `search_assets` is really `assets.getAssets`.
  const resolved = ALL_OPERATIONS[name] ? name : TOOL_ALIASES[name];
  const meta = resolved ? ALL_OPERATIONS[resolved] : undefined;
  if (!meta) {
    throw new ApiError("NOT_FOUND", `Unknown operation: '${name}'.`, {
      details: { hint: "Call 'list_operations' (MCP) or GET /api/v1/operations to discover valid names. MCP tool names (e.g. 'search_assets') work here too." },
    });
  }
  return meta;
}

/**
 * Run a bridged Convex query. The SERVICE token bypasses Convex's own org guard,
 * so `orgId` comes from the AUTHENTICATED actor and a caller-supplied `orgId` is a
 * hard error — that is the only thing standing between this and a cross-org read.
 */
async function runConvexRead(
  actor: ActorContext,
  meta: ConvexReadMeta,
  args: Record<string, unknown>,
): Promise<unknown> {
  const injected = Object.keys(args).filter((k) => INJECTED_ARGS.has(k));
  if (injected.length) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `'${injected.join(", ")}' is set from your API key and cannot be passed as an argument.`,
      { retryable: false },
    );
  }

  buildArgList(meta, args); // validates required/unknown args, same rules as actions

  // An oversized id array blows past Convex's document-read limit and surfaces as
  // a retryable INTERNAL, inviting the agent into a retry loop. Reject it clearly.
  for (const [key, value] of Object.entries(args)) {
    if (Array.isArray(value) && value.length > MAX_ARRAY_ARG) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `'${key}' has ${value.length} entries; the maximum is ${MAX_ARRAY_ARG}. Split the request into batches.`,
        { retryable: false, details: { limit: MAX_ARRAY_ARG, received: value.length } },
      );
    }
  }

  const autoArgs = Object.fromEntries(
    Object.entries(meta.autoArgs ?? {}).map(([k, fn]) => [k, fn()]),
  );

  const client = await getConvexClient();
  return client.query(meta.ref, { ...args, ...autoArgs, orgId: actor.organizationId });
}

/**
 * Map the caller's named arguments onto the action's positional parameters.
 * Unknown keys are rejected rather than ignored — a silently dropped `projectId`
 * from a typo is far worse for an agent than a loud error.
 */
export function buildArgList(meta: OperationMeta, args: Record<string, unknown>): unknown[] {
  const known = new Set(meta.params.map((p) => p.name));
  const unknown = Object.keys(args).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new ApiError("VALIDATION_ERROR", `Unknown argument(s): ${unknown.join(", ")}.`, {
      details: {
        expected: meta.params.map((p) => ({ name: p.name, type: p.type, optional: p.optional })),
      },
    });
  }

  const missing = meta.params.filter((p) => !p.optional && args[p.name] === undefined);
  if (missing.length) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Missing required argument(s): ${missing.map((p) => p.name).join(", ")}.`,
      {
        details: {
          expected: meta.params.map((p) => ({ name: p.name, type: p.type, optional: p.optional })),
        },
      },
    );
  }

  // Trim trailing undefineds so the action's own parameter defaults apply.
  const positional = meta.params.map((p) => args[p.name]);
  while (positional.length && positional[positional.length - 1] === undefined) positional.pop();
  return positional;
}

/** Turn any thrown value into the structured envelope's ApiError. */
function toApiError(err: unknown, meta: OperationMeta): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ApiKeyAuthError) throw err; // auth errors keep their own envelope

  if (isUserFacingError(err)) {
    return new ApiError("VALIDATION_ERROR", err.message, {
      retryable: false,
      details: { code: err.code, hint: err.hint },
    });
  }

  if (err instanceof Error) {
    // The guarded actions throw plain Errors for RBAC and lookup failures. We
    // classify on the message but NEVER echo it back — an internal error whose
    // text happens to contain "not found" (a missing DB relation, say) would
    // otherwise leak infrastructure detail to the caller.
    if (/permission|not allowed|forbidden|not a member/i.test(err.message)) {
      return new ApiError("FORBIDDEN", "You don't have permission to perform this action.", {
        retryable: false,
      });
    }
    if (/not found|no longer exists/i.test(err.message)) {
      return new ApiError("NOT_FOUND", "The requested resource was not found in this organization.", {
        retryable: false,
      });
    }
  }

  // Never leak internals. The envelope's opaque 500 covers the rest.
  return new ApiError("INTERNAL", `Operation '${meta.name}' failed.`, { retryable: true });
}

/** JSON-safe view of an action's return value (Dates become ISO strings). */
function serializeResult(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    throw new ApiError("INTERNAL", "The operation's result could not be serialized.", {
      retryable: false,
    });
  }
}

async function loadHandler(meta: OperationMeta): Promise<(...args: unknown[]) => Promise<unknown>> {
  const loader = MODULE_LOADERS[meta.module];
  if (!loader) {
    throw new ApiError("NOT_FOUND", `Operation module '${meta.module}' is not available.`);
  }
  const mod = await loader();
  const fn = mod[meta.fn];
  if (typeof fn !== "function") {
    throw new ApiError("NOT_FOUND", `Operation '${meta.name}' is no longer exported.`);
  }
  return fn as (...args: unknown[]) => Promise<unknown>;
}

/**
 * Authorize, then run an operation as `actor`. Every REST and MCP write funnels
 * through here.
 */
export async function invokeOperation(
  actor: ActorContext,
  input: InvokeInput,
): Promise<InvokeResult> {
  const meta = getOperation(input.operation);
  const args = input.arguments ?? {};

  // Scope ∩ RBAC. Reads need this because they never call requirePermission
  // themselves; writes get it again inside their own guard (defense in depth).
  await authorizeApiOperation(actor, meta.resource as Resource, meta.action);

  const guarded = isGuardedWrite(meta);
  if (guarded) {
    if (input.confirm !== true) {
      throw new ApiError(
        "CONFIRMATION_REQUIRED",
        meta.dangerous
          ? `'${meta.name}' is irreversible. Re-send with confirm=true and an idempotencyKey once you are certain.`
          : `'${meta.name}' changes stock availability. Re-send with confirm=true and an idempotencyKey.`,
        {
          retryable: false,
          details: {
            dangerous: meta.dangerous,
            hint: AVAILABILITY_AFFECTING.has(meta.name)
              ? "To see availability and conflicts before committing, use the 'reserve_items' verb instead."
              : undefined,
          },
        },
      );
    }
    if (!input.idempotencyKey) {
      throw new ApiError(
        "IDEMPOTENCY_KEY_REQUIRED",
        `'${meta.name}' requires an idempotencyKey so a retry cannot apply it twice.`,
        { retryable: false },
      );
    }
  }

  // Convex-only reads: no server action, no idempotency (reads never mutate).
  if (isConvexRead(meta)) {
    let raw: unknown;
    try {
      raw = await runConvexRead(actor, meta, args);
    } catch (err) {
      throw toApiError(err, meta);
    }
    return { operation: meta.name, kind: "read", replayed: false, result: serializeResult(raw) };
  }

  const argList = buildArgList(meta, args);
  const idempotencyKey = input.idempotencyKey;
  const canReplay = meta.kind === "write" && Boolean(idempotencyKey) && Boolean(actor.apiKeyId);

  const ledgerWhere = canReplay
    ? { apiKeyId_key: { apiKeyId: actor.apiKeyId!, key: idempotencyKey! } }
    : undefined;

  /** Decide what a pre-existing ledger row means for this request. */
  const interpretPrior = (prior: { verb: string; result: string }): InvokeResult => {
    if (prior.verb !== meta.name) {
      // Reusing a key across operations would otherwise return the FIRST
      // operation's result and silently skip this one.
      throw new ApiError(
        "VALIDATION_ERROR",
        `idempotencyKey '${idempotencyKey}' was already used for '${prior.verb}'. Use a fresh key for '${meta.name}'.`,
        { retryable: false, details: { previousOperation: prior.verb } },
      );
    }
    if (prior.result === PENDING_RESULT) {
      // Reserved but never completed: an earlier attempt died between the effect
      // and the result write. We cannot know whether it applied, so we must not
      // re-run it — that is exactly the double-apply this ledger exists to stop.
      // Deliberately terminal for THIS key: recover by checking whether the
      // operation applied, then retrying with a fresh key.
      throw new ApiError(
        "IDEMPOTENCY_IN_PROGRESS",
        `A previous call with idempotencyKey '${idempotencyKey}' is still in flight, or was interrupted before recording its outcome. Do not blindly retry: check whether '${meta.name}' applied, then use a fresh idempotencyKey.`,
        { retryable: false },
      );
    }

    const parsed = JSON.parse(prior.result);
    // A recorded failure replays as the same failure (Stripe's semantics): the
    // handler may have partially applied before throwing, so re-running it could
    // double-apply. A fresh key is required to genuinely retry.
    if (parsed && typeof parsed === "object" && FAILED_KEY in parsed) {
      const f = parsed[FAILED_KEY] as { code: ApiErrorCode; message: string };
      throw new ApiError(f.code, f.message, { retryable: false, details: { replayedFailure: true } });
    }

    return { operation: meta.name, kind: meta.kind, replayed: true, result: parsed };
  };

  if (canReplay) {
    const prior = await prisma.apiIdempotency.findUnique({ where: ledgerWhere! });
    if (prior) return interpretPrior(prior);

    // RESERVE BEFORE EXECUTING. If we recorded only after the effect, a crash (or
    // an unserializable result) in between would leave no ledger row, and the
    // retry would apply a stock-moving write twice.
    try {
      await prisma.apiIdempotency.create({
        data: {
          organizationId: actor.organizationId,
          apiKeyId: actor.apiKeyId!,
          key: idempotencyKey!,
          verb: meta.name,
          result: PENDING_RESULT,
        },
      });
    } catch {
      // Lost the race on the unique (apiKeyId, key) index — the winner owns it.
      const winner = await prisma.apiIdempotency.findUnique({ where: ledgerWhere! });
      if (winner) return interpretPrior(winner);
      throw new ApiError("INTERNAL", "Could not reserve the idempotency key.", { retryable: true });
    }
  }

  const handler = await loadHandler(meta);

  let raw: unknown;
  try {
    raw = await runWithActor(actor, () => handler(...argList));
  } catch (err) {
    const apiErr = toApiError(err, meta);
    // Record the failure rather than deleting the reservation. A guarded write can
    // mutate before it throws (addLineItem writes, then reads back), so "the
    // handler threw" does NOT prove nothing applied — freeing the key would let a
    // retry apply it a second time. Replaying the error is the safe direction.
    if (canReplay) {
      await prisma.apiIdempotency
        .update({
          where: ledgerWhere!,
          data: { result: JSON.stringify({ [FAILED_KEY]: { code: apiErr.code, message: apiErr.message } }) },
        })
        .catch(() => {});
    }
    throw apiErr;
  }

  let result: unknown;
  try {
    result = serializeResult(raw);
  } catch (err) {
    // The effect DID apply; only the response could not be encoded. Keep the
    // reservation (marked applied) so a retry replays instead of re-applying.
    if (canReplay) {
      await prisma.apiIdempotency
        .update({ where: ledgerWhere!, data: { result: JSON.stringify({ applied: true, unserializable: true }) } })
        .catch(() => {});
    }
    throw err;
  }

  if (canReplay) {
    // The effect already applied. If we cannot record the result, still return it —
    // throwing here would report a successful write as a failure. The row stays
    // PENDING, so a later retry is refused rather than double-applied.
    await prisma.apiIdempotency
      .update({ where: ledgerWhere!, data: { result: JSON.stringify(result) } })
      .catch(() => {});
  }

  return { operation: meta.name, kind: meta.kind, replayed: false, result };
}

export interface OperationSummary {
  name: string;
  kind: "read" | "write";
  scope: string;
  dangerous: boolean;
  requiresConfirmation: boolean;
  summary: string;
}

/**
 * Discovery. Filters to what the key can actually call unless `includeUnauthorized`,
 * so an agent's tool list matches its real capabilities.
 */
export function listOperations(
  actor: ActorContext,
  opts: {
    search?: string;
    kind?: "read" | "write";
    module?: string;
    includeUnauthorized?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): {
  total: number;
  returned: number;
  offset: number;
  /** True when more results exist beyond this page. */
  hasMore: boolean;
  operations: OperationSummary[];
} {
  const scopes = actor.scopes ?? [];
  const grants = (meta: OperationMeta) =>
    actor.actorType !== "apiKey" ||
    scopes.includes("*") ||
    scopes.includes(`${meta.resource}:*`) ||
    scopes.includes(meta.scope);

  const needle = opts.search?.toLowerCase().trim();
  let all = Object.values(ALL_OPERATIONS);

  if (!opts.includeUnauthorized) all = all.filter(grants);
  if (opts.kind) all = all.filter((m) => m.kind === opts.kind);
  if (opts.module) all = all.filter((m) => m.module === opts.module);
  if (needle) {
    all = all.filter(
      (m) =>
        m.name.toLowerCase().includes(needle) || m.summary.toLowerCase().includes(needle),
    );
  }

  // Deterministic order, or paging would return overlapping/missing entries.
  all.sort((a, b) => a.name.localeCompare(b.name));

  const total = all.length;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 100;
  const page = all.slice(offset, offset + limit);

  return {
    total,
    returned: page.length,
    offset,
    hasMore: offset + page.length < total,
    operations: page.map((m) => ({
      name: m.name,
      kind: m.kind,
      scope: m.scope,
      dangerous: m.dangerous,
      requiresConfirmation: isGuardedWrite(m),
      summary: m.summary,
      // The MCP tool that calls this operation, when one exists. Lets an agent
      // move between the tool name and the operation name in one hop.
      ...(TOOL_BY_OPERATION[m.name] ? { mcpTool: TOOL_BY_OPERATION[m.name] } : {}),
    })),
  };
}

/** The JSON Schema for a parameter, if its type resolved to one. */
export function schemaForParam(param: { schemaRef?: string }): JsonSchema | undefined {
  return param.schemaRef ? PARAM_SCHEMAS[param.schemaRef] : undefined;
}

/**
 * Full call signature for one operation. `schema` is real JSON Schema (draft
 * 2020-12) generated from the Zod validator the action enforces — build the
 * argument from that, not from `type`, which is only the TypeScript text.
 */
export function describeOperation(name: string) {
  const meta = getOperation(name);
  return {
    name: meta.name,
    module: meta.module,
    kind: meta.kind,
    scope: meta.scope,
    dangerous: meta.dangerous,
    requiresConfirmation: isGuardedWrite(meta),
    summary: meta.summary,
    ...(TOOL_BY_OPERATION[meta.name] ? { mcpTool: TOOL_BY_OPERATION[meta.name] } : {}),
    parameters: meta.params.map((p) => {
      const schema = schemaForParam(p);
      return {
        name: p.name,
        type: p.type,
        required: !p.optional,
        ...(schema ? { schema } : {}),
      };
    }),
  };
}
