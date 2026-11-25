import { ClipboardCheck, DollarSign, ExternalLink, Pencil } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Models list verbs (UX Phase 14, 14a-1). An omitted handler means the caller cannot do it, so the
 * item is ABSENT, never disabled. One definition feeds the row ⋯ and the bulk bar.
 *
 * Not here on purpose: Archive (a model archive deletes the model's assets, so it has no exact Undo and
 * stays on the model page) and Add accessory (needs the model accessories editor adapted for many models).
 */
export interface ModelActionCtx {
  onOpen: () => void;
  /** Routes to `/assets/models/[id]/edit` (Phase 12 turns it into the sheet). */
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
