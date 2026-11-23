"use client";

import * as React from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { PersonAvatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusWord } from "@/components/ui/status-word";
import {
  callStatusWord,
  callTimes,
  callsOn,
  dayState,
  displayDate,
  DAY_KIND_INTENT,
  memberName,
  type OpenCall,
  type PlannerCall,
  type PlannerMember,
} from "@/lib/crew-planner";
import { formatWeekday, formatWeekdayDayMonth } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import { openDay } from "./needs-crew-list";

/**
 * The planner on a phone (spec §9h.6, Logistics' day mode): day chips for the
 * week (`Tue 17 · 1 open`, the open count red), then ONE day as sections —
 * Needs crew (open calls), Booked (64px cards: 22px tick, avatar, name,
 * `#2341 · 06:30–08:30`, status word, ⋯), Free, Unavailable. A booked card
 * opens the call sheet; a free card opens Offer a call for that day. The Needs
 * crew strip lists the week's open calls by day instead.
 */
export interface PhonePlannerProps {
  members: PlannerMember[];
  open: OpenCall[];
  days: string[];
  week: string;
  now: number;
  needsOnly: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenCall: (call: PlannerCall, member: PlannerMember) => void;
  onOfferFree?: (member: PlannerMember, day: string) => void;
  onOpenOpen: (o: OpenCall) => void;
  menuFor: (call: PlannerCall, member: PlannerMember) => ActionMenuSpec;
  openMenuFor: (o: OpenCall) => ActionMenuSpec;
}

const label = (d: string) => formatWeekdayDayMonth(displayDate(d));

function DayChips({ days, day, onDay, openOn }: { days: string[]; day: string; onDay: (d: string) => void; openOn: (d: string) => number }) {
  return (
    <div role="tablist" aria-label="Day" className="flex gap-2 overflow-x-auto pb-1">
      {days.map((d) => {
        const n = openOn(d);
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === day}
            onClick={() => onDay(d)}
            className={cn("flex min-h-11 shrink-0 flex-col justify-center rounded-xl px-3 text-left leading-tight", d === day ? "bg-paper-2 text-ink" : "text-muted")}
          >
            <span className="text-ui-text font-semibold">
              {formatWeekday(displayDate(d))} {Number(d.slice(8))}
            </span>
            <span className={cn("text-[11px]", n > 0 ? "text-t-out" : "text-faint")}>{n > 0 ? `${n} open` : "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="flex items-baseline gap-1.5 pb-1.5 pt-3 text-ui-text font-semibold text-ink">
        {title}
        <span className="font-mono text-caption font-medium text-faint">{count}</span>
      </h3>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function OpenCard({ o, p }: { o: OpenCall; p: PhonePlannerProps }) {
  return (
    <div className="flex min-h-16 items-center gap-3">
      <button type="button" onClick={() => p.onOpenOpen(o)} className="flex min-h-16 min-w-0 flex-1 flex-col justify-center text-left">
        <span className="truncate text-ui-text font-semibold text-ink">
          {o.projectNumber} {o.title}
        </span>
        <span className="truncate text-caption text-muted">
          {[o.crewRoleName, callTimes(o)].filter(Boolean).join(" · ")}
        </span>
      </button>
      <StatusWord status={{ label: `needs ${o.shortfall}`, intent: "error" }} className="text-caption" />
      <ActionMenu spec={p.openMenuFor(o)} label={`${o.projectNumber} ${o.title} actions`} />
    </div>
  );
}

function BookedCard({ m, c, p }: { m: PlannerMember; c: PlannerCall; p: PhonePlannerProps }) {
  const word = callStatusWord(c, p.now);
  const job = c.project?.projectNumber ?? "Job";
  return (
    <div className="flex min-h-16 items-center gap-3" data-call={c.id}>
      <Checkbox aria-label={`Select ${memberName(m)} ${job}`} checked={p.selected.has(c.id)} onCheckedChange={() => p.onToggle(c.id)} className="size-[22px]" />
      <button type="button" onClick={() => p.onOpenCall(c, m)} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 text-left">
        <PersonAvatar name={memberName(m)} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-text font-semibold text-ink">{memberName(m)}</span>
          <span className="block truncate font-mono text-caption text-muted">
            {job}
            {callTimes(c) ? ` · ${callTimes(c)}` : ""}
          </span>
        </span>
        <StatusWord status={{ label: word.age ? `${word.label} ${word.age}` : word.label, intent: word.intent }} className="text-caption" />
      </button>
      <ActionMenu spec={p.menuFor(c, m)} label={`${memberName(m)} ${job} actions`} />
    </div>
  );
}

function PersonCard({ m, day, p }: { m: PlannerMember; day: string; p: PhonePlannerProps }) {
  const s = dayState(m, day);
  const body = (
    <>
      <PersonAvatar name={memberName(m)} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui-text font-semibold text-ink">{memberName(m)}</span>
        <span className="block truncate text-caption text-muted">{[m.crewRole?.name, s.ref].filter(Boolean).join(" · ")}</span>
      </span>
      <StatusWord status={{ label: s.kind === "free" ? "Free" : s.text.split(" · ")[0], intent: DAY_KIND_INTENT[s.kind] }} className="text-caption" />
    </>
  );
  if (!p.onOfferFree) return <div className="flex min-h-16 items-center gap-3">{body}</div>;
  return (
    <button type="button" onClick={() => p.onOfferFree!(m, day)} aria-label={`Offer ${memberName(m)} a call on ${day}`} className="flex min-h-16 w-full items-center gap-3 text-left">
      {body}
    </button>
  );
}

function DaySections({ day, p }: { day: string; p: PhonePlannerProps }) {
  const opens = p.open.filter((o) => openDay(o, p.week) === day);
  const booked = p.members.flatMap((m) => callsOn(m, day).map((c) => ({ m, c })));
  const bookedIds = new Set(booked.map((b) => b.m.id));
  const rest = p.members.filter((m) => !bookedIds.has(m.id));
  const off = rest.filter((m) => dayState(m, day).kind === "unavailable");
  const free = rest.filter((m) => dayState(m, day).kind !== "unavailable");
  return (
    <>
      <Section title="Needs crew" count={opens.length}>
        {opens.map((o) => <OpenCard key={o.serviceId} o={o} p={p} />)}
      </Section>
      <Section title="Booked" count={booked.length}>
        {booked.map(({ m, c }) => <BookedCard key={c.id} m={m} c={c} p={p} />)}
      </Section>
      <Section title="Free" count={free.length}>
        {free.map((m) => <PersonCard key={m.id} m={m} day={day} p={p} />)}
      </Section>
      <Section title="Unavailable" count={off.length}>
        {off.map((m) => <PersonCard key={m.id} m={m} day={day} p={p} />)}
      </Section>
    </>
  );
}

/** The first day worth opening: today if it is in the week, else the first day with an open call, else Monday. */
function firstDay(days: string[], open: OpenCall[], week: string, today: string): string {
  if (days.includes(today)) return today;
  return open.map((o) => openDay(o, week)).sort()[0] ?? week;
}

export function PhonePlanner(p: PhonePlannerProps & { today: string }) {
  const [day, setDay] = React.useState(() => firstDay(p.days, p.open, p.week, p.today));
  const openOn = (d: string) => p.open.filter((o) => openDay(o, p.week) === d).reduce((n, o) => n + o.shortfall, 0);
  if (p.needsOnly) {
    const days = p.days.filter((d) => openOn(d) > 0);
    return (
      <div>
        {days.map((d) => (
          <Section key={d} title={label(d)} count={openOn(d)}>
            {p.open.filter((o) => openDay(o, p.week) === d).map((o) => <OpenCard key={o.serviceId} o={o} p={p} />)}
          </Section>
        ))}
      </div>
    );
  }
  return (
    <div>
      <DayChips days={p.days} day={day} onDay={setDay} openOn={openOn} />
      <DaySections day={day} p={p} />
    </div>
  );
}
