import { Archive, Copy, Pencil, Trash2 } from "lucide-react";
import type { ActionItem, ActionMenuSpec, BulkAction, RowActionBuilder } from "@/lib/primitives/types";

/** The facts a template row's menu depends on. */
export interface TemplateRowFacts {
  name: string;
  archived: boolean;
}

/** What the caller may do and how; an action it cannot do is ABSENT (never disabled). */
export interface TemplateRowCtx {
  onUse?: () => void;
  onEdit?: () => void;
  /** Archive (the manager's `Delete…`): reversible, so the confirm says it can be undone. */
  onArchive?: () => void;
  /** The real delete, only offered for an already-archived template. No Undo. */
  onDeleteForever?: () => void;
}

/**
 * The Manage templates row ⋯ (spec 7c.2): `Use for a new job`, `Edit template…`,
 * `Delete…` (red, last). On an archived template there is nothing to use or edit: only
 * `Delete forever…`.
 */
export const buildTemplateRowActions: RowActionBuilder<TemplateRowFacts, TemplateRowCtx> = (row, ctx): ActionMenuSpec => {
  const items: (ActionItem | false | undefined)[] = row.archived
    ? [
        ctx.onDeleteForever && {
          key: "delete-forever", label: "Delete forever…", group: "danger", danger: true, icon: Trash2, onSelect: ctx.onDeleteForever,
          confirm: {
            title: `Delete ${row.name} forever?`,
            body: "The template and its gear lines are removed for good. Jobs already created from it are not affected. This can't be undone.",
            confirmLabel: "Delete forever",
          },
        },
      ]
    : [
        ctx.onUse && { key: "use", label: "Use for a new job", group: "edit", icon: Copy, onSelect: ctx.onUse },
        ctx.onEdit && { key: "edit", label: "Edit template…", group: "edit", icon: Pencil, onSelect: ctx.onEdit },
        ctx.onArchive && {
          key: "archive", label: "Delete…", group: "danger", danger: true, icon: Archive, onSelect: ctx.onArchive,
          confirm: {
            title: `Delete ${row.name}?`,
            body: "The template is archived: it leaves this list and can be undone right after. Jobs already created from it are not affected.",
            confirmLabel: "Delete template",
          },
        },
      ];
  return { items: items.filter((i): i is ActionItem => !!i) };
};

/** The bulk verbs for the ticked templates; each absent when the caller has no handler. */
export function buildTemplateBulkActions(archived: boolean, ctx: { onArchive?: () => void; onDeleteForever?: () => void }): BulkAction[] {
  const verb = archived ? ctx.onDeleteForever : ctx.onArchive;
  if (!verb) return [];
  return [{
    key: "delete", group: "danger", danger: true, icon: Trash2,
    label: (n: number) => (archived ? `Delete ${n} forever` : `Delete ${n}`),
    onSelect: verb,
  }];
}
