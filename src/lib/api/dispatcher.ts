import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { API_REGISTRY_BY_OPERATION, type RegistryOperation } from "./registry.generated";
import { authenticateAgentRequest, parseBearerToken, type AgentRequestContext } from "./agent-auth";
import { hashArgs } from "./idempotency";
import { normalizeArgs, injectedArgNames } from "./arg-normalizer";
import { logApiRequest, spendAgentReadLimit } from "./request-log";
import { toErrorEnvelope, statusForError, type ApiErrorEnvelope } from "./errors";
import { getConvexClient } from "../convex-client";
import { VALIDATION_PAIR_BY_NAME, OPERATION_VALIDATION_PAIR } from "../validations/registry";
import { hasScope as scopeGrants } from "../../../convex/lib/scopes";
import { isPrivilegedArgName, policyForArg, type PrivilegedArgPolicy } from "./privileged-args";
import { emitWebhookEvent } from "../webhooks/emit";

/**
 * The universal dispatcher (design §7, §8, §9, §11) — the single implementation
 * behind `POST /api/v1/ops/{operation}` and, later, the MCP `call_operation` tool
 * (Phase 3). Everything Phase 0/1 built lands here:
 *
 *   1. bearer key → agent token (agent-auth.ts, unchanged since Phase 0)
 *   2. registry lookup — unknown/non-agent-reachable operation ⇒ 404, closed by
 *      default (the registry is the allowlist; there is no fallback path to raw
 *      Convex CRUD)
 *   3. rate limit — one `agentRead` token spent up front for a query (Convex
 *      queries can't self-limit); a mutation's `agentWrite` token is spent
 *      INSIDE the Convex transaction via `enforceBrowserWriteLimit`, unchanged
 *   4. validation parity — the promoted Zod↔Convex registry
 *      (src/lib/validations/registry.ts), best-effort: an operation absent from
 *      `OPERATION_VALIDATION_PAIR` skips this step and relies solely on the
 *      in-Convex `fieldGuards`/`moneyGuards` backstop, same as today
 *   5. confirmation gate (Phase 4, #1000) — a `danger:"high"` mutation (from its
 *      module's `agentOps` classification), OR one that supplies a privileged
 *      arg whose own policy `danger` is `"high"` (e.g. a non-empty
 *      `justification`), must carry `confirm: true` or the call fails with
 *      `CONFIRMATION_REQUIRED` and a rendered summary of what it would do — no
 *      preview→commit token (decision 11), just re-send the identical call with
 *      `confirm: true`. `idempotencyKey` is already mandatory for every
 *      mutation (step 6), which is the other half of the pair the design asks for.
 *   6. arg normalization (arg-normalizer.ts) — actor/id/auditId/now/org
 *      injected, `allowOverbook` forced closed absent the scope, `set`/`clear`
 *      split
 *   7. idempotency — claim/run/complete around every MUTATION (queries skip
 *      this; a read has nothing to replay)
 *   8. the Convex call itself, under the freshly-minted agent token — EVERY
 *      gate (RBAC, scopes, lifecycle locks, overbooking, audit) runs inside
 *      that transaction; nothing here re-implements one
 *   9. error mapping + the per-key request log, always, success or failure
 *
 * Authorization is deliberately not step 2½: this file does not check a single
 * RBAC/scope/lock condition anywhere. That is the whole point of the agent-token
 * design (#995) — a bug here can misroute a call, but it structurally cannot
 * grant one that Convex would have refused.
 */

export interface DispatchResult {
  status: number;
  body:
    | {
        data: unknown;
        requestId: string | null;
        replayed?: boolean;
        /** Design §13 versioning mechanics: the in-band deprecation channel —
         *  the only one an autonomous agent reliably consumes, alongside the
         *  `X-RVLT-Flow-API-Version` header (version.ts). Always present;
         *  empty today because no operation is deprecated yet. */
        warnings: string[];
      }
    | ApiErrorEnvelope;
}

const envelopeSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(200).optional(),
  /** Phase 4 (#1000): required, and must be `true`, on a `danger:"high"` write. */
  confirm: z.boolean().optional(),
});

class DispatchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

function unknownOperation(operation: string): never {
  throw new DispatchError(`No such operation: "${operation}". GET /api/v1/operations lists what's available.`, "UNKNOWN_OPERATION");
}

/** The top-level normalized args, minus injected/structural keys — one
 *  candidate `pickValidationTarget` scores against the paired Convex fields. */
function topLevelCandidate(normalizedArgs: Record<string, unknown>, injected: Set<string>): Record<string, unknown> {
  const topLevel: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(normalizedArgs)) {
    if (!injected.has(k) && k !== "clear") topLevel[k] = v;
  }
  return topLevel;
}

/** Whichever candidate object — top-level args, or a nested `set`/`patch`
 *  sub-object — has the most keys in common with the paired Convex `*Fields`
 *  validator. Returns null when nothing scores above zero. */
function pickValidationTarget(normalizedArgs: Record<string, unknown>, injected: Set<string>, convexKeys: Set<string>): Record<string, unknown> | null {
  const candidates = [topLevelCandidate(normalizedArgs, injected)];
  const nested = normalizedArgs.set ?? normalizedArgs.patch;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    candidates.push(nested as Record<string, unknown>);
  }

  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = Object.keys(candidate).filter((k) => convexKeys.has(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Best-effort business-field validation (design §8): runs the SAME Zod schema
 * the UI hooks run, partially (an update only sends the fields it's changing,
 * so a strict `.parse()` would reject a legitimate partial patch), against
 * whichever part of the call looks like the business fields
 * (`pickValidationTarget`). No pair, or no candidate scoring above zero ⇒ skip
 * silently — `fieldGuards`/`moneyGuards` inside the Convex mutation remain
 * authoritative either way, so skipping here never weakens enforcement, only
 * the message.
 */
function validateBusinessFields(operation: string, normalizedArgs: Record<string, unknown>, injected: Set<string>): void {
  const pair = VALIDATION_PAIR_BY_NAME[OPERATION_VALIDATION_PAIR[operation]];
  if (!pair) return;

  const target = pickValidationTarget(normalizedArgs, injected, new Set(Object.keys(pair.convex)));
  if (!target) return;

  const zodSchema = pair.zod as z.ZodObject<z.ZodRawShape>;
  const partial = typeof zodSchema.partial === "function" ? zodSchema.partial() : zodSchema;
  const result = partial.safeParse(target);
  if (!result.success) {
    throw new DispatchError(
      `Validation failed for "${operation}": ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "VALIDATION_FAILED",
    );
  }
}

async function runIdempotent(
  agent: AgentRequestContext,
  operation: string,
  normalizedArgs: Record<string, unknown>,
  idempotencyKey: string,
  run: () => Promise<unknown>,
): Promise<{ data: unknown; replayed: boolean }> {
  const service = await getConvexClient();
  const now = Date.now();
  const argsHash = hashArgs(normalizedArgs);

  const claim = await service.mutation(api.apiIdempotency.claim, {
    organizationId: agent.key.organizationId,
    apiKeyId: agent.key.id,
    key: idempotencyKey,
    operation,
    argsHash,
    now,
  });

  if (claim.status === "REPLAYED") return { data: claim.result, replayed: true };
  if (claim.status === "IN_PROGRESS") {
    throw new DispatchError("An earlier call with this idempotency key is still in progress.", "IDEMPOTENT_IN_PROGRESS");
  }

  try {
    const data = await run();
    await service.mutation(api.apiIdempotency.complete, {
      organizationId: agent.key.organizationId,
      key: idempotencyKey,
      result: data,
      now: Date.now(),
    });
    return { data, replayed: false };
  } catch (err) {
    // The call never took effect — release the claim so an honest retry (or a
    // caller fixing their args and resending the SAME key) isn't permanently
    // stuck behind a dead PENDING row.
    await service.mutation(api.apiIdempotency.release, {
      organizationId: agent.key.organizationId,
      key: idempotencyKey,
    }).catch(() => {});
    throw err;
  }
}

type Envelope = { args: Record<string, unknown>; idempotencyKey?: string; confirm?: boolean };

/** Parse + validate the request envelope, including the "a mutation needs an
 *  idempotencyKey" check — done HERE, before normalization, because
 *  `normalizeArgs` derives auditId/id from the key for any operation that
 *  declares them, so a missing key must fail with a clear VALIDATION_FAILED
 *  rather than surface as a generic error out of the normalizer. */
function parseEnvelope(rawBody: unknown, op: RegistryOperation): Envelope {
  const parsed = envelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new DispatchError(
      `Invalid request body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "VALIDATION_FAILED",
    );
  }
  if (op.kind === "mutation" && !parsed.data.idempotencyKey) {
    throw Object.assign(new Error("This write requires an `idempotencyKey` (min 8 characters)."), {
      code: "VALIDATION_FAILED",
    });
  }
  return parsed.data;
}

function resolveConvexFn(operationName: string): unknown {
  const [module, fn] = operationName.split(".");
  const convexFn = (api as unknown as Record<string, Record<string, unknown>>)[module]?.[fn];
  if (!convexFn) unknownOperation(operationName);
  return convexFn;
}

interface ExecuteResult {
  responseBody: DispatchResult["body"];
  responseStatus: number;
}

/** Run the read: spend one `agentRead` token (Convex queries can't self-limit;
 *  a genuine RateLimited throw here propagates like any other guard
 *  rejection), then query under the caller's agent token. */
async function executeRead(agent: AgentRequestContext, convexFn: unknown, normalized: Record<string, unknown>, requestId: string | null): Promise<ExecuteResult> {
  await spendAgentReadLimit(agent.key.id);
  const data = await agent.client.query(convexFn as never, normalized as never);
  return { responseBody: { data, requestId, warnings: [] }, responseStatus: 200 };
}

/** Run the write, wrapped in the idempotency claim/run/complete cycle. */
async function executeWrite(
  agent: AgentRequestContext,
  operationName: string,
  convexFn: unknown,
  normalized: Record<string, unknown>,
  idempotencyKey: string,
  requestId: string | null,
): Promise<ExecuteResult> {
  const { data, replayed } = await runIdempotent(agent, operationName, normalized, idempotencyKey, () =>
    agent.client.mutation(convexFn as never, normalized as never),
  );
  return { responseBody: { data, requestId, replayed, warnings: [] }, responseStatus: replayed ? 200 : 201 };
}

function buildNormalizeContext(operationName: string, op: RegistryOperation, agent: AgentRequestContext, envelope: Envelope, startedAt: number) {
  const argNames = new Set(op.args.map((a) => a.name));
  return {
    argNames,
    injected: injectedArgNames(argNames, op.fn),
    context: {
      operation: operationName,
      fn: op.fn,
      kind: op.kind,
      argNames,
      actor: { userId: agent.actor.userId, userName: agent.actor.userName },
      organizationId: agent.key.organizationId,
      idempotencyKey: envelope.idempotencyKey ?? null,
      nowMs: startedAt,
      hasScope: (resource: string, action: string) => scopeGrants(agent.actor.scopes ?? [], resource, action),
    },
  };
}

// ─── Confirmation gate (Phase 4, #1000) ──────────────────────────────────────
//
// A "high" danger call must carry `confirm: true`. Danger is the HIGHER of the
// operation's own classification (from its module's `agentOps` export) and any
// PRESENT, ACTIVE privileged argument's own policy danger (src/lib/api/privileged-args.ts)
// — so a `medium` op that also softens a lock via a non-empty `justification`
// (policy danger `"high"`) still requires confirmation for THAT call, without
// reclassifying the operation itself for every other call that doesn't touch
// the lock. Checked on the RAW args, before normalization strips/forces them —
// this is what the caller actually asked for.

const DANGER_RANK: Record<"low" | "medium" | "high", number> = { low: 1, medium: 2, high: 3 };

/** Is this privileged-arg value actually invoking the capability it gates, as
 *  opposed to being absent/false/empty (the overwhelmingly common case)? */
function isPrivilegedArgActive(value: unknown): boolean {
  if (typeof value === "boolean") return value === true;
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

/** The effective danger tier for this specific call, or null if nothing about
 *  it is classified/escalated (never gates — the safe default is "no gate"
 *  rather than "block everything unclassified", since gate 5 of the registry
 *  generator already fails the BUILD for an unclassified agent-reachable mutation). */
function effectiveDanger(op: RegistryOperation, rawArgs: Record<string, unknown>): "low" | "medium" | "high" | null {
  let danger: "low" | "medium" | "high" | null = op.kind === "mutation" ? op.danger : null;
  for (const [name, value] of Object.entries(rawArgs)) {
    if (!isPrivilegedArgName(name) || !isPrivilegedArgActive(value)) continue;
    const policy: PrivilegedArgPolicy | null = policyForArg(name);
    if (!policy) continue;
    if (danger === null || DANGER_RANK[policy.danger] > DANGER_RANK[danger]) danger = policy.danger;
  }
  return danger;
}

/** A human-legible rendering of what this call would do — the payload of
 *  `CONFIRMATION_REQUIRED`, so an agent's natural next step is "show this to a
 *  human, then re-call with `confirm: true`" rather than guessing. */
function confirmationRequiredError(operationName: string, op: RegistryOperation, rawArgs: Record<string, unknown>, danger: "high"): Error {
  const gate = op.resource && op.action ? `${op.resource}:${op.action}` : "an agent-reachable operation";
  const activeArgNames = Object.keys(rawArgs).filter((n) => isPrivilegedArgName(n) && isPrivilegedArgActive(rawArgs[n]));
  const summary =
    `This call would run "${operationName}" (${gate}), classified HIGH danger` +
    (activeArgNames.length ? ` because it supplies: ${activeArgNames.join(", ")}.` : ".") +
    " Re-send the identical call with `confirm: true` to proceed.";
  return Object.assign(new Error(summary), {
    code: "CONFIRMATION_REQUIRED",
    details: { operation: operationName, resource: op.resource, action: op.action, danger, summary, args: rawArgs },
  });
}

/** Everything after auth + registry lookup: parse the envelope, normalize +
 *  validate the args, then run the query or the write. */
async function runOperation(
  operationName: string,
  op: RegistryOperation,
  agent: AgentRequestContext,
  rawBody: unknown,
  startedAt: number,
  requestId: string | null,
): Promise<ExecuteResult & { loggedArgs: Record<string, unknown> }> {
  const envelope = parseEnvelope(rawBody, op);

  if (op.kind === "mutation") {
    const danger = effectiveDanger(op, envelope.args);
    if (danger === "high" && envelope.confirm !== true) {
      throw confirmationRequiredError(operationName, op, envelope.args, danger);
    }
  }

  const { injected, context } = buildNormalizeContext(operationName, op, agent, envelope, startedAt);
  const normalized = normalizeArgs(envelope.args, context);
  validateBusinessFields(operationName, normalized, injected);
  const convexFn = resolveConvexFn(operationName);

  const result =
    op.kind === "query"
      ? await executeRead(agent, convexFn, normalized, requestId)
      : await executeWrite(agent, operationName, convexFn, normalized, envelope.idempotencyKey as string, requestId);

  return { ...result, loggedArgs: envelope.args };
}

/**
 * Run one dispatcher call end to end. `rawBody` is the parsed JSON request body
 * (already `{}`-defaulted by the caller if absent); `authorizationHeader` is the
 * raw `Authorization` header value. Framework-agnostic on purpose — the Next.js
 * route (`src/app/api/v1/ops/[operation]/route.ts`) is a thin adapter over this.
 */
export async function dispatch(
  operationName: string,
  rawBody: unknown,
  authorizationHeader: string | null,
  requestId: string | null,
): Promise<DispatchResult> {
  const startedAt = Date.now();
  const rawToken = parseBearerToken(authorizationHeader);
  if (!rawToken) {
    return {
      status: 401,
      body: toErrorEnvelope(Object.assign(new Error("Missing bearer token."), { code: "MISSING_CREDENTIALS" }), { requestId }),
    };
  }

  let agent: AgentRequestContext;
  try {
    agent = await authenticateAgentRequest(rawToken);
  } catch (err) {
    return { status: statusForError(err), body: toErrorEnvelope(err, { requestId }) };
  }

  const op: RegistryOperation | undefined = API_REGISTRY_BY_OPERATION.get(operationName);
  let status: "success" | "error" = "success";
  let errorCode: string | undefined;
  let missingScope: string | undefined;
  let responseBody: DispatchResult["body"];
  let responseStatus: number;
  let loggedArgs: Record<string, unknown> = {};

  try {
    // Closed by default: absent AND non-agent-reachable are the same 404 from the
    // caller's point of view — a SERVICE-only op does not "exist" for a key.
    if (!op || !op.agentReachable) unknownOperation(operationName);
    const result = await runOperation(operationName, op, agent, rawBody, startedAt, requestId);
    responseBody = result.responseBody;
    responseStatus = result.responseStatus;
    loggedArgs = result.loggedArgs;
  } catch (err) {
    status = "error";
    const extracted = toErrorEnvelope(err, { requestId });
    errorCode = extracted.error.code;
    missingScope = extracted.error.requiredScope ?? undefined;
    responseBody = extracted;
    responseStatus = statusForError(err);
  }

  // Best-effort, fire-and-forget — mirrors every other emit() call site in the
  // app (see src/server/warehouse.ts). Only the rate-limit rejection itself
  // (not every error) is webhook-worthy: it is the one failure an operator's
  // monitoring can't infer from their own client logs alone (a throttled agent
  // just silently backs off), unlike a validation or not-found error.
  if (errorCode === "RateLimited") {
    void emitWebhookEvent(agent.key.organizationId, "api.rate_limited", {
      apiKeyId: agent.key.id,
      operation: operationName,
    });
  }

  await logApiRequest({
    organizationId: agent.key.organizationId,
    apiKeyId: agent.key.id,
    ts: startedAt,
    operation: operationName,
    kind: op?.kind ?? "query",
    status,
    errorCode,
    missingScope,
    latencyMs: Date.now() - startedAt,
    requestId,
    args: loggedArgs,
  });

  return { status: responseStatus, body: responseBody };
}
