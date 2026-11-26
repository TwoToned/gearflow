import { CalendarClock, CheckCircle2, ExternalLink, PackageCheck, Pencil, RotateCcw, Trash2, UserPlus, Wrench } from "lucide-react";

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

/**
 * The maintenance RECORD page's ⋯ (UX Phase 14, 14b-3): `Complete…` only on an open job, `Reopen` only on a completed
 * one, `Delete…` last in red. A verb the caller cannot do (an omitted handler) or the job's state does not allow is
 * ABSENT. Complete and Reopen each have an exact Undo, so neither carries a confirm; Delete has none and says so.
 */
export interface MaintenanceRecordCtx {
  title: string;
  /** The job's stored status. */
  status: string;
  onComplete?: () => void;
  onReopen?: () => void;
  onDelete?: () => void;
}

export function buildMaintenanceRecordActions(ctx: MaintenanceRecordCtx): ActionMenuSpec {
  const open = ctx.status !== "COMPLETED" && ctx.status !== "CANCELLED";
  return {
    items: compact([
      open && ctx.onComplete && { key: "complete", label: "Complete…", group: "edit", icon: CheckCircle2, onSelect: ctx.onComplete },
      ctx.status === "COMPLETED" && ctx.onReopen && { key: "reopen", label: "Reopen", group: "edit", icon: RotateCcw, onSelect: ctx.onReopen },
      ctx.onDelete && {
        key: "delete",
        label: "Delete…",
        group: "danger",
        icon: Trash2,
        danger: true,
        onSelect: ctx.onDelete,
        confirm: {
          title: `Delete ${ctx.title}?`,
          body: "This removes the job, its parts and its work-order history. Assets it was holding are released. This can't be undone.",
          confirmLabel: "Delete job",
        },
      },
    ]),
  };
}

/** A part row's ⋯: `Mark arrived` only while it is on order; `Remove` is red and last (it has an Undo, so no confirm). */
export interface MaintenancePartCtx {
  name: string;
  arrived: boolean;
  onEdit?: () => void;
  onMarkArrived?: () => void;
  onRemove?: () => void;
}

export function buildMaintenancePartActions(ctx: MaintenancePartCtx): ActionMenuSpec {
  return {
    items: compact([
      ctx.onEdit && { key: "edit", label: "Edit", group: "edit", icon: Pencil, kbd: "E", onSelect: ctx.onEdit },
      !ctx.arrived && ctx.onMarkArrived && { key: "arrived", label: "Mark arrived", group: "edit", icon: PackageCheck, onSelect: ctx.onMarkArrived },
      ctx.onRemove && { key: "remove", label: "Remove", group: "danger", icon: Trash2, danger: true, onSelect: ctx.onRemove, confirm: { title: `Remove ${ctx.name}?`, body: "The part is taken off this job. You can undo it from the toast.", confirmLabel: "Remove part" } },
    ]),
  };
}

/** The page ⋯ words (a link to the existing service-schedule and check-off page until it moves into dialogs). */
export function buildMaintenancePageMenu(onService: () => void): ActionMenuSpec {
  return { items: [{ key: "service", label: "Service schedules and check-off", group: "organise", icon: Wrench, onSelect: onService }] };
}
