/**
 * Role-based permission system for GearFlow.
 *
 * Two types of roles:
 * 1. Built-in roles (owner, admin, manager, member, staff, warehouse, viewer)
 *    — static defaults, always available.
 * 2. Custom roles (stored per-org in the custom_role table)
 *    — role string is "custom:<id>", permissions stored as JSON.
 *
 * The PERMISSION_REGISTRY defines every resource and its possible actions.
 * This is the single source of truth for the permission matrix UI.
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
  "crew",
  "reports",
] as const;

export type Resource = (typeof RESOURCES)[number];

export type Action = string;

/** Full permission map: resource -> array of allowed actions */
export type PermissionMap = Partial<Record<Resource, readonly string[]>>;

/** Registry of all resources and their possible actions — drives the matrix UI */
export const PERMISSION_REGISTRY: Record<
  Resource,
  { label: string; actions: { key: string; label: string }[] }
> = {
  asset: {
    label: "Assets (Serialized)",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "import", label: "Import" },
      { key: "export", label: "Export" },
    ],
  },
  bulkAsset: {
    label: "Bulk Assets",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  model: {
    label: "Models",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "import", label: "Import" },
      { key: "export", label: "Export" },
    ],
  },
  kit: {
    label: "Kits",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  project: {
    label: "Projects",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "manage_line_items", label: "Manage Line Items" },
      { key: "generate_documents", label: "Generate Documents" },
    ],
  },
  client: {
    label: "Clients",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  warehouse: {
    label: "Warehouse",
    actions: [
      { key: "read", label: "View" },
      { key: "check_out", label: "Deploy" },
      { key: "check_in", label: "Return" },
      { key: "scan", label: "Scan" },
    ],
  },
  testTag: {
    label: "Test & Tag",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "quick_test", label: "Quick Test" },
      { key: "generate_reports", label: "Generate Reports" },
    ],
  },
  maintenance: {
    label: "Maintenance",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  location: {
    label: "Locations",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  document: {
    label: "Documents & PDFs",
    actions: [
      { key: "generate", label: "Generate" },
      { key: "send", label: "Send" },
    ],
  },
  orgSettings: {
    label: "Organisation Settings",
    actions: [
      { key: "read", label: "View" },
      { key: "update", label: "Edit" },
    ],
  },
  orgMembers: {
    label: "Team Members",
    actions: [
      { key: "read", label: "View" },
      { key: "invite", label: "Invite" },
      { key: "update_role", label: "Change Roles" },
      { key: "remove", label: "Remove" },
    ],
  },
  supplier: {
    label: "Suppliers",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  crew: {
    label: "Crew",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  reports: {
    label: "Reports",
    actions: [
      { key: "view", label: "View" },
      { key: "export", label: "Export" },
    ],
  },
};

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
    warehouse: ["read", "check_out", "check_in", "scan"],
    testTag: ["create", "read", "update", "delete", "quick_test", "generate_reports"],
    maintenance: ALL_CRUD,
    location: ALL_CRUD,
    document: ["generate", "send"],
    orgSettings: ["read", "update"],
    orgMembers: ["read", "invite", "update_role", "remove"],
    supplier: ALL_CRUD,
    crew: ALL_CRUD,
    reports: ["view", "export"],
  },
  admin: {
    asset: ALL_ASSET,
    bulkAsset: ALL_CRUD,
    model: ALL_ASSET,
    kit: ALL_CRUD,
    project: ALL_PROJECT,
    client: ALL_CRUD,
    warehouse: ["read", "check_out", "check_in", "scan"],
    testTag: ["create", "read", "update", "delete", "quick_test", "generate_reports"],
    maintenance: ALL_CRUD,
    location: ALL_CRUD,
    document: ["generate", "send"],
    orgSettings: ["read", "update"],
    orgMembers: ["read", "invite", "update_role", "remove"],
    supplier: ALL_CRUD,
    crew: ALL_CRUD,
    reports: ["view", "export"],
  },
  manager: {
    asset: ["create", "read", "update", "import", "export"],
    bulkAsset: ["create", "read", "update"],
    model: ["create", "read", "update", "import", "export"],
    kit: ["create", "read", "update"],
    project: ["create", "read", "update", "manage_line_items", "generate_documents"],
    client: ["create", "read", "update"],
    warehouse: ["read", "check_out", "check_in", "scan"],
    testTag: ["create", "read", "update", "quick_test", "generate_reports"],
    maintenance: ["create", "read", "update"],
    location: ["create", "read", "update"],
    document: ["generate", "send"],
    orgSettings: ["read"],
    orgMembers: ["read"],
    supplier: ["create", "read", "update"],
    crew: ["create", "read", "update"],
    reports: ["view", "export"],
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
    orgMembers: [],
    supplier: ["read"],
    crew: ["read"],
    reports: ["view"],
  },
  staff: {
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
    orgMembers: [],
    supplier: ["read"],
    crew: ["read"],
    reports: ["view"],
  },
  warehouse: {
    asset: ["read"],
    bulkAsset: ["read"],
    model: ["read"],
    kit: ["read"],
    project: ["read"],
    client: ["read"],
    warehouse: ["read", "check_out", "check_in", "scan"],
    testTag: ["read"],
    maintenance: ["read"],
    location: ["read"],
    document: [],
    orgSettings: [],
    orgMembers: [],
    supplier: ["read"],
    crew: ["read"],
    reports: ["view"],
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
    crew: ["read"],
    reports: ["view"],
  },
};

/**
 * Check if a role has a specific permission.
 * For custom roles (prefixed "custom:"), pass the resolved permissions map.
 */
export function hasPermission(
  role: string,
  resource: Resource,
  action: string,
  customPermissions?: PermissionMap | null,
): boolean {
  // Owner always has all permissions (safety net)
  if (role === "owner") {
    return true;
  }

  // Custom role: use provided permissions
  if (role.startsWith("custom:")) {
    if (!customPermissions) return false;
    return customPermissions[resource]?.includes(action) ?? false;
  }

  // Built-in role: use static map
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

/** Role display labels */
export const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  staff: "Staff",
  warehouse: "Warehouse",
  viewer: "Viewer",
};
