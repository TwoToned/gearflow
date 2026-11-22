import { ArrowDownToLine, ArrowUpFromLine, ChevronsDownUp, ChevronsUpDown, Lock, LockOpen, PackageOpen, Pencil, Printer, Trash2 } from "lucide-react";

import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";

/** A case card on the job's Packing tab (spec §7b.2). */
export interface PackingCaseRow {
  id: string;
  label: string;
  /** The case this one sits inside, if any. */
  parent: { id: string; label: string; sealed?: boolean } | null;
  /** Another case is packed inside this one: the server refuses a delete until it is moved out. */
  hasNestedCase?: boolean;
  /** Lines only PLANNED into this case: what "Unpack" sends loose. */
  plannedOnlyCount: number;
  /** Sealed (D21): the plan is locked, and so are rename, move and delete. */
  sealed: boolean;
  /** Lines in the card beyond the collapsed six (drives "Show every line"). */
  hiddenLineCount: number;
  expanded: boolean;
  /** Anything packed in it: delete is refused by the server while so (the item says why). */
  packedCount: number;
}

export interface PackingCaseCtx {
  /** Cases this one may move into: the caller has already removed the case
   *  itself, its descendants and its current parent. */
  moveTargets: Array<{ id: string; label: string }>;
  onRename?: () => void;
  onMoveInto?: (targetId: string) => void;
  onTakeOut?: () => void;
  onUnpack?: () => void;
  onPrintLabel?: () => void;
  onSeal?: () => void;
  onUnseal?: () => void;
  onToggleExpanded?: () => void;
  onDelete?: () => void;
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

/** Rename / Move into / Take out / Unpack: the verbs a seal locks, so a sealed case omits them. */
function openCaseEntries(row: PackingCaseRow, ctx: PackingCaseCtx): Entry[] {
  if (row.sealed) return [];
  return [
    ctx.onRename && { key: "rename", label: "Rename…", group: "edit", icon: Pencil, onSelect: ctx.onRename },
    moveEntry(ctx),
    // A sealed PARENT refuses having a case taken out of it (server: CASE_SEALED), so no verb is offered.
    row.parent && !row.parent.sealed && ctx.onTakeOut && {
      key: "take-out",
      label: `Take out of ${row.parent.label}`,
      group: "organise",
      icon: ArrowUpFromLine,
      onSelect: ctx.onTakeOut,
    },
    row.plannedOnlyCount > 0 && ctx.onUnpack && {
      key: "unpack",
      label: "Unpack · lines go unplanned",
      group: "organise",
      icon: PackageOpen,
      onSelect: ctx.onUnpack,
    },
  ];
}

function sealEntry(row: PackingCaseRow, ctx: PackingCaseCtx): Entry {
  if (row.sealed) return ctx.onUnseal && { key: "unseal", label: "Unseal", group: "organise", icon: LockOpen, onSelect: ctx.onUnseal };
  return ctx.onSeal && { key: "seal", label: "Seal · lock the plan, print label", group: "organise", icon: Lock, onSelect: ctx.onSeal };
}

/** Delete is red and last. The confirm names the downstream effect; a packed
 *  case is refused by the server (`NOT_EMPTY`), and the confirm says so up front. */
function deleteEntry(row: PackingCaseRow, ctx: PackingCaseCtx): Entry {
  if (row.sealed || !ctx.onDelete) return false;
  const lines = row.plannedOnlyCount;
  const body = row.hasNestedCase
    ? `${row.label} has another case packed inside it. The delete will be refused until that case is moved out.`
    : row.packedCount > 0
      ? `${row.label} still has ${row.packedCount} packed ${row.packedCount === 1 ? "line" : "lines"}. Move or unpack them in the warehouse first; the delete will be refused until then.`
      : lines > 0
        ? `${lines} ${lines === 1 ? "line" : "lines"} planned into ${row.label} go back to Unplanned. Nothing physical moves.`
        : `${row.label} has nothing planned in it. Nothing else changes.`;
  return {
    key: "delete",
    label: "Delete case…",
    group: "danger",
    icon: Trash2,
    danger: true,
    confirm: { title: `Delete ${row.label}?`, body, confirmLabel: "Delete case" },
    onSelect: ctx.onDelete,
  };
}

/**
 * The case ⋯: Rename · Move into ▸ · Take out of X · Unpack · Print case label
 * · Seal / Unseal · Show every line · Delete case… (red, last). An action that
 * does not apply is absent (principle 2): no "Take out of" for a top-level
 * case, no "Move into" with nowhere to go, no "Unpack" with nothing only
 * planned, and a SEALED case offers only Print / Unseal / Show every line
 * (the server refuses the rest with `CASE_SEALED`). Unpack un-PLANS (§7b.3):
 * packed lines stay where the warehouse put them; it is undoable.
 */
export const buildPackingCaseActions: RowActionBuilder<PackingCaseRow, PackingCaseCtx> = (row, ctx): ActionMenuSpec => {
  const entries: Entry[] = [
    ...openCaseEntries(row, ctx),
    ctx.onPrintLabel && { key: "print-label", label: "Print case label", group: "documents", icon: Printer, onSelect: ctx.onPrintLabel },
    sealEntry(row, ctx),
    row.hiddenLineCount > 0 && ctx.onToggleExpanded && {
      key: "toggle-lines",
      label: row.expanded ? "Show fewer lines" : "Show every line",
      group: "organise",
      icon: row.expanded ? ChevronsDownUp : ChevronsUpDown,
      onSelect: ctx.onToggleExpanded,
    },
    deleteEntry(row, ctx),
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
};
