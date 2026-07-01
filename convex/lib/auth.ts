import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import {
  decideOrgPermission,
  type Resource,
  type PermissionMap,
  type OrgPermissionDecision,
} from "./permissionsCore";

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
 *
 * These guards throw `ConvexError`, NOT a plain `Error`. A plain `Error` thrown
 * from a Convex function in a PRODUCTION deployment is masked to the client as the
 * generic `{"code":"InternalServerError","message":"Your request couldn't be
 * completed. Try again later."}` — the real reason only ever lands in the Convex
 * backend logs. `ConvexError`'s payload IS delivered to the caller, so an
 * auth failure on a server-action read surfaces its actual message ("Unauthorized…"
 * / "Forbidden…") in the Next.js log + Sentry instead of the unactionable mask.
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
    throw new ConvexError("Unauthorized: this operation requires the GearFlow server.");
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
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!auth.orgId || auth.orgId !== orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
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
  if (!auth) throw new ConvexError("Unauthorized: authentication required.");
  if (auth.kind === "service") return;
  if (!doc) return;
  if (!auth.orgId || doc.organizationId !== auth.orgId) {
    throw new ConvexError("Forbidden: organization mismatch.");
  }
}

// ─── RBAC permission guard (native read layer, Phase 1) ─────────────────────
//
// requireOrgRead enforces only ORG-SCOPING. requireOrgPermission additionally
// enforces RESOURCE/ACTION permissions inside Convex, so a browser-facing
// composite query grants exactly what the server-action `requirePermission`
// would (docs/designs/convex-native-read-layer.md §3.3). The decision logic is
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

/** Parse a stored custom-role permissions JSON string; null on absent/invalid. */
function parseCustomPermissions(raw: string | undefined): PermissionMap | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PermissionMap;
  } catch {
    return null; // malformed → no permissions (deny), never throw
  }
}

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
 * Service ⇒ allow. User ⇒ org match + membership + role permission. Throws
 * `ConvexError` (never plain Error) so the reason survives the prod boundary.
 */
export async function requireOrgPermission(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  resource: Resource,
  action: string,
): Promise<void> {
  const auth = await getAuthContext(ctx);
  if (auth?.kind === "service") return; // trusted backend already authorized

  let member: { role: string } | null = null;
  let customPermissions: PermissionMap | null = null;

  if (auth?.kind === "user" && auth.orgId === orgId) {
    const row = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", orgId).eq("userId", auth.userId),
      )
      .first();
    member = row ? { role: row.role } : null;

    if (member && member.role.startsWith("custom:")) {
      const customRoleId = member.role.slice("custom:".length);
      const custom = await ctx.db
        .query("customRoles")
        .withIndex("by_cuid", (q) => q.eq("id", customRoleId))
        .first();
      // Org-scope the role: a custom role belonging to another org must NOT grant
      // here (mirrors src/server/custom-roles.ts org scoping). Missing/cross-org
      // → null perms → hasPermission denies.
      customPermissions =
        custom && custom.organizationId === orgId
          ? parseCustomPermissions(custom.permissions)
          : null;
    }
  }

  const decision = decideOrgPermission(
    { auth, requestedOrgId: orgId, member, customPermissions },
    resource,
    action,
  );
  if (decision !== "allow") {
    throw new ConvexError(orgPermissionMessage(decision));
  }
}
