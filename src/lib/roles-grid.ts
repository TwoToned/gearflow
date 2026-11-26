import { PERMISSION_REGISTRY, RESOURCES, hasPermission, roleLabels } from "@/lib/permissions";
import { ASSIGNABLE_ROLES } from "@/lib/member-role-policy";

/**
 * The read-only roles grid (UX Phase 17, D58). Every cell is computed from the
 * real tables, never a copy: the resources and their actions come from
 * `PERMISSION_REGISTRY`/`RESOURCES`, and whether a role holds an action is
 * `hasPermission` (`permissionsCore`), the same call the server and Convex
 * use. Editing roles is a later, separate decision, so nothing here writes.
 */

/** Owner first, then the assignable roles in the order the invite dialog lists them. */
export const GRID_ROLES: readonly string[] = ["owner", ...ASSIGNABLE_ROLES];

interface GridAction {
  key: string;
  label: string;
  granted: boolean;
}

interface GridCell {
  granted: number;
  total: number;
  /** `All`, `3/6` or `—`, the words the cell prints. */
  text: string;
  actions: GridAction[];
}

export interface GridRow {
  resource: string;
  label: string;
  cells: Record<string, GridCell>;
}

export interface RolesGrid {
  roles: { key: string; label: string; granted: number; total: number }[];
  rows: GridRow[];
}

function cellText(granted: number, total: number): string {
  if (granted === 0) return "—";
  return granted === total ? "All" : `${granted}/${total}`;
}

export function buildRolesGrid(): RolesGrid {
  const rows: GridRow[] = RESOURCES.map((resource) => {
    const def = PERMISSION_REGISTRY[resource];
    const cells: Record<string, GridCell> = {};
    for (const role of GRID_ROLES) {
      const actions = def.actions.map((a) => ({ key: a.key, label: a.label, granted: hasPermission(role, resource, a.key) }));
      const granted = actions.filter((a) => a.granted).length;
      cells[role] = { granted, total: actions.length, text: cellText(granted, actions.length), actions };
    }
    return { resource, label: def.label, cells };
  });
  const roles = GRID_ROLES.map((key) => ({
    key,
    label: roleLabels[key] ?? key,
    granted: rows.reduce((n, r) => n + r.cells[key].granted, 0),
    total: rows.reduce((n, r) => n + r.cells[key].total, 0),
  }));
  return { roles, rows };
}
