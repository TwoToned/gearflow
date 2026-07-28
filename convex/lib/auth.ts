import type { Auth, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import {
  decideOrgPermission,
  isManagerPlusRole,
  type Resource,
  type OrgPermissionDecision,
} from "./permissionsCore";
import { hasScope, parseScopes, SELF_RESOURCE, type SelfAction } from "./scopes";

/**
 * Convex-side auth enforcement for the Phase 5 auth bridge.
 *
 * Trust model:
 *   • SERVICE token — minted in-process by the Next.js backend
 *     (auth.api.signJWT). Carries sub="gearflow-service" + svc:true. The trusted
 *     server already ran requirePermission/validation, so the service identity
 *     grants everything (reads any org, all writes).
 *   • USER token — Better Auth /api/auth/token (session-gated). Carries the real
 *     user id as sub + orgId/role claims. Grants org-scoped reads AND browser-direct
 *     writes; the write path enforces RBAC IN Convex via requireOrgPermission +
 *     resolveActor (which pins the actor to the verified sub — unspoofable).
 *   • AGENT token — minted per-request by the API/MCP dispatcher from a validated
 *     `apiKeys` row (src/lib/api/agent-token.ts). Shaped exactly like a USER token
 *     (sub = the key's actingUserId, orgId) plus an `akid` claim naming the key,
 *     and NEVER `svc`. 60s TTL. It behaves as a user everywhere — same member-row
 *     RBAC, same actor pinning, same kill switch — and additionally passes through
 *     `requireAgentScope` (the key's scopes ∩ the user's live RBAC) and its own
 *     rate-limit bucket. Crucially it FAILS `requireService`, which is what makes
 *     "the API cannot reach raw generated CRUD" structural rather than a rule
 *     someone has to remember. See docs/designs/api-mcp-reimplementation.md §3.
 *
 * All three are ES256 JWTs validated by the same customJwt provider (convex/auth.config.ts).
 *
 * The literals below MIRROR src/lib/convex-auth-constants.ts — keep in sync.
 *
 * These guards throw `ConvexError`, NOT a plain `Error`. A plain `Error` thrown
 * from a Convex function in a PRODUCTION deployment is masked to the client as the
 * generic `{"code":"InternalServerError","message":"Your request couldn't be
 * completed. Try again later."}` — the real reason only ever lands in the Convex
 * backend logs. `ConvexError`'s payload IS delivered to the caller, so an
 * auth failure on a server-action read surfaces its actual message ("Unauthorized…"
 * / "Forbidden…") in the Next.js log + PostHog instead of the unactionable mask.
 */

const SERVICE_SUBJECT = "gearflow-service";

/** JWT claim naming the `apiKeys.id` an AGENT token was minted for. Its PRESENCE
 *  is what makes a token an agent token — mirrored in src/lib/api/agent-token.ts. */
export const AGENT_KEY_CLAIM = "akid";

type AuthCtx = { auth: Auth };
/** Any ctx that can read the db — needed by the scope guards, which re-read the key row. */
type DbCtx = QueryCtx | MutationCtx;

/** The two token kinds that carry a real end-user identity (member-row RBAC applies). */
export type ConvexMemberAuth =
  | { kind: "user"; userId: string; orgId: string | null; role: string | null }
  | {
      kind: "agent";
      userId: string;
      orgId: string | null;
      role: string | null;
      apiKeyId: string;
    };

export type ConvexAuthContext = { kind: "service" } | ConvexMemberAuth;

/**
 * Resolve the verified identity to a service/user/agent context, or null if absent.
 * Service detection is STRICT (defense-in-depth, per codex review): BOTH the
 * reserved subject AND svc===true. Any other token bearing svc is malformed and
 * is rejected outright rather than downgraded to a user — an agent token that
 * somehow carried `svc` must NOT become a valid agent, it must be rejected.
 */
export async function getAuthContext(
  ctx: AuthCtx,
): Promise<ConvexAuthContext | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  if (identity.subject === SERVICE_SUBJECT && identity.svc === true) {
    return { kind: "service" };
  }
  // A non-service token must NEVER carry svc. If it does, it's malformed/hostile.
  // Checked BEFORE the agent branch so `svc` can never be smuggled in alongside
  // `akid` to get a privileged agent.
  if (identity.svc === true) return null;
  // Nor may anything but the reserved subject impersonate the service identity.
  if (identity.subject === SERVICE_SUBJECT) return null;

  return memberAuthFrom(identity);
}

/** Shape a verified non-service identity into a user or agent context. The `akid`
 *  claim is the ONLY difference between the two — everything downstream then
 *  treats them identically apart from the scope check and the rate-limit bucket. */
function memberAuthFrom(identity: UserIdentity): ConvexMemberAuth {
  const userId = identity.subject;
  const orgId = typeof identity.orgId === "string" ? identity.orgId : null;
  const role = typeof identity.role === "string" ? identity.role : null;
  const akid = identity[AGENT_KEY_CLAIM];

  return typeof akid === "string" && akid.length > 0
    ? { kind: "agent", userId, orgId, role, apiKeyId: akid }
    : { kind: "user", userId, orgId, role };
}

/** True for the two identity kinds backed by a member row (user + agent). */
export function isMemberAuth(
  auth: ConvexAuthContext | null,
): auth is ConvexMemberAuth {
  return auth?.kind === "user" || auth?.kind === "agent";
}

/**
 * Return a shallow copy of `doc` with the named fields removed. Used at the read
 * boundary to keep sensitive-but-internal columns (e.g. `crewMembers.icalToken`,
 * a per-member calendar-feed secret) out of BROWSER reads while the trusted
 * service identity still sees the full row. The generated browser-readable
 * queries apply this for non-service callers (see scripts/generate-convex-crud.cjs
 * REDACTED_FIELDS).
 */
export function redactFields<T extends Record<string, unknown>>(
  doc: T,
  fields: readonly string[],
): T {
  const out = { ...doc };
  for (const f of fields) delete (out as Record<string, unknown>)[f];
  return out;
}

/**
 * Throw unless the caller is the trusted RVLT Flow backend. Use for all writes.
 *
 * An AGENT token fails this by construction (`kind: "agent" !== "service"`), and
 * that is load-bearing: it is what makes the 597 service-only functions — raw
 * generated CRUD, mirror writes, backfills, org-export internals — structurally
 * unaddressable from the API/MCP surface rather than merely undocumented.
 * `convex/agentServiceUnreachable.test.ts` machine-checks this across every
 * service-gated function; do not add an agent escape hatch here.
 */
export async function requireService(ctx: AuthCtx): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth || auth.kind !== "service") {
    throw new ConvexError("Unauthorized: this operation requires the RVLT Flow server.");
  }
}

/** Message for the fail-closed agent branch of the resource-less read guards. */
function agentReadNotMigrated(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: "AGENT_READ_NOT_MIGRATED",
    message:
      "This read is not available to API keys yet. It still uses the resource-less " +
      "org read guard, so there is no scope to check it against.",
  });
}

/**
 * Org-scoped read guard for `list(orgId)`. Service ⇒ allow. User ⇒ their token's
 * orgId must equal the requested org. Anonymous ⇒ reject.
 *
 * AGENT ⇒ **reject, always** (decision 2 of the re-implementation design). This
 * guard enforces org-scoping only — it carries no resource, so there is nothing
 * to intersect the key's scopes against, and allowing it through would hand every
 * agent an unscoped read of ~277 call sites. Failing closed makes an unmigrated
 * read *invisible* rather than unscoped, and makes the migration to
 * {@link requireOrgReadFor} incrementally shippable per domain instead of one
 * 350-site commit.
 */
export async function requireOrgRead(
  ctx: AuthCtx,
  orgId: string,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (auth.kind === "agent") throw agentReadNotMigrated();
  if (!auth.orgId || auth.orgId !== orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
  }
}

/**
 * Org-scoped read guard for `getById`, checked against the fetched doc. Service
 * ⇒ allow. User ⇒ the doc must belong to their org. A null doc (not found) is
 * fine once identity is established — there is nothing to leak. AGENT ⇒ reject
 * (same fail-closed rationale as {@link requireOrgRead}).
 */
export async function requireOrgReadDoc(
  ctx: AuthCtx,
  doc: { organizationId?: string | null } | null,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (auth.kind === "agent") throw agentReadNotMigrated();
  if (!doc) return;
  if (!auth.orgId || doc.organizationId !== auth.orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
  }
}

// ─── Agent scope enforcement (API/MCP re-implementation §5) ─────────────────
//
// Effective permission for an agent = live member-row RBAC ∩ the key's scopes,
// re-evaluated on EVERY call. The scope half lives here, in Convex, at the same
// call site as the RBAC half, for four reasons:
//
//   • No mapping table. The mutation already declares its (resource, action) to
//     `requireOrgPermission`; the scope check consumes that same pair. A
//     dispatcher-side operation→scope map would be a second copy of a business
//     rule — a defect even while in sync (R-3.1).
//   • Impossible to forget. A new `*Native` mutation is scope-gated the day it's
//     written, with no extra code.
//   • Instant revocation. The key doc is in the transaction's read set, so a
//     revoke/expiry/deactivation lands on the next call regardless of the token's
//     60s TTL.
//   • Defence in depth. A leaked agent token is a valid Convex JWT; a check in
//     the Node dispatcher would be bypassed by calling Convex directly. This one
//     is not bypassable.
//
// Cost: one indexed point-read per guarded call on a small table. Acceptable.

/**
 * Enforce the KEY-SCOPE half of the intersection for `kind: "agent"` callers.
 * No-op for every other kind (service is trusted; a user token carries the
 * human's full unscoped RBAC).
 *
 * Re-validates the key document itself on every call — active, not revoked, not
 * expired, still bound to the token's org AND to the token's subject — so a
 * revoked key cannot outlive its token, and a token cannot be replayed against a
 * key that has since been re-pointed at a different acting user.
 */
export async function requireAgentScope(
  ctx: DbCtx,
  auth: ConvexAuthContext | null,
  resource: string,
  action: string,
): Promise<void> {
  if (auth?.kind !== "agent") return;

  const key = await ctx.db
    .query("apiKeys")
    .withIndex("by_cuid", (q) => q.eq("id", auth.apiKeyId))
    .first();

  assertKeyStillValid(key, auth);

  if (!hasScope(parseScopes(key?.scopes), resource, action)) {
    // MISSING_SCOPE is deliberately DISTINCT from FORBIDDEN: the key is too
    // narrow (an operator can widen it), versus the acting user's role forbids
    // the action (widening the key would change nothing). Conflating them sends
    // an agent down the wrong recovery path.
    throw new ConvexError({
      code: "MISSING_SCOPE",
      message: `This API key is missing the '${resource}:${action}' scope.`,
      requiredScope: `${resource}:${action}`,
    });
  }
}

/**
 * The key document must still authorise this token, right now, inside this
 * transaction. This is what makes revoke/expiry/re-point land on the NEXT call
 * rather than after the token's 60s TTL, and it is why a leaked agent token is
 * worth so little.
 */
function assertKeyStillValid(
  key: Doc<"apiKeys"> | null,
  auth: Extract<ConvexAuthContext, { kind: "agent" }>,
): void {
  if (!key || key.isActive === false || key.revokedAt != null) {
    throw new ConvexError({
      code: "KEY_INACTIVE",
      message: "This API key has been revoked.",
    });
  }
  if (key.organizationId !== auth.orgId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Forbidden: organization mismatch.",
    });
  }
  // The token pins `sub` to the key's acting user at mint time; re-check it here
  // so a token minted before the key was re-pointed can't keep acting as the old
  // user (and so a hand-forged token naming a different subject is rejected).
  if (key.actingUserId !== auth.userId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Forbidden: this API key does not act as the token's subject.",
    });
  }
  // A present `expiresAt` must be finite and in the future. A non-finite stored
  // value (NaN/Infinity) is treated as expired — fail closed, never "no expiry".
  if (key.expiresAt != null) {
    if (!Number.isFinite(key.expiresAt) || key.expiresAt <= Date.now()) {
      throw new ConvexError({
        code: "KEY_EXPIRED",
        message: "This API key has expired.",
      });
    }
  }
}

/**
 * Org-scoped read guard that ALSO carries a resource, so an agent's key scopes
 * can be intersected against it. The migration target for `requireOrgRead`:
 * swapping a call site over is a one-argument change and makes that query
 * agent-reachable under `<resource>:read`.
 */
export async function requireOrgReadFor(
  ctx: DbCtx,
  orgId: string,
  resource: Resource,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!auth.orgId || auth.orgId !== orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
  }
  await requireAgentScope(ctx, auth, resource, "read");
}

/** Doc-checked counterpart of {@link requireOrgReadFor} (the `getById` shape). */
export async function requireOrgReadDocFor(
  ctx: DbCtx,
  doc: { organizationId?: string | null } | null,
  resource: Resource,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!doc) return;
  if (!auth.orgId || doc.organizationId !== auth.orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
  }
  await requireAgentScope(ctx, auth, resource, "read");
}

/**
 * Personal-scope guard for the operations that authorise on "the verified user's
 * own row" rather than on resource RBAC — `savedTableViews*`,
 * `userNotificationPreferences`, `notificationDismissals`. Those have no natural
 * `Resource`, and folding them into one would over-grant (a `project:read` key
 * has no business reading someone's saved views), so they get their own
 * `self:read` / `self:write` scope pair.
 */
export async function requireSelfScope(
  ctx: DbCtx,
  action: SelfAction,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  await requireAgentScope(ctx, auth, SELF_RESOURCE, action);
}

// ─── RBAC permission guard (native read layer, Phase 1) ─────────────────────
//
// requireOrgRead enforces only ORG-SCOPING. requireOrgPermission additionally
// enforces RESOURCE/ACTION permissions inside Convex, so a browser-facing
// composite query grants exactly what the server-action `requirePermission`
// would. The decision logic is
// the isomorphic `decideOrgPermission` (shared with the server path via
// permissionsCore); this wrapper only resolves the ctx/db inputs:
//   • the caller's member row by (org, user) — `.first()`, NOT `.unique()`, to
//     match Prisma's duplicate-tolerant findFirst (a duplicate mirror row must
//     not crash the read);
//   • for a "custom:<id>" role, the org-scoped custom role + its parsed perms.
//
// Accepts QueryCtx OR MutationCtx: the read path (browser composites) and the
// native write path (Phase 5 asset/line-item/... mutations in convex/*Writes.ts)
// enforce the SAME RBAC through this one guard. It only uses ctx.auth + ctx.db.query,
// both present on either ctx.

function orgPermissionMessage(decision: OrgPermissionDecision): string {
  switch (decision) {
    case "deny:unauthenticated":
      return "Unauthorized: authentication required.";
    case "deny:org-mismatch":
      return "Forbidden: organization mismatch.";
    case "deny:not-member":
      return "Forbidden: not a member of this organization.";
    default:
      return "Forbidden: insufficient permissions.";
  }
}

/**
 * Throw unless the caller may perform `action` on `resource` within `orgId`.
 * Service ⇒ allow. User ⇒ org match + membership + role permission. Agent ⇒ the
 * same member-row RBAC as a user, INTERSECTED with the API key's scopes.
 *
 * Order matters: the agent scope/key-validity check runs FIRST, so a revoked or
 * expired key surfaces `KEY_INACTIVE`/`KEY_EXPIRED` (an auth-level fact) rather
 * than a misleading `FORBIDDEN`, and a too-narrow key surfaces `MISSING_SCOPE`.
 * RBAC still has the final say — a `*`-scoped key on a `crew` acting user is
 * still crew-limited, because `decideOrgPermission` runs afterwards on the live
 * member row.
 *
 * Throws `ConvexError` (never plain Error) so the reason survives the prod boundary.
 */
export async function requireOrgPermission(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  resource: Resource,
  action: string,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind === "service") return; // trusted backend already authorized

  await requireAgentScope(ctx, auth, resource, action);

  let member: { role: string } | null = null;

  if (isMemberAuth(auth) && auth.orgId === orgId) {
    const row = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", orgId).eq("userId", auth.userId),
      )
      .first();
    member = row ? { role: row.role } : null;
  }

  const decision = decideOrgPermission(
    { auth, requestedOrgId: orgId, member },
    resource,
    action,
  );
  if (decision !== "allow") {
    throw new ConvexError(orgPermissionMessage(decision));
  }
}

/**
 * Manager+ (owner/admin/manager) standing for the caller within `orgId` — the
 * server-side half of the "cost + margin visible to manager+ only" gate (WS10 #949).
 * Service identity (trusted backend) always counts as manager+ — it already ran its
 * own authorization. A user token re-queries the member row (NOT the JWT's `role`
 * claim, which can be stale after a demotion) — same lookup `requireOrgPermission`
 * uses, so the two can never disagree.
 */
export async function isCallerManagerPlus(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind === "service") return true;
  // An agent inherits the acting user's standing — "the key acts as a human".
  // (Field-level suppression for keys flagged `noFinancials` is Phase 4.)
  if (!isMemberAuth(auth) || auth.orgId !== orgId) return false;
  const row = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", auth.userId))
    .first();
  return isManagerPlusRole(row?.role ?? null);
}

// ─── Actor identity (Phase 3 — browser-direct security baseline) ────────────
//
// The `actor` mutation arg (userId + userName for the audit trail) is
// CLIENT-SUPPLIED, and every `*Writes.ts` mutation is PUBLIC and reachable by a
// user token (requireOrgPermission permits a member with the role). So a caller
// can attribute a write to ANY userId in the activity log — a real spoofing hole
// that becomes load-bearing the moment writes go browser-direct. `resolveActor`
// is the fix: it pins attribution to the VERIFIED token identity.
//
//   • SERVICE token — the trusted Next.js backend already authenticated the real
//     end-user and passes their id/name; a service call has no user identity of
//     its own, so `supplied` is trusted verbatim.
//   • USER token — `userId` is OVERWRITTEN with the token subject (unspoofable);
//     `userName` is resolved from the `users` mirror, falling back to the supplied
//     label (display-only — once userId is pinned, the label can't forge attribution).
//   • No identity — reject.
//
// Every mutation that takes an `actor` arg MUST resolve it through this before
// using it for the audit trail. Accepts QueryCtx or MutationCtx (uses ctx.auth +
// ctx.db.query only).

export interface Actor {
  userId: string;
  userName: string;
}

export async function resolveActor(
  ctx: QueryCtx | MutationCtx,
  supplied: Actor,
): Promise<Actor> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return supplied;

  // User token: the verified subject is the ONLY trustworthy attribution. Resolve
  // the display name from the users mirror; if the mirror row is missing (rare —
  // members+users are mirrored together, and a member row already passed RBAC),
  // fall back to the verified userId, NEVER the client-supplied label (which the
  // caller could set to impersonate someone in the "by …" audit attribution). The
  // activity UI joins the users row for the pretty name anyway.
  const userRow = await ctx.db
    .query("users")
    .withIndex("by_cuid", (q) => q.eq("id", auth.userId))
    .first();
  return {
    userId: auth.userId,
    userName: userRow?.name ?? auth.userId,
  };
}
