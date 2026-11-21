import { PackageOpen, PackagePlus } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction, RowActionBuilder } from "@/lib/primitives/types";

/** One plannable line on the Packing tab, reduced to what its ⋯ needs. */
export interface PackingLineRow {
  id: string;
  /** Nothing of it is physically packed (packed lines are not planned here). */
  canPlan: boolean;
  /** The case it is planned into now, if any. */
  plannedCase: { id: string; label: string; sealed: boolean } | null;
}

export interface PackingLineCtx {
  /** Every case, with its seal state; the builder drops sealed ones and the current one. */
  cases: Array<{ id: string; label: string; sealed: boolean }>;
  onPlanInto: (caseId: string | null, caseLabel: string | null) => void;
}

/**
 * The line ⋯ (§7b.3): `Plan into… ▸` (every open case except the current one)
 * and `Unplan` (back to Unplanned). Absent, never disabled: a packed line has
 * no ⋯ items at all, and a line inside a SEALED case cannot be planned out
 * (the server refuses with `CASE_SEALED`), so it has none either.
 */
export const buildPackingLineActions: RowActionBuilder<PackingLineRow, PackingLineCtx> = (row, ctx): ActionMenuSpec => {
  if (!row.canPlan || row.plannedCase?.sealed) return { items: [] };
  const targets = ctx.cases.filter((c) => !c.sealed && c.id !== row.plannedCase?.id);
  const items: ActionItem[] = [];
  if (targets.length > 0) {
    items.push({
      key: "plan-into",
      label: "Plan into…",
      group: "organise",
      icon: PackagePlus,
      onSelect: () => {},
      children: targets.map((c) => ({ key: `plan-into-${c.id}`, label: c.label, group: "organise", onSelect: () => ctx.onPlanInto(c.id, c.label) })),
    });
  }
  if (row.plannedCase) {
    items.push({ key: "unplan", label: "Unplan", group: "organise", icon: PackageOpen, onSelect: () => ctx.onPlanInto(null, null) });
  }
  return { items };
};

/** The bulk bar's verbs (§7b.3 / §7b.5): `Plan 3 into… ▾` and `Unplan 2`. */
export function buildPackingBulkActions(ctx: {
  cases: Array<{ id: string; label: string; sealed: boolean }>;
  onPlanInto: (caseId: string | null, caseLabel: string | null) => void;
}): BulkAction[] {
  const open = ctx.cases.filter((c) => !c.sealed);
  const actions: BulkAction[] = [];
  if (open.length > 0) {
    actions.push({
      key: "plan-into",
      label: (n) => `Plan ${n} into…`,
      group: "organise",
      onSelect: () => {},
      children: open.map((c) => ({
        key: `plan-into-${c.id}`,
        label: () => c.label,
        group: "organise",
        onSelect: () => ctx.onPlanInto(c.id, c.label),
      })),
    });
  }
  actions.push({ key: "unplan", label: (n) => `Unplan ${n}`, group: "organise", onSelect: () => ctx.onPlanInto(null, null) });
  return actions;
}
