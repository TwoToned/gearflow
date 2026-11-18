import { CalendarPlus, MessageSquare, Pencil, Send, Trash2 } from "lucide-react";

import { assignmentStatusLabels } from "@/lib/status-labels";
import type { ActionItem, ActionMenuSpec, BulkAction, RowActionBuilder } from "@/lib/primitives/types";

/** Every status a crew assignment can be set to, in lifecycle order. */
const CREW_STATUSES = ["PENDING", "OFFERED", "ACCEPTED", "DECLINED", "CONFIRMED", "CANCELLED", "COMPLETED"] as const;

export interface CrewActionRow {
  id: string;
  name: string;
  status: string;
}

export interface CrewActionCtx {
  onEdit?: () => void;
  onSendOffer?: () => void;
  onMessage?: () => void;
  onSetStatus?: (status: string) => void;
  onRemove?: () => void;
}

type Entry = ActionItem | false | undefined | null;

/** The crew row's ⋯ (By person view): Edit, Send offer, Message, .ics, Status ▸, Remove. */
export const crewActions: RowActionBuilder<CrewActionRow, CrewActionCtx> = (row, ctx): ActionMenuSpec => {
  const items: Entry[] = [
    ctx.onEdit && { key: "edit", label: "Edit assignment", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onEdit },
    ctx.onSendOffer && row.status === "PENDING" && { key: "send-offer", label: "Send offer", group: "edit", icon: Send, onSelect: ctx.onSendOffer },
    ctx.onMessage && { key: "message", label: "Message", group: "edit", icon: MessageSquare, onSelect: ctx.onMessage },
    {
      key: "ics",
      label: "Download .ics",
      group: "documents",
      icon: CalendarPlus,
      onSelect: () => {
        window.open(`/api/crew/calendar/assignment/${row.id}`, "_blank");
      },
    },
    ctx.onSetStatus && {
      key: "status",
      label: "Set status",
      group: "organise",
      onSelect: () => {},
      children: CREW_STATUSES.filter((s) => s !== row.status).map((s) => ({
        key: `status-${s}`, label: assignmentStatusLabels[s], group: "organise" as const, onSelect: () => ctx.onSetStatus!(s),
      })),
    },
    ctx.onRemove && {
      key: "remove",
      label: "Remove",
      group: "danger",
      danger: true,
      icon: Trash2,
      onSelect: ctx.onRemove,
      confirm: {
        title: `Remove ${row.name} from this job?`,
        body: "This removes the assignment, its shifts and any linked time entries. It cannot be undone.",
        confirmLabel: "Remove",
      },
    },
  ];
  return { items: items.filter((i): i is ActionItem => !!i) };
};

export interface CrewBulkCtx {
  onSendOffers?: () => void;
  onConfirm?: () => void;
  onSetStatus?: (status: string) => void;
  onRemove?: () => void;
}

/** `Send N offers`, `Confirm N`, `Set status…`, `Remove` for ticked crew rows. */
export function crewBulkActions(rows: CrewActionRow[], ctx: CrewBulkCtx): BulkAction[] {
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const confirmable = rows.filter((r) => r.status !== "CONFIRMED" && r.status !== "CANCELLED" && r.status !== "DECLINED").length;
  const out: (BulkAction | false | undefined)[] = [
    ctx.onSendOffers && pending > 0 && { key: "send-offers", group: "edit", icon: Send, label: () => `Send ${pending} offer${pending === 1 ? "" : "s"}`, onSelect: ctx.onSendOffers },
    ctx.onConfirm && confirmable > 0 && { key: "confirm", group: "organise", label: () => `Confirm ${confirmable}`, onSelect: ctx.onConfirm },
    ctx.onSetStatus && {
      key: "set-status", group: "organise", label: () => "Set status…", onSelect: () => {},
      children: CREW_STATUSES.map((s) => ({
        key: s, group: "organise" as const, label: () => assignmentStatusLabels[s], onSelect: () => ctx.onSetStatus!(s),
      })),
    },
    ctx.onRemove && { key: "remove", group: "danger", danger: true, icon: Trash2, label: () => "Remove", onSelect: ctx.onRemove },
  ];
  return out.filter((a): a is BulkAction => !!a);
}
