import { CalendarClock, CheckCircle2 } from "lucide-react";

import type { BulkAction } from "@/lib/primitives/types";
import type { ScheduleJob } from "@/lib/schedule";
import { confirmSkipReason, moveSkipReason } from "@/lib/schedule-move";

/**
 * The Schedule's bulk bar verbs (spec §9o.5), with the count in the verb:
 * `Confirm 2` counts only the ticked Quoted jobs, `Move dates 3…` only the ones
 * whose dates are not locked. A verb that applies to none of the ticked jobs, or
 * that the caller cannot use, is ABSENT. The skipped jobs are still PASSED to the
 * write, which names each one and why in its toast (the server refuses them too).
 */
export interface ScheduleBulkHandlers {
  canUpdate: boolean;
  confirm: (jobs: ScheduleJob[]) => void | Promise<void>;
  openMove: (jobs: ScheduleJob[]) => void;
}

export function buildScheduleBulkActions(ticked: ScheduleJob[], h: ScheduleBulkHandlers): BulkAction[] {
  if (!h.canUpdate) return [];
  const confirmable = ticked.filter((j) => confirmSkipReason(j) == null).length;
  const movable = ticked.filter((j) => moveSkipReason(j) == null).length;
  return [
    ...(confirmable > 0
      ? [{ key: "confirm", label: () => `Confirm ${confirmable}`, group: "edit" as const, icon: CheckCircle2, onSelect: () => h.confirm(ticked) }]
      : []),
    ...(movable > 0
      ? [{ key: "move-dates", label: () => `Move dates ${movable}…`, group: "edit" as const, icon: CalendarClock, onSelect: () => h.openMove(ticked) }]
      : []),
  ];
}
