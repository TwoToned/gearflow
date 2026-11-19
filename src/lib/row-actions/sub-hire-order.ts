import { Pencil } from "lucide-react";

import type { ActionItem, ActionMenuSpec, RowActionBuilder } from "@/lib/primitives/types";
import { SUB_HIRE_TRANSITIONS, type SubHireOrderStatus } from "@/lib/sub-hire-transitions";

/** A sub-hire ORDER row in the Equipment tab's Orders section. */
export interface SubHireOrderActionRow {
  orderNumber: string;
  status: string;
}

export interface SubHireOrderActionCtx {
  /** Opens the existing SubHireOrderDialog (the full Order sheet is a follow-up). */
  onOpen: () => void;
  /** The ONE status write (`subHireWrites.setStatus` behind the tab's mutation). */
  onSetStatus: (next: SubHireOrderStatus) => void;
}

/**
 * Order row ⋯: open, then the next lifecycle step and Cancel from the shared
 * transition table. A step that does not apply is ABSENT, never disabled.
 */
export const buildSubHireOrderActions: RowActionBuilder<SubHireOrderActionRow, SubHireOrderActionCtx> = (row, ctx): ActionMenuSpec => {
  const t = SUB_HIRE_TRANSITIONS[row.status] ?? {};
  const items: ActionItem[] = [{ key: "open-order", label: "Edit order", group: "edit", kbd: "E", icon: Pencil, onSelect: ctx.onOpen }];
  const forward = t.forward;
  if (forward) {
    items.push({ key: "next-status", label: forward.label, group: "organise", onSelect: () => ctx.onSetStatus(forward.status) });
  }
  if (t.cancel) {
    items.push({
      key: "cancel-order",
      label: "Cancel order",
      group: "danger",
      danger: true,
      onSelect: () => ctx.onSetStatus("CANCELLED"),
      confirm: {
        title: `Cancel ${row.orderNumber}?`,
        body: "The order is marked cancelled and its lines stop counting as cover on this job.",
        confirmLabel: "Cancel order",
      },
    });
  }
  return { items };
};
