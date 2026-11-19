import { ArrowDownToLine, ArrowUpFromLine, PackageOpen, Pencil } from "lucide-react";

import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";

/** A case card on the job's Packing tab (spec §7b.2). */
export interface PackingCaseRow {
  id: string;
  label: string;
  /** The case this one sits inside, if any. */
  parent: { id: string; label: string } | null;
  /** Lines only PLANNED into this case: what "Unpack" sends loose. */
  plannedOnlyCount: number;
}

export interface PackingCaseCtx {
  /** Cases this one may move into: the caller has already removed the case
   *  itself, its descendants and its current parent. */
  moveTargets: Array<{ id: string; label: string }>;
  onRename?: () => void;
  onMoveInto?: (targetId: string) => void;
  onTakeOut?: () => void;
  onUnpack?: () => void;
}

type Entry = ActionItem | false | undefined | null;

function moveEntry(ctx: PackingCaseCtx): Entry {
  if (!ctx.onMoveInto || ctx.moveTargets.length === 0) return false;
  const onMoveInto = ctx.onMoveInto;
  return {
    key: "move-into",
    label: "Move into",
    group: "organise",
    icon: ArrowDownToLine,
    onSelect: () => {},
    children: ctx.moveTargets.map((t) => ({
      key: `move-into-${t.id}`,
      label: t.label,
      group: "organise",
      onSelect: () => onMoveInto(t.id),
    })),
  };
}

/**
 * The case ⋯: Rename · Move into ▸ · Take out of X · Unpack. An action that
 * does not apply is absent (principle 2): no "Take out of" for a top-level
 * case, no "Move into" with nowhere to go, no "Unpack" with nothing only
 * planned. Unpack un-PLANS (§7b.3): packed lines stay where the warehouse put
 * them; it is undoable, so it is not a danger item.
 */
export const buildPackingCaseActions: RowActionBuilder<PackingCaseRow, PackingCaseCtx> = (row, ctx): ActionMenuSpec => {
  const entries: Entry[] = [
    ctx.onRename && { key: "rename", label: "Rename…", group: "edit", icon: Pencil, onSelect: ctx.onRename },
    moveEntry(ctx),
    row.parent && ctx.onTakeOut && {
      key: "take-out",
      label: `Take out of ${row.parent.label}`,
      group: "organise",
      icon: ArrowUpFromLine,
      onSelect: ctx.onTakeOut,
    },
    row.plannedOnlyCount > 0 && ctx.onUnpack && {
      key: "unpack",
      label: "Unpack · lines go loose",
      group: "organise",
      icon: PackageOpen,
      onSelect: ctx.onUnpack,
    },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
};
