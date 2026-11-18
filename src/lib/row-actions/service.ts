import { ArrowRightLeft, Pencil, Send, Trash2, UserPlus, Users } from "lucide-react";

import { SERVICE_STATUS_LABELS } from "@/lib/constants/services";
import { crewShort, toOffer, type LogisticsService, type ServiceStatus } from "@/lib/logistics-model";
import type { ActionItem, ActionMenuSpec, BulkAction, RowActionBuilder } from "@/lib/primitives/types";

const STATUSES: ServiceStatus[] = ["PLANNED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

/** A day the service can be moved to (the days already on the timeline). */
export interface MoveTarget {
  key: string;
  label: string;
}

/** Handlers: an omitted handler means the caller cannot do it, so the item is absent. */
export interface ServiceActionCtx {
  onEdit?: () => void;
  onPickCrew?: () => void;
  onSendOffers?: () => void;
  onMoveTo?: (dayKey: string) => void;
  moveTargets?: MoveTarget[];
  onSetStatus?: (status: ServiceStatus) => void;
  onDelete?: () => void;
}

type Entry = ActionItem | false | undefined | null;

function crewItems(s: LogisticsService, ctx: ServiceActionCtx): Entry[] {
  const short = crewShort(s);
  const offers = toOffer(s);
  return [
    ctx.onPickCrew && {
      key: "pick-crew",
      label: short ? `Pick crew · ${short} needed` : "Add crew",
      group: "edit",
      icon: short ? Users : UserPlus,
      onSelect: ctx.onPickCrew,
    },
    ctx.onSendOffers && offers > 0 && {
      key: "send-offers",
      label: `Send ${offers} offer${offers === 1 ? "" : "s"}`,
      group: "edit",
      icon: Send,
      onSelect: ctx.onSendOffers,
    },
  ];
}

function organiseItems(s: LogisticsService, ctx: ServiceActionCtx): Entry[] {
  const { onMoveTo, onSetStatus } = ctx;
  const targets = (ctx.moveTargets ?? []).filter((t) => t.key !== (s.date ?? "").slice(0, 10));
  return [
    onMoveTo && !!s.date && targets.length > 0 && {
      key: "move-to",
      label: "Move to",
      group: "organise",
      icon: ArrowRightLeft,
      onSelect: () => {},
      children: targets.map((t) => ({
        key: `move-${t.key}`, label: t.label, group: "organise" as const, onSelect: () => onMoveTo(t.key),
      })),
    },
    onSetStatus && {
      key: "status",
      label: "Set status",
      group: "organise",
      onSelect: () => {},
      children: STATUSES.filter((st) => st !== s.status).map((st) => ({
        key: `status-${st}`, label: SERVICE_STATUS_LABELS[st], group: "organise" as const, onSelect: () => onSetStatus(st),
      })),
    },
  ];
}

/** The service row's ⋯ (the single-row verbs; bulk verbs are in `serviceBulkActions`). */
export const serviceActions: RowActionBuilder<LogisticsService, ServiceActionCtx> = (s, ctx): ActionMenuSpec => {
  const items: Entry[] = [
    ctx.onEdit && { key: "edit", label: "Edit", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onEdit },
    ...crewItems(s, ctx),
    ...organiseItems(s, ctx),
    ctx.onDelete && {
      key: "delete",
      label: "Delete",
      group: "danger",
      danger: true,
      icon: Trash2,
      onSelect: ctx.onDelete,
      confirm: {
        title: `Delete ${s.title}?`,
        body: s.crewAssignments.length
          ? `This also removes its ${s.crewAssignments.length} crew assignment${s.crewAssignments.length === 1 ? "" : "s"}, their shifts and any linked time entries. It cannot be undone.`
          : "It comes off the timeline and the job's service totals. It cannot be undone.",
        confirmLabel: "Delete service",
      },
    },
  ];
  return { items: items.filter((i): i is ActionItem => !!i) };
};

export interface ServiceBulkCtx {
  /** First short service of the ticked ones opens the picker. */
  onPickCrew?: () => void;
  onSendOffers?: () => void;
  onConfirm?: () => void;
  onSetStatus?: (status: ServiceStatus) => void;
  /** The surface's own `BulkDeleteDialog` owns the confirm. */
  onDelete?: () => void;
}

/** Spec §8 (2026-11-04): `Pick crew · N short`, `Send N offers`, `Confirm N`, `Set status…`, `Delete`. */
export function serviceBulkActions(rows: LogisticsService[], ctx: ServiceBulkCtx): BulkAction[] {
  const short = rows.filter((s) => crewShort(s) > 0).length;
  const offers = rows.reduce((n, s) => n + toOffer(s), 0);
  const confirmable = rows.filter((s) => s.status !== "CONFIRMED" && s.status !== "CANCELLED").length;
  const out: (BulkAction | false | undefined)[] = [
    ctx.onPickCrew && short > 0 && { key: "pick-crew", group: "edit", icon: Users, label: () => `Pick crew · ${short} short`, onSelect: ctx.onPickCrew },
    ctx.onSendOffers && offers > 0 && { key: "send-offers", group: "edit", icon: Send, label: () => `Send ${offers} offer${offers === 1 ? "" : "s"}`, onSelect: ctx.onSendOffers },
    ctx.onConfirm && confirmable > 0 && { key: "confirm", group: "organise", label: () => `Confirm ${confirmable}`, onSelect: ctx.onConfirm },
    ctx.onSetStatus && {
      key: "set-status", group: "organise", label: () => "Set status…", onSelect: () => {},
      children: STATUSES.map((st) => ({
        key: st, group: "organise" as const, label: () => SERVICE_STATUS_LABELS[st], onSelect: () => ctx.onSetStatus!(st),
      })),
    },
    ctx.onDelete && { key: "delete", group: "danger", danger: true, icon: Trash2, label: () => "Delete", onSelect: ctx.onDelete },
  ];
  return out.filter((a): a is BulkAction => !!a);
}
