import type { Auth } from "convex/server";

/**
 * Convex-side auth enforcement for the Phase 5 auth bridge.
 *
 * Trust model (full write-up: docs/designs/convex-phase5-auth-bridge.md):
 *   • SERVICE token — minted in-process by the Next.js backend
 *     (auth.api.signJWT). Carries sub="gearflow-service" + svc:true. The trusted
 *     server already ran requirePermission/validation, so the service identity
 *     grants everything (reads any org, all writes).
 *   • USER token — Better Auth /api/auth/token (session-gated). Carries the real
 *     user id as sub + orgId/role claims. Grants org-scoped READS only; browser
 *     writes are rejected (RBAC stays in Prisma — Convex is never the authZ
 *     source of truth).
 *
 * Both are ES256 JWTs validated by the same customJwt provider (convex/auth.config.ts).
 *
 * The literals below MIRROR src/lib/convex-auth-constants.ts — keep in sync.
 */

const SERVICE_SUBJECT = "gearflow-service";

type AuthCtx = { auth: Auth };

export type ConvexAuthContext =
  | { kind: "service" }
  | { kind: "user"; userId: string; orgId: string | null; role: string | null };

/**
 * Resolve the verified identity to a service/user context, or null if absent.
 * Service detection is STRICT (defense-in-depth, per codex review): BOTH the
 * reserved subject AND svc===true. Any other token bearing svc is malformed and
 * is rejected outright rather than downgraded to a user.
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
  if (identity.svc === true) return null;

  const orgId = typeof identity.orgId === "string" ? identity.orgId : null;
  const role = typeof identity.role === "string" ? identity.role : null;
  return { kind: "user", userId: identity.subject, orgId, role };
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

/** Throw unless the caller is the trusted GearFlow backend. Use for all writes. */
export async function requireService(ctx: AuthCtx): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth || auth.kind !== "service") {
    throw new Error("Unauthorized: this operation requires the GearFlow server.");
  }
}

/**
 * Org-scoped read guard for `list(orgId)`. Service ⇒ allow. User ⇒ their token's
 * orgId must equal the requested org. Anonymous ⇒ reject.
 */
export async function requireOrgRead(
  ctx: AuthCtx,
  orgId: string,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new Error("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!auth.orgId || auth.orgId !== orgId) {
    throw new Error("Forbidden: organization mismatch.");
  }
}

/**
 * Org-scoped read guard for `getById`, checked against the fetched doc. Service
 * ⇒ allow. User ⇒ the doc must belong to their org. A null doc (not found) is
 * fine once identity is established — there is nothing to leak.
 */
export async function requireOrgReadDoc(
  ctx: AuthCtx,
  doc: { organizationId?: string | null } | null,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (!auth) throw new Error("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!doc) return;
  if (!auth.orgId || doc.organizationId !== auth.orgId) {
    throw new Error("Forbidden: organization mismatch.");
  }
}
