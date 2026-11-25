import { ExternalLink, MoveRight, Pencil, Printer, Trash2 } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Locations list verbs (UX Phase 14, 14a-2). An omitted handler means the caller cannot do it, so the
 * item is ABSENT, never disabled. One definition feeds the row ⋯ and the bulk bar.
 *
 * Delete (not Archive: locations have no archived state, so it is the existing guarded delete) is a
 * row verb only: it is refused while the place has bins or contents, and has no Undo.
 */
export interface LocationActionCtx {
  title: string;
  /** Absent on the record page itself (you are already there). */
  onOpen?: () => void;
  onEdit?: () => void;
  onMoveContents?: () => void;
  onPrintLabel?: () => void;
  onDelete?: () => void;
}

type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

export function buildLocationActions(ctx: LocationActionCtx): ActionMenuSpec {
  return {
    items: compact([
      ctx.onOpen && { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
      ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
      ctx.onMoveContents && { key: "move", label: "Move contents…", group: "organise", icon: MoveRight, onSelect: ctx.onMoveContents },
      ctx.onPrintLabel && { key: "print", label: "Print bin label", group: "documents", icon: Printer, onSelect: ctx.onPrintLabel },
      ctx.onDelete && {
        key: "delete",
        label: "Delete…",
        group: "danger",
        icon: Trash2,
        danger: true,
        onSelect: ctx.onDelete,
        confirm: {
          title: `Delete ${ctx.title}?`,
          body: "A location with bins or anything stored in it can't be deleted: move the contents out first. Its photos are removed.",
          confirmLabel: "Delete",
        },
      },
    ]),
  };
}

export interface LocationBulkCtx {
  onMoveContents?: () => void;
  onPrintLabels?: () => void;
}

export function buildLocationBulkActions(ctx: LocationBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onMoveContents && { key: "move", label: (n) => `Move contents ${n}`, group: "organise", icon: MoveRight, onSelect: ctx.onMoveContents },
    ctx.onPrintLabels && { key: "print", label: (n) => `Print bin labels ${n}`, group: "documents", icon: Printer, onSelect: ctx.onPrintLabels },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}
