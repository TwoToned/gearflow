import { Boxes, CalendarClock, CheckCircle2, ExternalLink, Link2, Truck } from "lucide-react";

import type { ActionMenuSpec } from "@/lib/primitives/types";

/**
 * The Schedule job row's ⋯ (spec §9o.5): Open job · Equipment › · Logistics › ·
 * Copy link. One pure builder over the handlers the page passes; an action that
 * does not apply is ABSENT, never disabled. Confirm… and Move dates… (edit group) run through the
 * same non-blocking gates as the bulk bar and the job page, and are absent when they do not apply.
 */
export interface ScheduleJobHandlers {
  open: () => void;
  equipment: () => void;
  logistics: () => void;
  copyLink: () => void;
  /** Absent when the job is not Quoted or the caller cannot update jobs: the verb is not offered at all. */
  confirm?: () => void;
  /** Absent when the job's dates are locked (gear out, or finished) or the caller cannot update jobs. */
  moveDates?: () => void;
}

export function buildScheduleJobActions(h: ScheduleJobHandlers): ActionMenuSpec {
  const verbs: ActionMenuSpec["items"] = [
    ...(h.confirm ? [{ key: "confirm", label: "Confirm…", group: "edit" as const, icon: CheckCircle2, onSelect: h.confirm }] : []),
    ...(h.moveDates ? [{ key: "move-dates", label: "Move dates…", group: "edit" as const, icon: CalendarClock, onSelect: h.moveDates }] : []),
  ];
  return {
    items: [
      ...verbs,
      { key: "open", label: "Open job", group: "organise", icon: ExternalLink, onSelect: h.open },
      { key: "equipment", label: "Equipment ›", group: "organise", icon: Boxes, onSelect: h.equipment },
      { key: "logistics", label: "Logistics ›", group: "organise", icon: Truck, onSelect: h.logistics },
      { key: "copy-link", label: "Copy link", group: "organise", icon: Link2, onSelect: h.copyLink },
    ],
  };
}
