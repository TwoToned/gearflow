"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { getCrewPlannerData } from "@/server/crew-availability";
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

// ─── Component ───────────────────────────────────────────────────────────────

const DAYS_TO_SHOW = 14;

export default function CrewPlannerPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

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
    queryFn: () => getCrewPlannerData(startDate, endDate),
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

  const today = new Date();

  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Crew planner" />
      <FadeIn>
      <div className="space-y-4">
        <PageHeader
          title="Crew planner"
          description="Overview of crew assignments and availability."
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
              <span className="text-caption tabular-nums text-muted ml-2">
                {formatDateShort(days[0])} &ndash; {formatDateShort(days[days.length - 1])}
              </span>
            </div>
          }
        />

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
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left text-caption font-medium text-muted p-2 w-48 sticky left-0 bg-card z-10">
                    Crew member
                  </th>
                  {days.map((day) => (
                    <th
                      key={dateToKey(day)}
                      className={`text-center text-caption font-medium p-1 min-w-[60px] ${
                        isSameDay(day, today)
                          ? "bg-red-soft text-red"
                          : isWeekend(day)
                            ? "text-faint bg-paper-2"
                            : "text-muted"
                      }`}
                    >
                      <div>{formatDayOfWeek(day)}</div>
                      <div className="font-normal tabular-nums">{day.getDate()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="p-2 sticky left-0 bg-card z-10">
                        <div className="flex items-center gap-2">
                          <Skeleton className="size-8 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      </td>
                      {days.map((day) => (
                        <td key={dateToKey(day)} className="p-1 h-10">
                          <Skeleton className="mx-auto h-2.5 w-2.5 rounded-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : !members || members.length === 0 ? (
                  <tr>
                    <td colSpan={DAYS_TO_SHOW + 1} className="p-6">
                      <EmptyState
                        title="No active crew members found"
                        description="Add crew to your roster to start planning assignments."
                      />
                    </td>
                  </tr>
                ) : (
                  (members as CrewMemberData[]).map((member) => (
                    <PlannerRow
                      key={member.id}
                      member={member}
                      days={days}
                      today={today}
                    />
                  ))
                )}
              </tbody>
            </table>
          </TooltipProvider>
        </div>

        <div className="flex flex-wrap gap-4 text-caption text-muted">
          <span className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[4px] ${getStatusColor("assignment", "ACCEPTED").dot}`} />
            Assignment
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[4px] ${getStatusColor("availabilityType", "UNAVAILABLE").dot}`} />
            Unavailable
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[4px] ${getStatusColor("availabilityType", "TENTATIVE").dot}`} />
            Tentative
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[4px] ${getStatusColor("availabilityType", "PREFERRED").dot}`} />
            Preferred
          </span>
        </div>
      </div>
      </FadeIn>
    </RequirePermission>
  );
}

// ─── Planner Row ─────────────────────────────────────────────────────────────

function PlannerRow({
  member,
  days,
  today,
}: {
  member: CrewMemberData;
  days: Date[];
  today: Date;
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

  return (
    <tr className="border-b border-line hover:bg-elev">
      <td className="p-2 sticky left-0 bg-card z-10">
        <div className="flex items-center gap-2">
          <PersonAvatar name={`${member.firstName ?? ""} ${member.lastName ?? ""}`.trim()} className="size-8" />
          <div className="min-w-0">
            <Link
              href={`/crew/${member.id}`}
              className={`block truncate text-table-cell font-medium text-ink hover:text-red rounded-[var(--r)] ${focusRing}`}
            >
              {member.firstName} {member.lastName}
            </Link>
            {member.crewRole && (
              <span className="text-caption text-muted">
                {member.crewRole.name}
              </span>
            )}
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
}: {
  assignments: { projectName: string; projectNumber: string; roleName: string | null; projectId: string }[];
  availability: { type: string; reason: string | null }[];
  isToday: boolean;
  isWeekend: boolean;
}) {
  // Background + dot colour via status-colors (§3): assignment = primary (red,
  // live), unavailable = error (t-out), tentative = warn, preferred = ok.
  let bgClass = "";
  let dotColor = "";

  const hasUnavailable = availability.some((a) => a.type === "UNAVAILABLE");
  const hasTentative = availability.some((a) => a.type === "TENTATIVE");
  const hasPreferred = availability.some((a) => a.type === "PREFERRED");

  if (hasUnavailable) {
    bgClass = getStatusColor("availabilityType", "UNAVAILABLE").bg;
    dotColor = getStatusColor("availabilityType", "UNAVAILABLE").dot;
  } else if (assignments.length > 0) {
    bgClass = getStatusColor("assignment", "ACCEPTED").bg;
    dotColor = getStatusColor("assignment", "ACCEPTED").dot;
  } else if (hasTentative) {
    bgClass = getStatusColor("availabilityType", "TENTATIVE").bg;
    dotColor = getStatusColor("availabilityType", "TENTATIVE").dot;
  } else if (hasPreferred) {
    bgClass = getStatusColor("availabilityType", "PREFERRED").bg;
    dotColor = getStatusColor("availabilityType", "PREFERRED").dot;
  }

  const hasContent = assignments.length > 0 || availability.length > 0;

  const cellClasses = [
    "p-1 text-center relative h-10",
    isToday ? "bg-red-soft" : weekend ? "bg-paper-2" : "",
    bgClass,
  ]
    .filter(Boolean)
    .join(" ");

  if (!hasContent) {
    return <td className={cellClasses} />;
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

  return (
    <td className={cellClasses}>
      <Tooltip>
        <TooltipTrigger className={`w-full h-full flex items-center justify-center rounded-[var(--r)] ${focusRing}`}>
          {dotColor && (
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
          )}
          {assignments.length > 1 && (
            <Badge
              status="neutral"
              className="absolute top-0 right-0 px-1 py-0"
            >
              {assignments.length}
            </Badge>
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
