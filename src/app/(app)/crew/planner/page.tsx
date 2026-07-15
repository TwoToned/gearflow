"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Users,
  CalendarCheck,
  CalendarOff,
  CircleSlash,
} from "lucide-react";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCrewAssignments, fingerprintCrewAssignments, useOrgAvailabilities, fingerprintAvailabilities } from "@/hooks/use-crew-scheduling";
import { getStatusColor } from "@/lib/status-colors";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageMeta } from "@/components/layout/page-meta";
import { FadeIn } from "@/components/ui/motion";
import { PageHeader } from "@/components/layout/page-header";
import { focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonAvatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Monday start
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDayOfWeek(date: Date): string {
  return date.toLocaleDateString("en-AU", { weekday: "short" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function dateToKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ─── Types ───────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type CrewMemberData = Record<string, any>;

const ALL = "__all__";

// ─── Component ───────────────────────────────────────────────────────────────

const DAYS_TO_SHOW = 14;

export default function CrewPlannerPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const pConvex = useConvex();
  const { isAuthenticated: pAuthed } = useConvexAuth();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>(ALL);
  const [memberFilter, setMemberFilter] = useState<string>(ALL);
  const [availFilter, setAvailFilter] = useState<string>(ALL);

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      result.push(addDays(weekStart, i));
    }
    return result;
  }, [weekStart]);

  const startDate = days[0].toISOString().split("T")[0];
  const endDate = days[days.length - 1].toISOString().split("T")[0];

  const { data: members, isLoading, error, refetch } = useServerQuery({
    queryKey: ["crew-planner", orgId, startDate, endDate],
    queryFn: () => pConvex.query(api.crewAvailability.plannerData, { orgId: orgId as string, startMs: new Date(startDate).getTime(), endMs: new Date(endDate).getTime() }),
    enabled: !!orgId && pAuthed,
  });

  // Cross-tab live sync: subscribe to the dual-written Convex crewAssignments +
  // crewAvailabilities tables; a fingerprint change (crew booked/moved/confirmed,
  // or someone marking themselves off in another tab) re-fetches the planner.
  const assignmentDocs = useOrgCrewAssignments(orgId);
  const availabilityDocs = useOrgAvailabilities(orgId);
  const plannerFp = `${fingerprintCrewAssignments(assignmentDocs) ?? ""}#${fingerprintAvailabilities(availabilityDocs) ?? ""}`;
  const ready = assignmentDocs !== undefined || availabilityDocs !== undefined;
  const prevPlannerFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (prevPlannerFp.current !== undefined && plannerFp !== prevPlannerFp.current) {
      refetch();
    }
    prevPlannerFp.current = plannerFp;
  }, [plannerFp, ready, refetch]);

  const goBack = () => setWeekStart((d) => addDays(d, -7));
  const goForward = () => setWeekStart((d) => addDays(d, 7));
  const goToday = () => setWeekStart(startOfWeek(new Date()));

  // Stable "today" so the summary useMemo doesn't recompute every render.
  const today = useMemo(() => new Date(), []);

  // ── Filter option lists (derived from loaded data) ─────────────────────────
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of (members as CrewMemberData[]) ?? []) {
      for (const a of m.assignments ?? []) {
        if (a.project?.id) {
          map.set(
            a.project.id,
            `${a.project.projectNumber ? `${a.project.projectNumber} — ` : ""}${a.project.name ?? "Untitled"}`,
          );
        }
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  const memberOptions = useMemo(() => {
    return ((members as CrewMemberData[]) ?? [])
      .map((m) => ({
        id: m.id,
        label: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Unnamed",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  // ── Apply filters client-side over the loaded data ─────────────────────────
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ((members as CrewMemberData[]) ?? []).filter((m) => {
      if (memberFilter !== ALL && m.id !== memberFilter) return false;

      if (q) {
        const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.toLowerCase();
        const role = (m.crewRole?.name ?? "").toLowerCase();
        const dept = (m.department ?? "").toLowerCase();
        const inProjects = (m.assignments ?? []).some((a: any) => {
          const pn = `${a.project?.projectNumber ?? ""} ${a.project?.name ?? ""}`.toLowerCase();
          return pn.includes(q);
        });
        if (
          !name.includes(q) &&
          !role.includes(q) &&
          !dept.includes(q) &&
          !inProjects
        ) {
          return false;
        }
      }

      if (projectFilter !== ALL) {
        const onProject = (m.assignments ?? []).some(
          (a: any) => a.project?.id === projectFilter,
        );
        if (!onProject) return false;
      }

      if (availFilter !== ALL) {
        if (availFilter === "ASSIGNED") {
          if (!(m.assignments ?? []).length) return false;
        } else {
          const hasType = (m.availability ?? []).some(
            (av: any) => av.type === availFilter,
          );
          if (!hasType) return false;
        }
      }

      return true;
    });
  }, [members, search, memberFilter, projectFilter, availFilter]);

  const filtersActive =
    !!search.trim() ||
    projectFilter !== ALL ||
    memberFilter !== ALL ||
    availFilter !== ALL;

  const clearFilters = () => {
    setSearch("");
    setProjectFilter(ALL);
    setMemberFilter(ALL);
    setAvailFilter(ALL);
  };

  // ── At-a-glance counts (over the loaded roster, today) ──────────────────────
  const summary = useMemo(() => {
    const all = (members as CrewMemberData[]) ?? [];
    const total = all.length;
    let bookedToday = 0;
    let offToday = 0;

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    for (const m of all) {
      const booked = (m.assignments ?? []).some((a: any) => {
        const s = a.startDate ? new Date(a.startDate) : null;
        const e = a.endDate ? new Date(a.endDate) : null;
        if (!s) return false;
        return s <= todayEnd && (e ? e >= todayStart : s <= todayEnd);
      });
      const off = (m.availability ?? []).some((av: any) => {
        if (av.type !== "UNAVAILABLE") return false;
        const s = new Date(av.startDate);
        const e = new Date(av.endDate);
        return s <= todayEnd && e >= todayStart;
      });
      if (booked) bookedToday++;
      if (off) offToday++;
    }

    const availableToday = Math.max(total - bookedToday - offToday, 0);
    return { total, bookedToday, availableToday, offToday };
  }, [members, today]);

  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Crew planner" />
      <FadeIn>
      <div className="space-y-4">
        <PageHeader
          title="Crew planner"
          description="Who's booked, who's free — across the fortnight."
          actions={
            <div className="flex items-center gap-2">
              <Button variant="line" size="icon" onClick={goBack} aria-label="Previous fortnight">
                <ChevronLeft className="size-5" />
              </Button>
              <Button variant="line" size="sm" onClick={goToday}>
                Today
              </Button>
              <Button variant="line" size="icon" onClick={goForward} aria-label="Next fortnight">
                <ChevronRight className="size-5" />
              </Button>
              <span className="text-caption tabular-nums text-muted ml-2 hidden sm:inline">
                {formatDateShort(days[0])} &ndash; {formatDateShort(days[days.length - 1])}
              </span>
            </div>
          }
        />

        {/* ── At-a-glance strip ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line shadow-[var(--sh-card)] sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-line sm:bg-card">
          <SummaryTile
            label="Crew on roster"
            value={summary.total}
            icon={Users}
            loading={isLoading}
          />
          <SummaryTile
            label="Booked today"
            value={summary.bookedToday}
            icon={CalendarCheck}
            tone="primary"
            loading={isLoading}
          />
          <SummaryTile
            label="Free today"
            value={summary.availableToday}
            icon={CalendarCheck}
            tone="ok"
            loading={isLoading}
          />
          <SummaryTile
            label="Off today"
            value={summary.offToday}
            icon={CalendarOff}
            tone={summary.offToday > 0 ? "warn" : undefined}
            loading={isLoading}
          />
        </div>

        {/* ── Filter / search bar ────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)] sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search crew, role, or project…"
              className="pl-9"
              aria-label="Search planner"
            />
          </div>

          <Select value={memberFilter} onValueChange={setMemberFilter}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by crew member">
              <SelectValue>
                {memberFilter === ALL
                  ? "All crew"
                  : memberOptions.find((m) => m.id === memberFilter)?.label ?? "All crew"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All crew</SelectItem>
              {memberOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-full sm:w-52" aria-label="Filter by project">
              <SelectValue>
                {projectFilter === ALL
                  ? "All projects"
                  : projectOptions.find((p) => p.id === projectFilter)?.label ?? "All projects"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={availFilter} onValueChange={setAvailFilter}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by availability">
              <SelectValue>
                {(
                  {
                    [ALL]: "Any status",
                    ASSIGNED: "Booked",
                    UNAVAILABLE: "Unavailable",
                    TENTATIVE: "Tentative",
                    PREFERRED: "Preferred",
                  } as Record<string, string>
                )[availFilter] ?? "Any status"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              <SelectItem value="ASSIGNED">Booked</SelectItem>
              <SelectItem value="UNAVAILABLE">Unavailable</SelectItem>
              <SelectItem value="TENTATIVE">Tentative</SelectItem>
              <SelectItem value="PREFERRED">Preferred</SelectItem>
            </SelectContent>
          </Select>

          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-5" />
              Clear
            </Button>
          )}
          {!isLoading && members && (
            <span className="text-caption tabular-nums text-muted sm:ml-auto">
              {filteredMembers.length} of {(members as CrewMemberData[]).length} shown
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between gap-4 rounded-[var(--r)] border border-line border-l-[3px] border-l-t-out bg-card p-3">
            <p className="text-ui-text text-t-out">Couldn&apos;t load the planner. Check your connection and try again.</p>
            <Button variant="line" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        <div className="rounded-[var(--r-lg)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-x-auto">
          <TooltipProvider>
            <table className="w-full border-collapse min-w-[860px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left text-caption font-medium text-muted p-3 w-52 sticky left-0 bg-card z-10">
                    Crew member
                  </th>
                  {days.map((day) => {
                    const isToday = isSameDay(day, today);
                    return (
                      <th
                        key={dateToKey(day)}
                        className={`p-1.5 min-w-[62px] text-center align-bottom ${
                          isWeekend(day) && !isToday ? "bg-paper-2" : ""
                        }`}
                      >
                        <div
                          className={`text-[10px] font-semibold uppercase-0 ${
                            isToday ? "text-red" : isWeekend(day) ? "text-faint" : "text-muted"
                          }`}
                        >
                          {formatDayOfWeek(day)}
                        </div>
                        <div
                          className={`mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-caption tabular-nums ${
                            isToday
                              ? "bg-red font-bold text-white"
                              : isWeekend(day)
                                ? "text-faint"
                                : "text-ink-2"
                          }`}
                        >
                          {day.getDate()}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="p-3 sticky left-0 bg-card z-10">
                        <div className="flex items-center gap-2">
                          <Skeleton className="size-8 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      </td>
                      {days.map((day) => (
                        <td key={dateToKey(day)} className="p-1.5 h-12">
                          <Skeleton className="mx-auto h-6 w-full rounded-[8px]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : !members || members.length === 0 ? (
                  <tr>
                    <td colSpan={DAYS_TO_SHOW + 1} className="p-6">
                      <EmptyState
                        title="No active crew on the roster yet"
                        description="Add crew to your roster to start planning assignments."
                      />
                    </td>
                  </tr>
                ) : filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={DAYS_TO_SHOW + 1} className="p-6">
                      <EmptyState
                        title="No crew match these filters"
                        description="Try a different search or clear the filters."
                        action={
                          <Button variant="line" size="sm" onClick={clearFilters}>
                            Clear filters
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => (
                    <PlannerRow
                      key={member.id}
                      member={member}
                      days={days}
                      today={today}
                      highlightProjectId={projectFilter !== ALL ? projectFilter : null}
                    />
                  ))
                )}
              </tbody>
            </table>
          </TooltipProvider>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted">
          <LegendChip color={getStatusColor("assignment", "ACCEPTED").dot} label="Assignment" />
          <LegendChip color={getStatusColor("availabilityType", "UNAVAILABLE").dot} label="Unavailable" />
          <LegendChip color={getStatusColor("availabilityType", "TENTATIVE").dot} label="Tentative" />
          <LegendChip color={getStatusColor("availabilityType", "PREFERRED").dot} label="Preferred" />
          <span className="ml-auto flex items-center gap-1.5">
            <CircleSlash className="size-3.5" />
            Blank = no plans
          </span>
        </div>
      </div>
      </FadeIn>
    </RequirePermission>
  );
}

// ─── Summary Tile ──────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "primary" | "ok" | "warn";
  loading?: boolean;
}) {
  const valueColor =
    tone === "primary"
      ? "text-red"
      : tone === "ok"
        ? "text-ok"
        : tone === "warn"
          ? "text-warn"
          : "text-ink";
  return (
    <div className="bg-card px-4 py-3 sm:first:rounded-l-[var(--r)] sm:last:rounded-r-[var(--r)]">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon className="size-3.5" />
        <span className="t-overline">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-10" />
      ) : (
        <div className={`text-section-header font-display font-extrabold tabular-nums ${valueColor}`}>
          {value}
        </div>
      )}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ─── Planner Row ─────────────────────────────────────────────────────────────

function PlannerRow({
  member,
  days,
  today,
  highlightProjectId,
}: {
  member: CrewMemberData;
  days: Date[];
  today: Date;
  highlightProjectId: string | null;
}) {
  // Build day status map
  const dayData = useMemo(() => {
    const result: Record<
      string,
      {
        assignments: { projectName: string; projectNumber: string; roleName: string | null; projectId: string }[];
        availability: { type: string; reason: string | null }[];
      }
    > = {};

    for (const day of days) {
      const key = dateToKey(day);
      result[key] = { assignments: [], availability: [] };
    }

    // Map assignments to days
    for (const a of member.assignments || []) {
      const aStart = a.startDate ? new Date(a.startDate) : null;
      const aEnd = a.endDate ? new Date(a.endDate) : null;
      if (!aStart) continue;

      for (const day of days) {
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);

        if (aStart <= dayEnd && (aEnd ? aEnd >= dayStart : aStart <= dayEnd)) {
          const key = dateToKey(day);
          if (result[key]) {
            result[key].assignments.push({
              projectName: a.project?.name || "Unknown",
              projectNumber: a.project?.projectNumber || "",
              roleName: a.crewRole?.name || null,
              projectId: a.project?.id || "",
            });
          }
        }
      }
    }

    // Map availability to days
    for (const av of member.availability || []) {
      const avStart = new Date(av.startDate);
      const avEnd = new Date(av.endDate);

      for (const day of days) {
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);

        if (avStart <= dayEnd && avEnd >= dayStart) {
          const key = dateToKey(day);
          if (result[key]) {
            result[key].availability.push({
              type: av.type,
              reason: av.reason || null,
            });
          }
        }
      }
    }

    return result;
  }, [member, days]);

  // Count active assignments in the window for a quick row summary chip.
  const assignmentDays = useMemo(
    () =>
      Object.values(dayData).filter((d) => d.assignments.length > 0).length,
    [dayData],
  );

  return (
    <tr className="group border-b border-line transition-colors hover:bg-elev">
      <td className="p-3 sticky left-0 bg-card z-10 group-hover:bg-elev">
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()} className="size-9" />
          <div className="min-w-0">
            <Link
              href={`/crew/${member.id}`}
              className={`block truncate text-table-cell font-semibold text-ink hover:text-red rounded-[var(--r)] ${focusRing}`}
            >
              {member.firstName} {member.lastName}
            </Link>
            <div className="flex items-center gap-1.5">
              {member.crewRole?.name ? (
                <span className="truncate text-caption text-muted">
                  {member.crewRole.name}
                </span>
              ) : member.department ? (
                <span className="truncate text-caption text-muted">
                  {member.department}
                </span>
              ) : null}
              {assignmentDays > 0 && (
                <Badge status="neutral" className="px-1.5 py-0.5 font-mono tabular-nums">
                  {assignmentDays}d
                </Badge>
              )}
            </div>
          </div>
        </div>
      </td>
      {days.map((day) => {
        const key = dateToKey(day);
        const data = dayData[key];
        const isToday = isSameDay(day, today);
        const weekend = isWeekend(day);

        return (
          <DayCell
            key={key}
            assignments={data?.assignments || []}
            availability={data?.availability || []}
            isToday={isToday}
            isWeekend={weekend}
            highlightProjectId={highlightProjectId}
          />
        );
      })}
    </tr>
  );
}

// ─── Day Cell ────────────────────────────────────────────────────────────────

function DayCell({
  assignments,
  availability,
  isToday,
  isWeekend: weekend,
  highlightProjectId,
}: {
  assignments: { projectName: string; projectNumber: string; roleName: string | null; projectId: string }[];
  availability: { type: string; reason: string | null }[];
  isToday: boolean;
  isWeekend: boolean;
  highlightProjectId: string | null;
}) {
  // Chip styling via status-colors (§3): assignment = primary (red, live),
  // unavailable = error (t-out), tentative = warn, preferred = ok.
  const hasUnavailable = availability.some((a) => a.type === "UNAVAILABLE");
  const hasTentative = availability.some((a) => a.type === "TENTATIVE");
  const hasPreferred = availability.some((a) => a.type === "PREFERRED");
  const hasAssignment = assignments.length > 0;

  const matchesProjectFilter =
    !!highlightProjectId &&
    assignments.some((a) => a.projectId === highlightProjectId);

  const hasContent = hasAssignment || availability.length > 0;

  const cellClasses = [
    "p-1 text-center align-middle relative h-12",
    isToday ? "bg-red-soft/40" : weekend ? "bg-paper-2/60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!hasContent) {
    return <td className={cellClasses} />;
  }

  // Determine the dominant chip to render. An assignment wins over a soft
  // availability state; unavailable overrides everything (a hard block).
  let chip: { className: string; label: string } | null = null;
  if (hasUnavailable) {
    const c = getStatusColor("availabilityType", "UNAVAILABLE");
    chip = { className: `${c.bg} ${c.text}`, label: "Off" };
  } else if (hasAssignment) {
    const label =
      assignments.length > 1
        ? `${assignments.length}×`
        : assignments[0].projectNumber || "Job";
    // assignment = primary red (§3.7 on-fill: text-white on the --red fill)
    chip = { className: "bg-red text-white", label };
  } else if (hasTentative) {
    const c = getStatusColor("availabilityType", "TENTATIVE");
    chip = { className: `${c.bg} ${c.text}`, label: "Tent." };
  } else if (hasPreferred) {
    const c = getStatusColor("availabilityType", "PREFERRED");
    chip = { className: `${c.bg} ${c.text}`, label: "Pref." };
  }

  const tooltipLines: string[] = [];
  for (const a of assignments) {
    tooltipLines.push(
      `${a.projectNumber} - ${a.projectName}${a.roleName ? ` (${a.roleName})` : ""}`
    );
  }
  for (const av of availability) {
    const typeLabel =
      av.type === "UNAVAILABLE"
        ? "Unavailable"
        : av.type === "TENTATIVE"
          ? "Tentative"
          : "Preferred";
    tooltipLines.push(`${typeLabel}${av.reason ? `: ${av.reason}` : ""}`);
  }

  const dimmed = highlightProjectId && hasAssignment && !matchesProjectFilter;

  return (
    <td className={cellClasses}>
      <Tooltip>
        <TooltipTrigger
          className={`flex h-full w-full items-center justify-center rounded-[8px] ${focusRing} ${
            dimmed ? "opacity-30" : ""
          }`}
        >
          {chip && (
            <span
              className={`inline-flex max-w-full items-center justify-center truncate rounded-[7px] px-1.5 py-1 text-[10px] font-bold leading-none tabular-nums ${
                chip.className
              } ${matchesProjectFilter ? "ring-2 ring-red ring-offset-1 ring-offset-card" : ""}`}
            >
              {chip.label}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-0.5 text-caption">
            {tooltipLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </td>
  );
}
