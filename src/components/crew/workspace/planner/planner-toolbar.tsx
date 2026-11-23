"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterWord, type ListFilterDef } from "@/components/ui/list-page-parts";
import { addDays, AVAIL_KEYS, displayDate, type AvailKey, type OpenCall, type PlannerMember } from "@/lib/crew-planner";
import { formatDateDayMonth } from "@/lib/formatters";
import type { CrewRoleDoc } from "@/hooks/use-crew";
import type { PlannerUrl } from "./use-planner-url";

/**
 * The planner's toolbar (§9h.3): week ‹ › Today, search, then the filters as
 * words that read their value (`Role: Rigger ✕`) — Role, Skill, Job,
 * Availability. Every one is the URL (D11).
 */
const AVAIL_LABEL: Record<AvailKey, string> = {
  free: "Free",
  booked: "Booked",
  unavailable: "Unavailable",
  pencilled: "Pencilled",
  preferred: "Preferred",
};

/** `16 – 22 Nov`: the week as one range. */
function weekLabel(week: string): string {
  return `${formatDateDayMonth(displayDate(week))} – ${formatDateDayMonth(displayDate(addDays(week, 6)))}`;
}

function jobOptions(members: PlannerMember[], open: OpenCall[]) {
  const jobs = new Map<string, string>();
  for (const m of members) for (const c of m.assignments) if (c.project) jobs.set(c.project.id, `${c.project.projectNumber} ${c.project.name}`);
  for (const o of open) jobs.set(o.projectId, `${o.projectNumber} ${o.projectName}`);
  return [...jobs].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function plannerFilterDefs(roles: CrewRoleDoc[], skills: { id: string; name: string }[], members: PlannerMember[], open: OpenCall[]): ListFilterDef[] {
  return [
    { key: "role", label: "Role", options: roles.filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name })) },
    { key: "skill", label: "Skill", options: skills.map((s) => ({ value: s.id, label: s.name })) },
    { key: "job", label: "Job", options: jobOptions(members, open) },
    { key: "avail", label: "Availability", options: AVAIL_KEYS.map((k) => ({ value: k, label: AVAIL_LABEL[k] })) },
  ];
}

export function PlannerToolbar({ url, defs }: { url: PlannerUrl; defs: ListFilterDef[] }) {
  const f = url.state.filters;
  const active = Object.keys(f).length > 0 || !!url.state.q.trim();
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => url.stepWeek(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <span className="min-w-[112px] text-center font-mono text-ui-text font-medium text-ink" data-testid="planner-week">
          {weekLabel(url.week)}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => url.stepWeek(1)}>
          <ChevronRight className="size-5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => url.stepWeek(0)}>
          Today
        </Button>
      </div>
      <div className="relative md:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search crew"
          placeholder="Search person, role, skill or job"
          value={url.state.q}
          onChange={(e) => url.setSearch(e.target.value)}
          className="h-11 pl-9 text-base md:h-9 md:text-ui-text"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto md:flex-1 md:overflow-visible">
        {defs.map((d) => (
          <FilterWord key={d.key} def={d} chosen={f[d.key] ?? []} onChange={(v) => url.setFilter(d.key, v)} />
        ))}
        {active && (
          <button type="button" onClick={url.clear} className="min-h-11 shrink-0 text-ui-text text-muted hover:text-ink md:min-h-9">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
