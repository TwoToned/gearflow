import { ExternalLink, Pencil, Printer, RotateCcw } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Kits list verbs (UX Phase 14, 14a-2). An omitted handler means the caller cannot do it, so the item is
 * ABSENT, never disabled. Force return appears only for a kit that is out.
 *
 * Not here yet (14b-2, the kit record): Duplicate and Archive. A kit archive releases its members and has
 * no exact reverse until the kit record's snapshot design lands.
 */
export interface KitActionCtx {
  onOpen: () => void;
  onEdit?: () => void;
  /** Present only for a kit that is out. */
  onForceReturn?: () => void;
}

type Entry = ActionItem | false | undefined | null;

export function buildKitActions(title: string, ctx: KitActionCtx): ActionMenuSpec {
  const entries: Entry[] = [
    { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
    ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
    ctx.onForceReturn && {
      key: "force-return",
      label: "Force return…",
      group: "organise",
      icon: RotateCcw,
      danger: true,
      onSelect: ctx.onForceReturn,
      confirm: {
        title: `Force return ${title}?`,
        body: "Job assignments for the kit and its contents are marked returned and each unit goes back to its home location. Use when scanning isn't possible. This can't be undone.",
        confirmLabel: "Force return",
      },
    },
  ];
  return { items: entries.filter((e): e is ActionItem => !!e) };
}

export interface KitBulkCtx {
  onPrintList: () => void;
  /** Present only when any selected kit is out. */
  forceReturnCount?: number;
  onForceReturn?: () => void;
}

export function buildKitBulkActions(ctx: KitBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    { key: "print-list", label: (n) => `Print list ${n}`, group: "documents", icon: Printer, onSelect: ctx.onPrintList },
    ctx.onForceReturn &&
      !!ctx.forceReturnCount && {
        key: "force-return",
        label: () => `Force return ${ctx.forceReturnCount}`,
        group: "danger",
        icon: RotateCcw,
        danger: true,
        onSelect: ctx.onForceReturn,
        confirm: {
          title: "Force return the selected kits?",
          body: "Job assignments for each kit that is out, and its contents, are marked returned and each unit goes back to its home location. Kits that are not out are skipped. This can't be undone.",
          confirmLabel: "Force return",
        },
      },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}
