import { Boxes, ExternalLink, Link2, Truck } from "lucide-react";

import type { ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The Schedule job row's ⋯ (spec §9o.5): Open job · Equipment › · Logistics › ·
 * Copy link. One pure builder over the handlers the page passes; an action that
 * does not apply is ABSENT, never disabled. Confirm… and Move dates… join it
 * with the bulk slice, through the confirm and date-move gates.
 */
export interface ScheduleJobHandlers {
  open: () => void;
  equipment: () => void;
  logistics: () => void;
  copyLink: () => void;
}

export function buildScheduleJobActions(h: ScheduleJobHandlers): ActionMenuSpec {
  return {
    items: [
      { key: "open", label: "Open job", group: "organise", icon: ExternalLink, onSelect: h.open },
      { key: "equipment", label: "Equipment ›", group: "organise", icon: Boxes, onSelect: h.equipment },
      { key: "logistics", label: "Logistics ›", group: "organise", icon: Truck, onSelect: h.logistics },
      { key: "copy-link", label: "Copy link", group: "organise", icon: Link2, onSelect: h.copyLink },
    ],
  };
}
