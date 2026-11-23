"use client";

import * as React from "react";
import Link from "next/link";

import { ActionMenu } from "@/components/ui/action-menu";
import { PersonAvatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusWord } from "@/components/ui/status-word";
import {
  callRoleName,
  callStatusWord,
  callTimes,
  callsOn,
  dayState,
  displayDate,
  hoursText,
  isDimmed,
  isWeekend,
  memberName,
  plannedHours,
  type PlannerCall,
  type PlannerFilters,
  type PlannerMember,
} from "@/lib/crew-planner";
import { formatWeekday } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * The planner's one-week grid (spec §9h.3, D46): people by last name, Mon–Sun,
 * then Hours (planned from booked calls / logged from approved timesheets,
 * derived). A call is a block — tick, job number (links to the job's
 * Logistics tab), role, times, status word — and the rest of the block opens
 * the call sheet; ⋯ on hover and focus. An empty cell prints the person's day
 * (Unavailable hatched, Pencilled, Preferred) and offers a call on click.
 */

export const logisticsHref = (projectId: string) => `/projects/${projectId}?tab=logistics`;

export interface GridHandlers {
  selected: ReadonlySet<string>;
  /** `order` is every call id the grid shows, in reading order (for shift ranges). */
  onToggle: (id: string, shift: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onOpenCall: (call: PlannerCall, member: PlannerMember) => void;
  /** Absent when the caller may not offer: the cell is then not a button. */
  onOfferCell?: (member: PlannerMember, day: string) => void;
  menuFor: (call: PlannerCall, member: PlannerMember) => ActionMenuSpec;
}

function DayHead({ day, today }: { day: string; today: string }) {
  return (
    <th scope="col" className={cn("px-2 pb-1.5 text-left text-caption font-semibold text-muted", isWeekend(day) && "text-faint")}>
      {formatWeekday(displayDate(day))}
      <span className={cn("ml-1 font-mono text-ui-text font-medium", day === today ? "text-red-text" : "text-ink-2")}>{Number(day.slice(8))}</span>
    </th>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function CallBlock({ call, member, day, now, filters, userId, h }: { call: PlannerCall; member: PlannerMember; day: string; now: number; filters: PlannerFilters; userId?: string; h: GridHandlers }) {
  const word = callStatusWord(call, now);
  const job = call.project?.projectNumber ?? "Job";
  const ticked = h.selected.has(call.id);
  const label = `${job} ${callRoleName(call, member)}`.trim();
  const menu = h.menuFor(call, member);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${memberName(member)} · ${label}, ${day}`}
      data-call={call.id}
      onClick={() => h.onOpenCall(call, member)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && h.onOpenCall(call, member)}
      className={cn(
        "group/blk relative mb-1 flex min-w-0 cursor-pointer flex-col gap-px rounded-[7px] bg-paper-2 px-1.5 py-1 hover:bg-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
        ticked && "bg-select",
        isDimmed(call, filters, userId) && "opacity-40",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-caption">
        <span onClick={stop} className="inline-flex">
          <Checkbox
            aria-label={`Select ${label}, ${day}`}
            checked={ticked}
            onClick={(e) => {
              e.stopPropagation();
              h.onToggle(call.id, e.shiftKey);
            }}
          />
        </span>
        {call.project ? (
          <Link href={logisticsHref(call.project.id)} onClick={stop} title={call.project.name} className="flex-none font-mono font-semibold text-ink hover:underline">
            {job}
          </Link>
        ) : (
          <span className="font-mono font-semibold text-ink">{job}</span>
        )}
        <span className="min-w-0 truncate text-muted">{callRoleName(call, member)}</span>
      </div>
      {callTimes(call) && <div className="pl-5 font-mono text-[11px] text-muted">{callTimes(call)}</div>}
      <div className="pl-5">
        <StatusWord status={{ label: word.label, intent: word.intent }} className="text-caption" />
        {word.age && <span className={cn("ml-1 font-mono text-caption", word.stale ? "text-warn" : "text-faint")}>{word.age}</span>}
      </div>
      {menu.items.length > 0 && (
        <span onClick={stop} className="absolute right-0 top-0 opacity-0 focus-within:opacity-100 group-hover/blk:opacity-100">
          <ActionMenu spec={menu} label={`${label} actions`} />
        </span>
      )}
    </div>
  );
}

function EmptyCell({ member, day, h }: { member: PlannerMember; day: string; h: GridHandlers }) {
  const state = dayState(member, day);
  const word =
    state.kind === "unavailable" ? (
      <span className="text-caption text-muted">Unavailable</span>
    ) : state.kind === "pencilled" ? (
      <StatusWord status={{ label: "Pencilled", intent: "warning" }} className="text-caption" />
    ) : state.kind === "preferred" ? (
      <span className="text-caption text-faint">Preferred</span>
    ) : null;
  const body = (
    <>
      {word}
      {state.ref && <span className="block truncate font-mono text-[11px] text-faint">{state.ref}</span>}
    </>
  );
  const hatch = state.kind === "unavailable" && "bg-[repeating-linear-gradient(135deg,transparent_0_7px,var(--line)_7px_8px)]";
  if (!h.onOfferCell) return <div className={cn("h-full min-h-16 rounded-[7px] p-1.5", hatch)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => h.onOfferCell!(member, day)}
      aria-label={`Offer ${memberName(member)} a call on ${day}`}
      className={cn(
        "group/cell relative block h-full min-h-16 w-full rounded-[7px] p-1.5 text-left hover:bg-paper-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
        hatch,
      )}
    >
      {body}
      <span aria-hidden="true" className="absolute inset-0 hidden items-center justify-center text-xl font-light text-muted group-hover/cell:flex">
        +
      </span>
    </button>
  );
}

function PersonCell({ member }: { member: PlannerMember }) {
  return (
    <th scope="row" className="py-2 pr-2 text-left align-middle font-normal">
      <div className="flex min-w-0 items-center gap-2.5">
        <PersonAvatar name={memberName(member)} className="size-7" />
        <div className="min-w-0">
          <Link href={`/crew/${member.id}`} className="block truncate text-table-cell font-semibold text-ink hover:underline">
            {memberName(member)}
          </Link>
          <div className="truncate text-caption text-muted">{member.crewRole?.name ?? member.department ?? ""}</div>
        </div>
      </div>
    </th>
  );
}

function HoursCell({ member, week, logged }: { member: PlannerMember; week: string; logged: number }) {
  const planned = plannedHours(member, week);
  return (
    <td className="whitespace-nowrap pr-1 text-right align-middle font-mono text-ui-text">
      {planned > 0 ? <span className="text-ink-2">{hoursText(planned)}</span> : <span className="text-faint">—</span>}
      {logged > 0 && <span className="text-faint"> / {hoursText(logged)}</span>}
    </td>
  );
}

export interface PlannerGridProps {
  members: PlannerMember[];
  days: string[];
  week: string;
  today: string;
  now: number;
  filters: PlannerFilters;
  userId?: string;
  logged: Record<string, number>;
  /** Every call id shown, in reading order. */
  order: readonly string[];
  h: GridHandlers;
}

export function PlannerGrid({ members, days, week, today, now, filters, userId, logged, order, h }: PlannerGridProps) {
  const allOn = order.length > 0 && order.every((id) => h.selected.has(id));
  return (
    <table className="w-full table-fixed border-collapse" aria-label="Crew planner, one week">
      <colgroup>
        <col className="w-[196px]" />
        {days.map((d) => (
          <col key={d} />
        ))}
        <col className="w-[92px]" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="pb-1.5 text-left text-caption font-semibold text-muted">
            <span className="inline-flex items-center gap-2.5">
              <Checkbox aria-label="Select every call shown" checked={allOn} onCheckedChange={(v) => h.onToggleAll(v === true)} />
              Person
            </span>
          </th>
          {days.map((d) => (
            <DayHead key={d} day={d} today={today} />
          ))}
          <th scope="col" className="pb-1.5 pr-1 text-right text-caption font-semibold text-muted" title="Planned from booked calls · logged from approved timesheets">
            Hours
          </th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.id} className="border-t border-line align-top">
            <PersonCell member={m} />
            {days.map((d) => {
              const calls = callsOn(m, d);
              return (
                <td key={d} className={cn("px-0.5 py-1", isWeekend(d) && "bg-paper-2/30")}>
                  {calls.length > 0
                    ? calls.map((c) => <CallBlock key={c.id} call={c} member={m} day={d} now={now} filters={filters} userId={userId} h={h} />)
                    : <EmptyCell member={m} day={d} h={h} />}
                </td>
              );
            })}
            <HoursCell member={m} week={week} logged={logged[m.id] ?? 0} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every call the grid shows, person by person, day by day (the shift-range order). */
export function gridOrder(members: PlannerMember[], days: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of members) for (const d of days) for (const c of callsOn(m, d)) if (!seen.has(c.id)) { seen.add(c.id); out.push(c.id); }
  return out;
}
