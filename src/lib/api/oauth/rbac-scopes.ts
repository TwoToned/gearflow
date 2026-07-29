import { RESOURCES, rolePermissions } from "../../../../convex/lib/permissionsCore";
import { SELF_ACTIONS, SELF_RESOURCE } from "../../../../convex/lib/scopes";

/**
 * OAuth consent scope narrowing (Phase 7, #1003, design §14 "Scope selection is
 * intersected with the user's live RBAC at consent time"). Reuses
 * `permissionsCore.rolePermissions` — the SAME table `hasPermission`/
 * `requireOrgPermission` read — as the oracle, so a scope offered in the
 * consent screen can never outrun what the consenting user's role can
 * actually do (R-3.1: no parallel "what can this role grant" vocabulary).
 *
 * `owner` is a safety-net special case in `hasPermission` ("always true"); here
 * we read `rolePermissions.owner`'s literal map instead, because narrowing
 * needs an ENUMERABLE ceiling, not a boolean check.
 */

/** Every concrete `resource:action` scope string a role is granted, plus the
 *  personal-scope pair. Unknown/null role -> no scopes (fail closed). */
export function scopesForRole(role: string | null | undefined): string[] {
  if (!role) return [];
  const perms = rolePermissions[role];
  if (!perms) return [];
  const scopes: string[] = [];
  for (const resource of RESOURCES) {
    const actions = perms[resource];
    if (!actions) continue;
    for (const action of actions) scopes.push(`${resource}:${action}`);
  }
  for (const action of SELF_ACTIONS) scopes.push(`${SELF_RESOURCE}:${action}`);
  return scopes;
}

/**
 * Narrow a requested scope list (from the OAuth `scope` request parameter) down
 * to what `role` is actually granted — expanding `*`/`resource:*` wildcards to
 * the concrete scopes the role holds rather than admitting the wildcard
 * literally, so the STORED grant is never broader than what consent actually
 * covers (and stays honest if the user's role is later demoted — decision 2's
 * "fail closed" posture, applied to grants too).
 */
export function narrowScopesToRole(
  requested: readonly string[],
  role: string | null | undefined,
): string[] {
  const allowed = scopesForRole(role);
  const allowedSet = new Set(allowed);
  const result = new Set<string>();

  for (const scope of requested) {
    if (scope === "*") {
      allowed.forEach((s) => result.add(s));
      continue;
    }
    if (scope.endsWith(":*")) {
      const resourcePrefix = `${scope.slice(0, -1)}`; // "resource:"
      allowed.filter((s) => s.startsWith(resourcePrefix)).forEach((s) => result.add(s));
      continue;
    }
    if (allowedSet.has(scope)) result.add(scope);
  }
  return [...result].sort();
}

const ACTION_LABELS: Record<string, string> = {
  read: "View",
  view: "View",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  import: "Import",
  export: "Export",
  manage_line_items: "Manage line items on",
  generate_documents: "Generate documents for",
  check_out: "Check out",
  check_in: "Check in",
  scan: "Scan pick-lists for",
  close: "Close",
  quick_test: "Quick-test",
  generate_reports: "Generate test/tag reports for",
  generate: "Generate",
  send: "Send",
  invite: "Invite members to",
  update_role: "Change member roles in",
  remove: "Remove members from",
  publish: "Publish",
  issue: "Issue",
  void: "Void",
  xero_push: "Push to Xero for",
  xero_manage: "Manage the Xero connection for",
};

const RESOURCE_LABELS: Record<string, string> = {
  asset: "assets",
  bulkAsset: "bulk assets",
  model: "models",
  kit: "kits",
  project: "projects",
  client: "clients",
  warehouse: "the warehouse",
  testTag: "test & tag records",
  maintenance: "maintenance records",
  location: "locations",
  document: "documents",
  orgSettings: "organization settings",
  orgMembers: "organization members",
  supplier: "suppliers",
  subHire: "sub-hires",
  crew: "crew",
  reports: "reports",
  checkItem: "check items",
  invoice: "invoices/quotes",
  self: "your own saved views & preferences",
};

/** Plain-language rendering of one `resource:action` scope for the consent
 *  screen (design §14: "lists the scopes requested... in plain language"). */
export function describeScope(scope: string): string {
  const [resource, action] = scope.split(":");
  if (!resource || !action) return scope;
  const actionLabel = ACTION_LABELS[action] ?? action;
  const resourceLabel = RESOURCE_LABELS[resource] ?? resource;
  return `${actionLabel} ${resourceLabel}`;
}
