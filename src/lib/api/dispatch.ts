import { prisma } from "../prisma";
import { isUserFacingError } from "../errors/user-facing-error";
import { runWithActor } from "../request-actor";
import { ApiKeyAuthError } from "../api-key";
import type { ActorContext } from "../actor-context";
import type { Resource } from "../permissions";
import { getConvexClient } from "../convex-client";
import { authorizeApiOperation } from "./authorize";
import { ApiError } from "./errors";
import { OPERATIONS, MODULE_LOADERS, type OperationMeta } from "./generated/operations";
import { CONVEX_READS, INJECTED_ARGS, type ConvexReadMeta } from "./convex-reads";

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

export function getOperation(name: string): OperationMeta {
  const meta = ALL_OPERATIONS[name];
  if (!meta) {
    throw new ApiError("NOT_FOUND", `Unknown operation: '${name}'.`, {
      details: { hint: "Call 'list_operations' (MCP) or GET /api/v1/operations to discover valid names." },
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
    // The guarded actions throw plain Errors for RBAC and lookup failures.
    if (/permission|not allowed|forbidden|not a member/i.test(err.message)) {
      return new ApiError("FORBIDDEN", err.message, { retryable: false });
    }
    if (/not found|no longer exists/i.test(err.message)) {
      return new ApiError("NOT_FOUND", err.message, { retryable: false });
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

  if (canReplay) {
    const prior = await prisma.apiIdempotency.findUnique({
      where: { apiKeyId_key: { apiKeyId: actor.apiKeyId!, key: idempotencyKey! } },
    });
    if (prior) {
      return {
        operation: meta.name,
        kind: meta.kind,
        replayed: true,
        result: JSON.parse(prior.result),
      };
    }
  }

  const handler = await loadHandler(meta);

  let raw: unknown;
  try {
    raw = await runWithActor(actor, () => handler(...argList));
  } catch (err) {
    throw toApiError(err, meta);
  }

  const result = serializeResult(raw);

  if (canReplay) {
    try {
      await prisma.apiIdempotency.create({
        data: {
          organizationId: actor.organizationId,
          apiKeyId: actor.apiKeyId!,
          key: idempotencyKey!,
          verb: meta.name,
          result: JSON.stringify(result),
        },
      });
    } catch {
      // Lost a concurrent race on the unique (apiKeyId, key) index. The winner's
      // result is the canonical one; return it as a replay.
      const winner = await prisma.apiIdempotency.findUnique({
        where: { apiKeyId_key: { apiKeyId: actor.apiKeyId!, key: idempotencyKey! } },
      });
      if (winner) {
        return {
          operation: meta.name,
          kind: meta.kind,
          replayed: true,
          result: JSON.parse(winner.result),
        };
      }
    }
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
  } = {},
): { total: number; returned: number; operations: OperationSummary[] } {
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

  const total = all.length;
  const limited = all.slice(0, opts.limit ?? 100);

  return {
    total,
    returned: limited.length,
    operations: limited.map((m) => ({
      name: m.name,
      kind: m.kind,
      scope: m.scope,
      dangerous: m.dangerous,
      requiresConfirmation: isGuardedWrite(m),
      summary: m.summary,
    })),
  };
}

/** Full call signature for one operation. */
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
    parameters: meta.params.map((p) => ({
      name: p.name,
      type: p.type,
      required: !p.optional,
    })),
  };
}
