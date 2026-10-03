/**
 * Plain-English role explainers for the assignable built-in roles — the ONE
 * place this exists (R-3.1). Written for the invite flow (`InviteMember`,
 * the wizard's `StepTeamGear`), not the permission-matrix UI, which already
 * has its own detailed `PERMISSION_REGISTRY` (`src/lib/permissions.ts`).
 *
 * Deliberately hand-summarized from `rolePermissions`
 * (`convex/lib/permissionsCore.ts`) rather than derived from it — a
 * generated sentence from a permission list reads like a legal document,
 * not something a new admin skims in three seconds while inviting someone.
 *
 * Excludes `owner` (never assignable via invite — transferred, not
 * granted) and includes `warehouse`, which `roleLabels`
 * (`src/lib/permissions.ts`) already lists as a real, permissioned role but
 * which the invite dropdown's own hand-kept list had drifted out of sync
 * with (fixed alongside this module).
 */
export interface RoleOption {
  value: "admin" | "manager" | "member" | "warehouse" | "viewer";
  label: string;
  description: string;
}

export const ASSIGNABLE_ROLE_OPTIONS: RoleOption[] = [
  { value: "admin", label: "Admin", description: "Full access, including billing and settings." },
  { value: "manager", label: "Manager", description: "Runs the day-to-day — projects, quotes, gear — without settings or billing." },
  { value: "member", label: "Member", description: "Creates and edits projects and gear. No settings access." },
  { value: "warehouse", label: "Warehouse", description: "Check gear in and out, scan, close pull sheets. Read-only everywhere else." },
  { value: "viewer", label: "Viewer", description: "Read-only access across the app." },
];
