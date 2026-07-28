import { deriveWriteIds } from "./idempotency";

/**
 * The argument normalizer (design §8) — ONE small rule table, keyed on arg
 * NAME, applied uniformly across every operation. The `*Native` mutations are
 * UI-shaped (built for a browser that already knows its own actor/org/clock);
 * an agent must not have to know that, so the dispatcher injects these before
 * the call ever reaches Convex — and, for the fields the SERVER must own
 * (identity, org, time), overwrites whatever the caller supplied rather than
 * merely defaulting it.
 *
 * `id`/`auditId` are special: `auditId` is always a fresh activity-log row and
 * is minted on every mutation that declares it, but `id` means two different
 * things depending on the operation shape —
 *   • on a CREATE-shaped mutation (fn name starting `create`/`add`) it is the
 *     new row's cuid, so it is minted exactly like `auditId`;
 *   • on every other mutation (`update*`, `remove*`, `delete*`, `archive*`,
 *     `patch*`, …) and on every query, `id` names an EXISTING row the caller
 *     is pointing at — the normalizer must never touch it, or the write would
 *     silently target the wrong row (or a row that doesn't exist).
 * `isCreateShaped` below is the single place that distinguishes the two.
 */

const CREATE_FN_RE = /^(create|add)/i;

/** True for a Convex fn name that MINTS a new row (so its `id` arg is ours to derive). */
export function isCreateShapedFn(fn: string): boolean {
  return CREATE_FN_RE.test(fn);
}

export interface NormalizeContext {
  /** `"<module>.<fn>"` — matches `RegistryOperation.operation`. */
  operation: string;
  fn: string;
  kind: "query" | "mutation";
  /** Arg names this operation's Convex validator actually declares. */
  argNames: ReadonlySet<string>;
  actor: { userId: string; userName: string };
  organizationId: string;
  /** Required for a mutation whose args include `auditId` or a create-shaped `id`. */
  idempotencyKey: string | null;
  nowMs: number;
  /** Whether the caller's key holds `<resource>:<action>`. */
  hasScope: (resource: string, action: string) => boolean;
}

/**
 * Injected arg NAMES for one operation — the fields the agent never supplies
 * because the dispatcher owns them. Used both to normalize a real call and to
 * strip these from the published OpenAPI/MCP schemas (design §8).
 */
export function injectedArgNames(argNames: ReadonlySet<string>, fn: string): Set<string> {
  const out = new Set<string>();
  if (argNames.has("actor")) out.add("actor");
  if (argNames.has("auditId")) out.add("auditId");
  if (argNames.has("id") && isCreateShapedFn(fn)) out.add("id");
  if (argNames.has("now")) out.add("now");
  if (argNames.has("orgId")) out.add("orgId");
  if (argNames.has("organizationId")) out.add("organizationId");
  // emitSideEffects/allowOverbook are FORCED, not stripped — allowOverbook stays
  // agent-settable (gated by scope), emitSideEffects stays visible-but-fixed so a
  // caller reading the response back can see it was true, not merely absent.
  return out;
}

/**
 * Splits one flat `set` patch object into Convex's `{ set, clear }` pair: a
 * `null`/`""` value in the agent's patch means "clear this field", matching the
 * `patchAsset` clear-to-null convention every `*Native` update already uses
 * (assetWrites.updateNative etc.). The agent only ever sends `set` — `clear` is
 * synthesized here, never something the agent authors directly.
 */
function splitSetClear(rawSet: unknown, existingClear: unknown): { set: Record<string, unknown>; clear: string[] } {
  const set: Record<string, unknown> = {};
  const clear: string[] = Array.isArray(existingClear) ? [...(existingClear as string[])] : [];
  if (rawSet && typeof rawSet === "object" && !Array.isArray(rawSet)) {
    for (const [key, value] of Object.entries(rawSet as Record<string, unknown>)) {
      if (value === null || value === "") clear.push(key);
      else set[key] = value;
    }
  }
  return { set, clear: [...new Set(clear)] };
}

function requireIdempotencyKey(ctx: NormalizeContext, reason: string): string {
  if (!ctx.idempotencyKey) {
    throw new Error(`${ctx.operation}: idempotencyKey is required (${reason}).`);
  }
  return ctx.idempotencyKey;
}

function applyActor(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("actor")) return;
  args.actor = { userId: ctx.actor.userId, userName: ctx.actor.userName };
}

function applyAuditId(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("auditId")) return;
  const key = requireIdempotencyKey(ctx, "this write is audited");
  args.auditId = deriveWriteIds(key, ctx.operation).auditId;
}

function applyCreateId(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("id") || !isCreateShapedFn(ctx.fn)) return;
  const key = requireIdempotencyKey(ctx, "this operation creates a row");
  args.id = deriveWriteIds(key, ctx.operation).id;
}

function applyNow(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("now")) return;
  args.now = ctx.nowMs;
}

function applyEmitSideEffects(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("emitSideEffects")) return;
  args.emitSideEffects = true;
}

function applyAllowOverbook(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("allowOverbook")) return;
  const requested = args.allowOverbook === true;
  args.allowOverbook = requested && ctx.hasScope("project", "allow_overbook");
}

function applySetClear(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (!ctx.argNames.has("set") || !ctx.argNames.has("clear")) return;
  const { set, clear } = splitSetClear(args.set, args.clear);
  args.set = set;
  args.clear = clear;
}

/**
 * orgId/organizationId: injected from the key's org, NEVER read from the
 * caller's body (R-9.3) — overwritten unconditionally, not merely defaulted,
 * so a caller naming another org's id gets its OWN org's data, not a leak.
 */
function applyOrg(args: Record<string, unknown>, ctx: NormalizeContext): void {
  if (ctx.argNames.has("orgId")) args.orgId = ctx.organizationId;
  if (ctx.argNames.has("organizationId")) args.organizationId = ctx.organizationId;
}

const NORMALIZE_STEPS = [
  applyActor,
  applyAuditId,
  applyCreateId,
  applyNow,
  applyEmitSideEffects,
  applyAllowOverbook,
  applySetClear,
  applyOrg,
];

/**
 * Apply the arg normalizer to one operation call. `rawArgs` is exactly what the
 * agent sent (already Zod-validated against the business schema, where one
 * exists); the return value is what gets passed to the Convex function —
 * server-owned fields injected/overwritten, `set`/`clear` split, `allowOverbook`
 * forced closed absent the scope. Each rule from the design's §8 table is its
 * own `apply*` step above, run in sequence — keeps this function itself a flat
 * pipeline rather than one long conditional chain (R-3.6).
 */
export function normalizeArgs(rawArgs: Record<string, unknown>, ctx: NormalizeContext): Record<string, unknown> {
  const args: Record<string, unknown> = { ...rawArgs };
  for (const step of NORMALIZE_STEPS) step(args, ctx);
  return args;
}
