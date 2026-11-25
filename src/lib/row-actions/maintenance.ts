import { CalendarClock, ExternalLink, Pencil, Trash2, UserPlus, Wrench } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * Maintenance list verbs (UX Phase 14, 14a-3). An omitted handler means the caller cannot do it, so the item
 * is ABSENT, never disabled. Delete is a row verb only: it removes the record and its work-order links and has
 * no exact reverse, so it carries a confirm that says so. `Mark done` (the Complete path with its Reopen) and
 * `Check off cycle` arrive with the record page (14b-3).
 */
export interface MaintenanceActionCtx {
  title: string;
  onOpen: () => void;
  onEdit?: () => void;
  onReschedule?: () => void;
  onAssign?: () => void;
  onDelete?: () => void;
}

type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

export function buildMaintenanceActions(ctx: MaintenanceActionCtx): ActionMenuSpec {
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: ExternalLink, onSelect: ctx.onOpen },
      ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
      ctx.onReschedule && { key: "reschedule", label: "Reschedule…", group: "organise", icon: CalendarClock, onSelect: ctx.onReschedule },
      ctx.onAssign && { key: "assign", label: "Assign…", group: "organise", icon: UserPlus, onSelect: ctx.onAssign },
      ctx.onDelete && {
        key: "delete",
        label: "Delete…",
        group: "danger",
        icon: Trash2,
        danger: true,
        onSelect: ctx.onDelete,
        confirm: {
          title: `Delete ${ctx.title}?`,
          body: "This removes the maintenance record and its work-order history. Assets it was holding are released. This can't be undone.",
          confirmLabel: "Delete record",
        },
      },
    ]),
  };
}

export interface MaintenanceBulkCtx {
  onReschedule?: () => void;
  onAssign?: () => void;
}

export function buildMaintenanceBulkActions(ctx: MaintenanceBulkCtx): BulkAction[] {
  const actions: (BulkAction | false | undefined)[] = [
    ctx.onAssign && { key: "assign", label: (n) => `Assign ${n}`, group: "organise", icon: UserPlus, onSelect: ctx.onAssign },
    ctx.onReschedule && { key: "reschedule", label: (n) => `Reschedule ${n}`, group: "organise", icon: CalendarClock, onSelect: ctx.onReschedule },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}

/** The page ⋯ words (a link to the existing service-schedule and check-off page until it moves into dialogs). */
export function buildMaintenancePageMenu(onService: () => void): ActionMenuSpec {
  return { items: [{ key: "service", label: "Service schedules and check-off", group: "organise", icon: Wrench, onSelect: onService }] };
}
