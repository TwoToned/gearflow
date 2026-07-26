/**
 * Isomorphic RBAC core — the pure permission logic shared by the Next.js server
 * (`src/lib/permissions.ts` re-exports it) AND Convex functions.
 *
 * This file MUST stay import-free / side-effect-free so it bundles cleanly into
 * BOTH the Next build and the Convex deployment. Do NOT add Prisma, Node, browser,
 * or `@/`-aliased imports here — Convex's bundler resolves only relative paths and
 * packages, and any server-only dependency would break the Convex push.
 *
 * Why it lives under convex/lib: the Phase 1 `requireOrgPermission` guard
 * (convex/lib/auth.ts) imports it with a plain relative path, while `src/` reaches
 * it the same way the codebase already imports `convex/_generated` (relative).
 * One source of truth for "role Z can do action A on resource R".
 *
 * The UI-only registry (PERMISSION_REGISTRY) and display labels (roleLabels) stay
 * in src/lib/permissions.ts — Convex never needs them.
 */

export const RESOURCES = [
  "asset",
  "bulkAsset",
  "model",
  "kit",
  "project",
  "client",
  "warehouse",
  "testTag",
  "maintenance",
  "location",
  "document",
  "orgSettings",
  "orgMembers",
  "supplier",
  "subHire",
  "crew",
  "reports",
  "checkItem",
] as const;

export type Resource = (typeof RESOURCES)[number];

export type Action = string;

/** Full permission map: resource -> array of allowed actions */
export type PermissionMap = Partial<Record<Resource, readonly string[]>>;

// ─── Built-in role defaults ─────────────────────────────────────────────────

const ALL_ASSET = ["create", "read", "update", "delete", "import", "export"] as const;
const ALL_CRUD = ["create", "read", "update", "delete"] as const;
const ALL_PROJECT = ["create", "read", "update", "delete", "manage_line_items", "generate_documents"] as const;

export const rolePermissions: Record<string, PermissionMap> = {
  owner: {
    asset: ALL_ASSET,
    bulkAsset: ALL_CRUD,
    model: ALL_ASSET,
    kit: ALL_CRUD,
    project: ALL_PROJECT,
    client: ALL_CRUD,
    warehouse: ["read", "check_out", "check_in", "scan", "close"],
    testTag: ["create", "read", "update", "delete", "quick_test", "generate_reports"],
    maintenance: ALL_CRUD,
    location: ALL_CRUD,
    document: ["generate", "send"],
    orgSettings: ["read", "update"],
    orgMembers: ["read", "invite", "update_role", "remove"],
    supplier: ALL_CRUD,
    subHire: ALL_CRUD,
    crew: ALL_CRUD,
    reports: ["view", "export", "create", "delete"],
    checkItem: ALL_CRUD,
  },
  admin: {
    asset: ALL_ASSET,
    bulkAsset: ALL_CRUD,
    model: ALL_ASSET,
    kit: ALL_CRUD,
    project: ALL_PROJECT,
    client: ALL_CRUD,
    warehouse: ["read", "check_out", "check_in", "scan", "close"],
    testTag: ["create", "read", "update", "delete", "quick_test", "generate_reports"],
    maintenance: ALL_CRUD,
    location: ALL_CRUD,
    document: ["generate", "send"],
    orgSettings: ["read", "update"],
    orgMembers: ["read", "invite", "update_role", "remove"],
    supplier: ALL_CRUD,
    subHire: ALL_CRUD,
    crew: ALL_CRUD,
    reports: ["view", "export", "create", "delete"],
    checkItem: ALL_CRUD,
  },
  manager: {
    asset: ["create", "read", "update", "import", "export"],
    bulkAsset: ["create", "read", "update"],
    model: ["create", "read", "update", "import", "export"],
    kit: ["create", "read", "update"],
    project: ["create", "read", "update", "manage_line_items", "generate_documents"],
    client: ["create", "read", "update"],
    warehouse: ["read", "check_out", "check_in", "scan", "close"],
    testTag: ["create", "read", "update", "quick_test", "generate_reports"],
    maintenance: ["create", "read", "update"],
    location: ["create", "read", "update"],
    document: ["generate", "send"],
    orgSettings: ["read"],
    orgMembers: ["read"],
    supplier: ["create", "read", "update"],
    subHire: ["create", "read", "update"],
    crew: ["create", "read", "update"],
    reports: ["view", "export", "create", "delete"],
    checkItem: ALL_CRUD,
  },
  member: {
    asset: ["create", "read", "update"],
    bulkAsset: ["create", "read", "update"],
    model: ["create", "read", "update"],
    kit: ["read"],
    project: ["create", "read", "update", "manage_line_items", "generate_documents"],
    client: ["create", "read", "update"],
    warehouse: ["read", "check_out", "check_in", "scan"],
    testTag: ["create", "read", "update", "quick_test"],
    maintenance: ["create", "read", "update"],
    location: ["read"],
    document: ["generate"],
    orgSettings: [],
    orgMembers: ["read"],
    supplier: ["read"],
    subHire: ["create", "read"],
    crew: ["read"],
    reports: ["view"],
    checkItem: ["read"],
  },
  // `staff` role removed (Wave 2) — was a duplicate of `member` with identical
  // permissions. Existing `staff` members are migrated to `member` via the
  // consolidate-staff-role migration. Better Auth's memberRoleHierarchy and
  // sso-provisioning ROLE_HIERARCHY no longer list it. UI dropdowns no longer
  // offer it.
  warehouse: {
    asset: ["read"],
    bulkAsset: ["read"],
    model: ["read"],
    kit: ["read"],
    project: ["read"],
    client: ["read"],
    warehouse: ["read", "check_out", "check_in", "scan", "close"],
    testTag: ["read"],
    maintenance: ["read"],
    location: ["read"],
    document: [],
    orgSettings: [],
    orgMembers: [],
    supplier: ["read"],
    subHire: ["read"],
    crew: ["read"],
    reports: ["view"],
    checkItem: ["read"],
  },
  viewer: {
    asset: ["read"],
    bulkAsset: ["read"],
    model: ["read"],
    kit: ["read"],
    project: ["read"],
    client: ["read"],
    warehouse: [],
    testTag: ["read"],
    maintenance: ["read"],
    location: ["read"],
    document: [],
    orgSettings: [],
    orgMembers: [],
    supplier: ["read"],
    subHire: ["read"],
    crew: ["read"],
    reports: ["view"],
    checkItem: ["read"],
  },
};

/**
 * Check if a built-in role has a specific permission. Custom roles were removed
 * (only built-in roles remain); an unknown role string (incl. any legacy "custom:…")
 * resolves to no permissions — fail closed.
 */
export function hasPermission(
  role: string,
  resource: Resource,
  action: string,
): boolean {
  // Owner always has all permissions (safety net)
  if (role === "owner") {
    return true;
  }

  // Built-in role: use static map. Unknown role → no permissions.
  const perms = rolePermissions[role];
  if (!perms) return false;
  return perms[resource]?.includes(action) ?? false;
}

/**
 * Check if a permission map has ANY write permission (create/update/delete).
 * Used to determine if a user is effectively read-only.
 */
export function isReadOnly(permissions: PermissionMap): boolean {
  for (const resource of RESOURCES) {
    const actions = permissions[resource];
    if (!actions) continue;
    for (const action of actions) {
      if (action !== "read" && action !== "view") return false;
    }
  }
  return true;
}

/** All org roles in hierarchy order */
export const ORG_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Built-in roles that can be assigned (excludes owner — owner is transferred) */
export const ASSIGNABLE_BUILT_IN_ROLES = ["admin", "manager", "member", "viewer"] as const;

/** Check if a role string is a built-in role */
export function isBuiltInRole(role: string): boolean {
  return role in rolePermissions;
}

// ─── Org-scoped RBAC decision (native read layer) ───────────────────────────
//
// The PURE decision behind the Convex `requireOrgPermission` guard. Keeping it
// here (isomorphic, import-free) means the Convex guard and the server-action
// path (`requirePermission`) share the SAME logic — so a unit test on this
// function IS the RBAC parity test between native reads and server actions.
//
// The ctx/db plumbing (resolve identity, look up the member row by (org,user)
// with .first(), look up + org-scope the custom role, JSON.parse its permissions)
// lives in convex/lib/auth.ts and feeds resolved inputs to this function.

/** Minimal auth shape — mirrors ConvexAuthContext without importing convex/server. */
export type OrgPermissionAuth =
  | { kind: "service" }
  | { kind: "user"; userId: string; orgId: string | null }
  | null;

export type OrgPermissionDecision =
  | "allow"
  | "deny:unauthenticated"
  | "deny:org-mismatch"
  | "deny:not-member"
  | "deny:insufficient";

export interface OrgPermissionInput {
  auth: OrgPermissionAuth;
  /** Org the query is being asked to read. */
  requestedOrgId: string;
  /** The caller's member row for (requestedOrgId, userId), or null if none. */
  member: { role: string } | null;
}

/**
 * Decide whether the caller may perform `action` on `resource` within
 * `requestedOrgId`. Service identity bypasses (the trusted backend already ran
 * requirePermission). A user must (a) match the requested org, (b) be a member,
 * and (c) pass hasPermission for their role.
 */
export function decideOrgPermission(
  input: OrgPermissionInput,
  resource: Resource,
  action: string,
): OrgPermissionDecision {
  const { auth, requestedOrgId, member } = input;
  if (!auth) return "deny:unauthenticated";
  if (auth.kind === "service") return "allow"; // trusted server already authorized
  if (!auth.orgId || auth.orgId !== requestedOrgId) return "deny:org-mismatch";
  if (!member) return "deny:not-member";
  return hasPermission(member.role, resource, action)
    ? "allow"
    : "deny:insufficient";
}
