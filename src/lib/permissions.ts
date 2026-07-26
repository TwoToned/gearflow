/**
 * Role-based permission system for RVLT Flow.
 *
 * Built-in roles only (owner, admin, manager, member, warehouse, viewer) — static
 * defaults, always available. (Custom roles were removed.)
 *
 * The pure RBAC logic (RESOURCES, rolePermissions, hasPermission, …) now lives in
 * `convex/lib/permissionsCore.ts` so it can be imported by BOTH this Next.js
 * server module and Convex functions — one source of truth for permission checks
 * (Phase 0 of the native read layer).
 * This file re-exports that core and adds the UI-only pieces (the matrix registry
 * and display labels) that Convex never needs.
 */

export {
  RESOURCES,
  rolePermissions,
  hasPermission,
  isReadOnly,
  ORG_ROLES,
  ASSIGNABLE_BUILT_IN_ROLES,
  isBuiltInRole,
} from "../../convex/lib/permissionsCore";
export type {
  Resource,
  Action,
  PermissionMap,
  OrgRole,
} from "../../convex/lib/permissionsCore";

import type { Resource } from "../../convex/lib/permissionsCore";

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
      { key: "close", label: "Close Out" },
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
  subHire: {
    label: "Sub-Hires",
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
      { key: "create", label: "Create Saved Reports" },
      { key: "delete", label: "Delete Saved Reports" },
    ],
  },
  checkItem: {
    label: "Check Items",
    actions: [
      { key: "read", label: "View" },
      { key: "create", label: "Create" },
      { key: "update", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
};

/** Role display labels */
export const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  warehouse: "Warehouse",
  viewer: "Viewer",
};
