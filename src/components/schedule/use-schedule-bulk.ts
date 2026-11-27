"use client";

import * as React from "react";

import { toast } from "sonner";

import { useRangeSelection } from "@/components/crew/workspace/planner/use-range-selection";
import { useCanDo } from "@/lib/use-permissions";
import type { ScheduleJob } from "@/lib/schedule";
import { buildScheduleBulkActions } from "@/lib/row-actions/schedule-bulk";
import { confirmSkipReason, MAX_SCHEDULE_BULK, moveSkipReason } from "@/lib/schedule-move";
import type { JobSelection } from "./jobs-timeline";
import type { JobSheetVerbs } from "./schedule-sheets";
import { useScheduleWrites } from "./use-schedule-writes";

/**
 * The Jobs view's selection, bulk bar, and the ONE place Confirm and Move dates
 * are raised from (the row ⋯, the job sheet and the bulk bar all call the same
 * two functions, so there is one gate, one write and one Undo per verb).
 * Ticks count only while their job is still SHOWN (a filter or a range step that
 * hides it drops it from the count and from the verb); an org switch remounts
 * the page, which drops every tick.
 */
export function useScheduleBulk(orgId: string | undefined, shown: ScheduleJob[]) {
  const writes = useScheduleWrites(orgId);
  const canUpdate = useCanDo("project", "update");
  const sel = useRangeSelection();
  const [moveJobs, setMoveJobs] = React.useState<ScheduleJob[] | null>(null);
  const order = shown.map((j) => j.id);
  const ticked = shown.filter((j) => sel.ids.has(j.id));

  const selection: JobSelection = {
    ids: sel.ids,
    onToggle: (id, shift) => sel.toggle(id, order, shift),
    onToggleAll: (on) => sel.setAll(order, on),
  };
  /** A client cap with a clear message (the server still gates every row): a bulk write never runs past it. */
  const withinCap = (jobs: ScheduleJob[]): boolean => {
    if (jobs.length <= MAX_SCHEDULE_BULK) return true;
    toast.error(`${jobs.length} jobs selected: ${MAX_SCHEDULE_BULK} at most at a time. Untick some and try again.`);
    return false;
  };
  const confirm = async (jobs: ScheduleJob[]) => {
    if (!withinCap(jobs)) return;
    await writes.confirmMany(jobs);
    sel.clear();
  };
  const move = async (jobs: ScheduleJob[], days: number) => {
    if (!withinCap(jobs)) return;
    await writes.moveMany(jobs, days);
    sel.clear();
  };
  const verbs = { confirm, openMove: setMoveJobs };
  /** The job sheet's verbs for ONE job: only those that apply to it (not Quoted, locked dates and no `project:update` are absent). */
  const sheetVerbsFor = (j: ScheduleJob): JobSheetVerbs => ({
    confirm: canUpdate && confirmSkipReason(j) == null ? (job) => void confirm([job]) : undefined,
    moveDates: canUpdate && moveSkipReason(j) == null ? (job) => setMoveJobs([job]) : undefined,
  });

  return {
    writes,
    selection,
    ticked,
    clear: sel.clear,
    verbs,
    actions: buildScheduleBulkActions(ticked, { canUpdate, ...verbs }),
    sheetVerbsFor,
    moveJobs,
    closeMove: () => setMoveJobs(null),
    move,
  };
}
