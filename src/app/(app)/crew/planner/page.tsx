"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  ChevronLeft,
  ChevronRight,
  CalendarRange,
} from "lucide-react";

import { getCrewPlannerData } from "@/server/crew-availability";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCrewAssignments, fingerprintCrewAssignments } from "@/hooks/use-crew-scheduling";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageMeta } from "@/components/layout/page-meta";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

  const { data: members, isLoading, refetch } = useServerQuery({
    queryKey: ["crew-planner", orgId, startDate, endDate],
    queryFn: () => getCrewPlannerData(startDate, endDate),
  });

  // Cross-tab live sync: subscribe to the dual-written Convex crewAssignments
  // table; a fingerprint change (crew booked/moved/confirmed in another tab)
  // re-fetches the planner. NOTE: availability-block edits aren't in this signal
  // (crewAvailabilities has no org index) — those refresh on navigation.
  const assignmentDocs = useOrgCrewAssignments(orgId);
  const assignmentFp = fingerprintCrewAssignments(assignmentDocs);
  const prevAssignmentFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (assignmentFp !== undefined && prevAssignmentFp.current !== undefined && assignmentFp !== prevAssignmentFp.current) {
      refetch();
    }
    if (assignmentFp !== undefined) prevAssignmentFp.current = assignmentFp;
  }, [assignmentFp, refetch]);

  const goBack = () => setWeekStart((d) => addDays(d, -7));
  const goForward = () => setWeekStart((d) => addDays(d, 7));
  const goToday = () => setWeekStart(startOfWeek(new Date()));

  const today = new Date();

  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Crew Planner" />
      <FadeIn>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="t-title text-fg">Crew Planner</h1>
            <p className="text-fg-3">
              Overview of crew assignments and availability.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goBack}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={goForward}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-fg-3 ml-2">
              {formatDateShort(days[0])} &ndash; {formatDateShort(days[days.length - 1])}
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-bg-surface surface-ring overflow-x-auto">
          <TooltipProvider>
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left text-xs font-medium text-fg-3 p-2 w-48 sticky left-0 bg-bg-surface z-10">
                    Crew Member
                  </th>
                  {days.map((day) => (
                    <th
                      key={dateToKey(day)}
                      className={`text-center text-xs font-medium p-1 min-w-[60px] ${
                        isSameDay(day, today)
                          ? "bg-primary/10 text-primary"
                          : isWeekend(day)
                            ? "text-fg-3/60 bg-bg-inset/30"
                            : "text-fg-3"
                      }`}
                    >
                      <div>{formatDayOfWeek(day)}</div>
                      <div className="font-normal">{day.getDate()}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={DAYS_TO_SHOW + 1}
                      className="text-center text-fg-3 py-12"
                    >
                      Loading...
                    </td>
                  </tr>
                ) : !members || members.length === 0 ? (
                  <tr>
                    <td
                      colSpan={DAYS_TO_SHOW + 1}
                      className="text-center text-fg-3 py-12"
                    >
                      <CalendarRange className="mx-auto h-8 w-8 mb-2 opacity-50" />
                      <p>No active crew members found.</p>
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

        <div className="flex flex-wrap gap-4 text-xs text-fg-3">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-primary/70" />
            Assignment
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-red-500/70" />
            Unavailable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-500/70" />
            Tentative
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-green-500/70" />
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
    <tr className="border-b hover:bg-bg-elevated/20">
      <td className="p-2 sticky left-0 bg-bg-surface z-10">
        <Link
          href={`/crew/${member.id}`}
          className="text-sm font-medium hover:underline block"
        >
          {member.firstName} {member.lastName}
        </Link>
        {member.crewRole && (
          <span className="text-xs text-fg-3">
            {member.crewRole.name}
          </span>
        )}
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
  // Determine background color
  let bgClass = "";
  let dotColor = "";

  const hasUnavailable = availability.some((a) => a.type === "UNAVAILABLE");
  const hasTentative = availability.some((a) => a.type === "TENTATIVE");
  const hasPreferred = availability.some((a) => a.type === "PREFERRED");

  if (hasUnavailable) {
    bgClass = "bg-red-500/15";
    dotColor = "bg-red-500";
  } else if (assignments.length > 0) {
    bgClass = "bg-primary/15";
    dotColor = "bg-primary";
  } else if (hasTentative) {
    bgClass = "bg-amber-500/15";
    dotColor = "bg-amber-500";
  } else if (hasPreferred) {
    bgClass = "bg-green-500/15";
    dotColor = "bg-green-500";
  }

  const hasContent = assignments.length > 0 || availability.length > 0;

  const cellClasses = [
    "p-1 text-center relative h-10",
    isToday ? "bg-primary/5" : weekend ? "bg-bg-inset/30" : "",
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
        <TooltipTrigger className="w-full h-full flex items-center justify-center">
          {dotColor && (
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
          )}
          {assignments.length > 1 && (
            <Badge
              variant="secondary"
              className="absolute top-0 right-0 text-[9px] h-3.5 min-w-[14px] px-0.5"
            >
              {assignments.length}
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-0.5 text-xs">
            {tooltipLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </td>
  );
}
