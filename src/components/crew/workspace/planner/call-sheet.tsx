"use client";

import * as React from "react";
import Link from "next/link";

import { ConfirmDialog } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusWord } from "@/components/ui/status-word";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  callRoleName,
  callStatusWord,
  callTimes,
  dayState,
  displayDate,
  DAY_KIND_INTENT,
  keyOfIso,
  memberName,
  type PlannerCall,
  type PlannerMember,
} from "@/lib/crew-planner";
import { formatDateDayMonth, formatWeekdayDayMonth } from "@/lib/formatters";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { logisticsHref } from "./planner-grid";

/**
 * The call sheet (spec §9h.3): what a block opens. Who, which job and day,
 * role, times, status (with when it was offered), the person's day (a clash
 * with another booking shows here), and the block ⋯ verbs as buttons — the
 * SAME spec the ⋯ renders (`buildCrewCallActions`), so the two can't differ.
 *
 * Editing the call's role, times or rate stays on the job's Logistics tab:
 * `crewAssignmentsWrites.updateNative` replaces the whole assignment, and a
 * planner edit below the pay line (which never read `rateOverride`) would
 * silently wipe it. The link goes there.
 */
export interface OpenedCall {
  call: PlannerCall;
  member: PlannerMember;
}

function Facts({ call, member, now }: { call: PlannerCall; member: PlannerMember; now: number }) {
  const word = callStatusWord(call, now);
  const day = call.startDate ? keyOfIso(call.startDate) : null;
  const state = day ? dayState(member, day, call.id) : null;
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-ui-text">
      <dt className="text-muted">Role</dt>
      <dd className="text-ink">{callRoleName(call, member) || "—"}</dd>
      <dt className="text-muted">Times</dt>
      <dd className="font-mono text-ink">{callTimes(call) || "—"}</dd>
      <dt className="text-muted">Status</dt>
      <dd>
        <StatusWord status={{ label: word.label, intent: word.intent }} />
        {call.offeredAt && call.status !== "PENDING" && <span className="ml-2 text-caption text-muted">offered {formatDateDayMonth(call.offeredAt)}</span>}
      </dd>
      {state && state.kind !== "free" && (
        <>
          <dt className="text-muted">Their day</dt>
          <dd>
            <StatusWord status={{ label: state.text, intent: DAY_KIND_INTENT[state.kind] }} />
          </dd>
        </>
      )}
    </dl>
  );
}

function Verbs({ spec, onRun }: { spec: ActionMenuSpec; onRun: (item: ActionItem) => void }) {
  const verbs = spec.items.filter((i) => i.group === "edit" || i.group === "danger");
  if (verbs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {verbs.map((i) => (
        <Button key={i.key} type="button" size="sm" variant="line" className={i.danger ? "text-red-text" : undefined} onClick={() => onRun(i)}>
          {i.label}
        </Button>
      ))}
    </div>
  );
}

export function CallSheet({ opened, spec, now, onOpenChange }: { opened: OpenedCall | null; spec: ActionMenuSpec; now: number; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const [confirming, setConfirming] = React.useState<ActionItem | null>(null);
  const run = (item: ActionItem) => {
    if (item.confirm) setConfirming(item);
    else {
      onOpenChange(false);
      void item.onSelect();
    }
  };
  const call = opened?.call;
  const day = call?.startDate ? formatWeekdayDayMonth(displayDate(keyOfIso(call.startDate))) : "";
  return (
    <Sheet open={!!opened} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-md">
        {opened && call && (
          <div className="flex flex-col gap-5 p-1">
            <SheetHeader>
              <SheetTitle>{memberName(opened.member)}</SheetTitle>
              <SheetDescription>
                {call.project ? `${call.project.projectNumber} ${call.project.name}` : "Job"} · {day}
              </SheetDescription>
            </SheetHeader>
            <Facts call={call} member={opened.member} now={now} />
            <Verbs spec={spec} onRun={run} />
            <SheetFooter>
              {call.project && (
                <Button asChild variant="line">
                  <Link href={logisticsHref(call.project.id)}>Edit on the job&apos;s Logistics tab</Link>
                </Button>
              )}
              <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
      <ConfirmDialog
        item={confirming}
        onClose={() => {
          setConfirming(null);
        }}
      />
    </Sheet>
  );
}
