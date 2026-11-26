import { Archive, ClipboardCheck, Copy, DollarSign, ExternalLink, Pencil, Plus, Printer, RotateCcw } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Models list verbs (UX Phase 14, 14a-1). An omitted handler means the caller cannot do it, so the
 * item is ABSENT, never disabled. One definition feeds the row ⋯ and the bulk bar.
 *
 * Not here on purpose: Archive / Restore live on the model page (`buildModelPageActions`, each with its
 * exact Undo), and Add accessory (needs the model accessories editor adapted for many models).
 */
export interface ModelActionCtx {
  onOpen: () => void;
  /** Opens the model edit sheet (`?edit-model=<id>`, Phase 12). */
  onEdit?: () => void;
}

type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

export function buildModelActions(ctx: ModelActionCtx): ActionMenuSpec {
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
      ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
    ]),
  };
}

export interface ModelBulkCtx {
  onEditRates?: () => void;
  onAssignChecks?: () => void;
}

export function buildModelBulkActions(ctx: ModelBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onEditRates && { key: "edit-rates", label: (n) => `Edit rates ${n}`, group: "edit", icon: DollarSign, onSelect: ctx.onEditRates },
    ctx.onAssignChecks && { key: "assign-checks", label: (n) => `Assign checks ${n}`, group: "organise", icon: ClipboardCheck, onSelect: ctx.onAssignChecks },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}

// ─── The model page's ⋯ (UX Phase 12, slice 3) ────────────────────────────────

/** What the model page's menu depends on. */
export interface ModelPageRow {
  name: string;
  /** `false` = archived (the model's `isActive`). Absent means active. */
  isActive?: boolean | null;
  /** Units the labels sheet would print. */
  labelCount: number;
}

/**
 * Every verb is a handler the caller may or may not have (its permission): an omitted
 * handler means the item is ABSENT, never disabled. Archive needs `model:delete`;
 * Restore needs `model:update`.
 */
export interface ModelPageCtx {
  onNewAsset?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onPrintLabels?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
}

/**
 * The model page's ⋯: `New asset`, `Edit`, `Duplicate…`, `Print labels for all`, then
 * `Archive…` last and red (an archived model offers `Restore` instead, with its own Undo).
 * `Print labels for all` is absent for a model with nothing to print.
 */
export function buildModelPageActions(row: ModelPageRow, ctx: ModelPageCtx): ActionMenuSpec {
  const archived = row.isActive === false;
  const items: (ActionItem | false | undefined)[] = [
    !archived && newAsset(ctx),
    ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
    ctx.onDuplicate && { key: "duplicate", label: "Duplicate…", group: "organise", icon: Copy, onSelect: ctx.onDuplicate },
    ctx.onPrintLabels && row.labelCount > 0 && { key: "print-labels", label: `Print labels for all (${row.labelCount})`, group: "documents", icon: Printer, onSelect: ctx.onPrintLabels },
    ...(archived ? archivedVerbs(ctx) : activeVerbs(row, ctx)),
  ];
  return { items: items.filter((i): i is ActionItem => !!i) };
}

const newAsset = (ctx: ModelPageCtx): ActionItem | undefined =>
  ctx.onNewAsset && { key: "new-asset", label: "New asset", group: "edit", icon: Plus, onSelect: ctx.onNewAsset };

/** An archived model offers `Restore` (the way back), nothing destructive. */
const archivedVerbs = (ctx: ModelPageCtx): (ActionItem | undefined)[] => [
  ctx.onRestore && { key: "restore", label: "Restore", group: "organise", icon: RotateCcw, onSelect: ctx.onRestore },
];

/** An active model ends with `Archive…`: last and red, naming what it does and does not touch. */
const activeVerbs = (row: ModelPageRow, ctx: ModelPageCtx): (ActionItem | undefined)[] => [
  ctx.onArchive && {
    key: "archive",
    label: "Archive…",
    group: "danger",
    icon: Archive,
    danger: true,
    onSelect: ctx.onArchive,
    confirm: {
      title: `Archive ${row.name}?`,
      body: "The model is hidden from new quotes and pickers, and no new job lines can use it. Its assets, existing lines, reservations and availability are not touched. You can restore it from this page.",
      confirmLabel: "Archive model",
    },
  },
];
