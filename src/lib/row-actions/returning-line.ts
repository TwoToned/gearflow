import { AlertTriangle, ExternalLink, List, PackageX, RotateCcw, Wrench } from "lucide-react";
import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../convex/_generated/api";
import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import { returnableLines, type ReturnCondition, type ReturningGroup, type ReturningLine } from "@/lib/returning";

/**
 * Returning mode's menus (spec §9c.4): the row ⋯, the job group's ⋯, the
 * bulk verbs and the unit-chip menu. Pure; an action that does not apply is
 * ABSENT (never disabled). Missing is destructive (it writes a loss), so it
 * goes last, red, with a confirm. Every write these call is announced with
 * Undo by its hook (`useWarehouseWrites` / `useReturnsWrites`).
 */

export type ReturningUnit = NonNullable<FunctionReturnType<typeof api.warehouseFloor.lineUnits>>["units"][number];

export interface ReturningCtx {
  /** `warehouse:check_in`. */
  canReturn: boolean;
  /** `maintenance:create`. */
  canRepair: boolean;
  returnLines: (lines: ReturningLine[], condition: ReturnCondition) => void | Promise<void>;
  /** Lines with damaged serialised units: raise one repair per line. */
  raiseRepair: (lines: ReturningLine[]) => void | Promise<void>;
  toggleUnits: (line: ReturningLine) => void;
  openJob: (projectId: string) => void;
}

const MISSING_CONFIRM = (n: number) => ({
  title: `Mark ${n} line${n === 1 ? "" : "s"} missing?`,
  body: "Everything still out on them is recorded as lost. Undo is offered right after.",
  confirmLabel: "Mark missing",
});

const repairable = (lines: readonly ReturningLine[]) => lines.filter((l) => l.kind === "serialized" && l.damaged > 0);
const hasUnits = (l: ReturningLine) => l.kind !== "kit" && l.kind !== "subhire" && l.kind !== "custom";

export function buildReturningLineActions(line: ReturningLine, ctx: ReturningCtx): ActionMenuSpec {
  const items: ActionItem[] = [];
  const returnable = ctx.canReturn && returnableLines([line]).length > 0;
  if (returnable) {
    items.push(
      { key: "return", label: line.kind === "kit" ? "Return kit" : "Return", group: "edit", icon: RotateCcw, onSelect: () => ctx.returnLines([line], "GOOD") },
      { key: "damaged", label: "Return as damaged", group: "edit", icon: AlertTriangle, onSelect: () => ctx.returnLines([line], "DAMAGED") },
    );
  }
  if (hasUnits(line)) items.push({ key: "units", label: "Show units", group: "organise", icon: List, onSelect: () => ctx.toggleUnits(line) });
  if (ctx.canRepair && repairable([line]).length > 0) {
    items.push({ key: "repair", label: "Raise repair", group: "organise", icon: Wrench, onSelect: () => ctx.raiseRepair([line]) });
  }
  if (returnable) {
    items.push({ key: "missing", label: "Mark missing", group: "danger", danger: true, icon: PackageX, onSelect: () => ctx.returnLines([line], "MISSING"), confirm: MISSING_CONFIRM(1) });
  }
  return { items };
}

export function buildReturningGroupActions(group: ReturningGroup, ctx: ReturningCtx): ActionMenuSpec {
  const items: ActionItem[] = [];
  const out = returnableLines(group.lines);
  if (ctx.canReturn && out.length > 0) {
    items.push({ key: "return-all", label: "Return everything still out", group: "edit", icon: RotateCcw, onSelect: () => ctx.returnLines(out, "GOOD") });
  }
  items.push({ key: "open", label: "Open job", group: "organise", icon: ExternalLink, onSelect: () => ctx.openJob(group.projectId) });
  return { items };
}

/** `Return n · Mark damaged n · Raise repair n · Mark missing n` over the ticked lines. */
export function buildReturningBulkActions(lines: readonly ReturningLine[], ctx: ReturningCtx): BulkAction[] {
  const out = returnableLines(lines);
  const repair = repairable(lines);
  const actions: BulkAction[] = [];
  if (ctx.canReturn && out.length > 0) {
    actions.push(
      { key: "return", label: () => `Return ${out.length}`, group: "edit", icon: RotateCcw, onSelect: () => ctx.returnLines(out, "GOOD") },
      { key: "damaged", label: () => `Mark damaged ${out.length}`, group: "edit", icon: AlertTriangle, onSelect: () => ctx.returnLines(out, "DAMAGED") },
    );
  }
  if (ctx.canRepair && repair.length > 0) {
    actions.push({ key: "repair", label: () => `Raise repair ${repair.length}`, group: "organise", icon: Wrench, onSelect: () => ctx.raiseRepair(repair) });
  }
  if (ctx.canReturn && out.length > 0) {
    actions.push({
      key: "missing", label: () => `Mark missing ${out.length}`, group: "danger", danger: true, icon: PackageX,
      onSelect: () => ctx.returnLines(out, "MISSING"), confirm: MISSING_CONFIRM(out.length),
    });
  }
  return actions;
}

export interface UnitCtx {
  canReturn: boolean;
  canRepair: boolean;
  /** Return ONE still-out serialised unit. */
  returnUnit: (unit: ReturningUnit, condition: ReturnCondition) => void | Promise<void>;
  /** Re-record a returned unit's outcome (Undo restores the previous one). */
  correct: (unit: ReturningUnit, condition: ReturnCondition) => void | Promise<void>;
  raiseRepair: (unit: ReturningUnit) => void | Promise<void>;
}

const CORRECT_LABEL: Record<ReturnCondition, string> = { GOOD: "Mark good", DAMAGED: "Mark damaged", MISSING: "Mark missing" };

function correctionItems(unit: ReturningUnit, ctx: UnitCtx): ActionItem[] {
  const current = (unit.returnCondition ?? "GOOD") as ReturnCondition;
  return (["GOOD", "DAMAGED", "MISSING"] as const)
    .filter((c) => c !== current)
    .map((c) => ({
      key: `mark-${c}`, label: CORRECT_LABEL[c], group: c === "MISSING" ? "danger" : "edit", danger: c === "MISSING",
      onSelect: () => ctx.correct(unit, c),
      ...(c === "MISSING" ? { confirm: { title: "Mark this unit missing?", body: "It is recorded as lost. Undo is offered right after.", confirmLabel: "Mark missing" } } : {}),
    }));
}

/** One unit chip's menu. An asset-less unit (bulk / generic) has none. */
export function buildUnitActions(unit: ReturningUnit, ctx: UnitCtx): ActionMenuSpec {
  if (!unit.assetId || !ctx.canReturn) return { items: [] };
  if (unit.status === "CHECKED_OUT") {
    return {
      items: [
        { key: "return", label: "Return", group: "edit", icon: RotateCcw, onSelect: () => ctx.returnUnit(unit, "GOOD") },
        { key: "damaged", label: "Return as damaged", group: "edit", icon: AlertTriangle, onSelect: () => ctx.returnUnit(unit, "DAMAGED") },
        {
          key: "missing", label: "Mark missing", group: "danger", danger: true, icon: PackageX, onSelect: () => ctx.returnUnit(unit, "MISSING"),
          confirm: { title: "Mark this unit missing?", body: "It is recorded as lost. Undo is offered right after.", confirmLabel: "Mark missing" },
        },
      ],
    };
  }
  if (unit.status !== "RETURNED") return { items: [] };
  const items = correctionItems(unit, ctx);
  if (ctx.canRepair && unit.returnCondition === "DAMAGED") {
    items.push({ key: "repair", label: "Raise repair", group: "organise", icon: Wrench, onSelect: () => ctx.raiseRepair(unit) });
  }
  return { items };
}
