"use client";

import * as React from "react";
import Link from "next/link";

import { ActionMenu } from "@/components/ui/action-menu";
import { PersonAvatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusWord } from "@/components/ui/status-word";
import { callTimes, candidatesFor, daysCovered, displayDate, memberName, openDay, type OpenCall, type PlannerMember } from "@/lib/crew-planner";
import { shortDaysText } from "@/lib/crew-short-days";
import { formatWeekdayDayMonth } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import { logisticsHref } from "./planner-grid";

/**
 * Needs crew (spec §9h.3): the grid's place taken by the calls still short of
 * people, grouped by day — job · call · times · `needs n` · the free people
 * with that role (preferred first). A row opens Offer a call with the first
 * suggestion picked; ⋯ is Offer to…, Offer to suggested, Open job.
 */

export interface NeedsCrewProps {
  open: OpenCall[];
  /** The visible week's days (a multi-day run's suggestions check each one it covers). */
  days: readonly string[];
  members: PlannerMember[];
  week: string;
  selected: ReadonlySet<string>;
  onToggle: (serviceId: string, shift: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onOpen: (o: OpenCall) => void;
  menuFor: (o: OpenCall) => ActionMenuSpec;
  empty: React.ReactNode;
  /** The server stopped reading at its cap: the count is a floor (`n+`). */
  truncated?: boolean;
}

/** `12+ open slots · the list stops at its cap; narrow it with a filter` — said once, above the list. */
export function TruncatedNote({ open }: { open: OpenCall[] }) {
  const n = open.reduce((s, o) => s + o.shortfall, 0);
  return (
    <p className="pb-2 text-caption text-warn" data-testid="needs-truncated">
      {n}+ open slots · the list stops at its cap; narrow it with a Role or Job filter to see the rest.
    </p>
  );
}

/** Free on EVERY day of the window the service covers (a multi-day run), preferred first. */
function Suggestions({ o, members, days }: { o: OpenCall; members: PlannerMember[]; days: readonly string[] }) {
  const c = candidatesFor(o, members, daysCovered(o, days)).slice(0, 3);
  if (c.length === 0) return <span className="text-caption text-faint">no one free</span>;
  return (
    <span className="inline-flex items-center gap-2 text-caption text-muted">
      <span className="flex -space-x-1">
        {c.map((x) => (
          <PersonAvatar key={x.member.id} name={memberName(x.member)} className="size-6" title={memberName(x.member)} />
        ))}
      </span>
      {c[0].day.kind === "preferred" && "preferred first"}
    </span>
  );
}

function OpenRow({ o, members, ticked, p }: { o: OpenCall; members: PlannerMember[]; ticked: boolean; p: NeedsCrewProps }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <tr
      onClick={() => p.onOpen(o)}
      className={cn("cursor-pointer border-t border-line hover:bg-paper-2", ticked && "bg-select")}
      data-open={o.serviceId}
    >
      <td className="w-12 py-2 align-middle" onClick={stop}>
        <Checkbox
          aria-label={`Select ${o.projectNumber} ${o.title}`}
          checked={ticked}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggle(o.serviceId, e.shiftKey);
          }}
        />
      </td>
      <td className="w-20 align-middle">
        <Link href={logisticsHref(o.projectId)} onClick={stop} className="font-mono text-ui-text text-ink hover:underline">
          {o.projectNumber}
        </Link>
      </td>
      <td className="min-w-0 py-2 align-middle">
        {/* The row's keyboard-reachable primary (the row click is a mouse convenience). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            p.onOpen(o);
          }}
          className="block max-w-full truncate text-left text-table-cell font-semibold text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
        >
          {o.title}
        </button>
        <div className="truncate text-caption text-muted">
          {o.projectName}
          {o.crewRoleName ? ` · ${o.crewRoleName}` : ""}
          {shortDaysText(o) ? ` · ${shortDaysText(o)}` : ""}
        </div>
      </td>
      <td className="w-32 align-middle font-mono text-caption text-ink-2">{callTimes(o)}</td>
      <td className="w-24 align-middle">
        <StatusWord status={{ label: `needs ${o.shortfall}`, intent: "error" }} className="text-caption" />
      </td>
      <td className="w-40 align-middle">
        <Suggestions o={o} members={members} days={p.days} />
      </td>
      <td className="w-10 align-middle" onClick={stop}>
        <ActionMenu spec={p.menuFor(o)} label={`${o.projectNumber} ${o.title} actions`} />
      </td>
    </tr>
  );
}

export function NeedsCrewList(p: NeedsCrewProps) {
  const days = [...new Set(p.open.map((o) => openDay(o, p.week)))].sort();
  const allOn = p.open.length > 0 && p.open.every((o) => p.selected.has(o.serviceId));
  if (p.open.length === 0) return <>{p.empty}</>;
  return (
    <>
    {p.truncated && <TruncatedNote open={p.open} />}
    <table className="w-full table-fixed border-collapse" aria-label="Calls that need crew">
      <thead>
        <tr className="text-left text-caption font-semibold text-muted">
          <th className="w-12 pb-1.5">
            <Checkbox aria-label="Select every open call" checked={allOn} onCheckedChange={(v) => p.onToggleAll(v === true)} />
          </th>
          <th className="w-20 pb-1.5">Job</th>
          <th className="pb-1.5">Call</th>
          <th className="w-32 pb-1.5">Times</th>
          <th className="w-24 pb-1.5">Needs</th>
          <th className="w-40 pb-1.5">Free to offer</th>
          <th className="w-10 pb-1.5" />
        </tr>
      </thead>
      {days.map((d) => {
        const rows = p.open.filter((o) => openDay(o, p.week) === d);
        return (
          <tbody key={d}>
            <tr>
              <th colSpan={7} scope="rowgroup" className="pb-1 pt-4 text-left text-ui-text font-semibold text-ink">
                {formatWeekdayDayMonth(displayDate(d))}
                <span className="ml-2 font-mono text-caption font-medium text-faint">{rows.reduce((n, o) => n + o.shortfall, 0)}</span>
              </th>
            </tr>
            {rows.map((o) => (
              <OpenRow key={o.serviceId} o={o} members={p.members} ticked={p.selected.has(o.serviceId)} p={p} />
            ))}
          </tbody>
        );
      })}
    </table>
    </>
  );
}
