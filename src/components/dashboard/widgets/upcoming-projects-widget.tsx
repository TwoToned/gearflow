"use client";

import Link from "next/link";
import { useNativeUpcoming } from "@/hooks/use-native-dashboard";
import { useFormatters } from "@/components/providers/format-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusWord } from "@/components/ui/status-word";
import { ProjectLockGlyph } from "@/components/projects/project-lock-glyph";
import { WidgetCount } from "@/components/dashboard/widget-chrome";
import { jobStatusLabel } from "@/lib/list-views/jobs";
import { getStatusIntent } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import { HOME_UPCOMING_LIMIT } from "../../../../convex/lib/jobStatusGroups";

interface UpcomingJob {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  rentalStartDate?: string | number | null;
  rentalEndDate?: string | number | null;
  client?: { name?: string } | null;
}

function UpcomingRow({ job }: { job: UpcomingJob }) {
  const { formatDateDayMonth } = useFormatters();
  const start = job.rentalStartDate ? formatDateDayMonth(new Date(job.rentalStartDate)) : null;
  const end = job.rentalEndDate ? formatDateDayMonth(new Date(job.rentalEndDate)) : null;
  const range = start && end && end !== start ? `${start} – ${end}` : start;
  return (
    <Link href={`/projects/${job.id}`} className={cn("group flex min-h-[52px] items-center gap-3 border-t border-line py-2", focusRing)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-ink group-hover:underline">
          {job.name}
          <span className="ml-1.5 font-mono text-[12px] font-medium text-muted">{job.projectNumber}</span>
        </span>
        {job.client?.name && <span className="block truncate text-[12.5px] text-muted">{job.client.name}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-px">
        <span className="inline-flex items-center gap-1.5">
          <StatusWord status={{ label: jobStatusLabel(job.status), intent: getStatusIntent("project", job.status) }} className="text-[12.5px]" />
          <ProjectLockGlyph status={job.status} />
        </span>
        {range && <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">{range}</span>}
      </span>
    </Link>
  );
}

/** Upcoming (§6c.2): rows with a dot-word status, the lock glyph and a mono date range. */
export function UpcomingProjectsWidget({ orgId }: { orgId: string | undefined }) {
  const upcoming = useNativeUpcoming(orgId) as UpcomingJob[] | undefined;
  if (!upcoming) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (upcoming.length === 0) {
    return (
      <p className="py-3 text-[13.5px] text-muted">
        <span className="font-semibold text-ink">Nothing booked ahead.</span> Quote something.
      </p>
    );
  }
  return (
    <>
      {/* The read returns one past HOME_UPCOMING_LIMIT: `8+` only when there really are more than 8. */}
      <WidgetCount>{upcoming.length > HOME_UPCOMING_LIMIT ? `${HOME_UPCOMING_LIMIT}+` : upcoming.length}</WidgetCount>
      <div className="grid gap-x-8 sm:grid-cols-2 [&>a:first-child]:border-t-0 sm:[&>a:nth-child(2)]:border-t-0">
        {upcoming.slice(0, 4).map((p) => (
          <UpcomingRow key={p.id} job={p} />
        ))}
      </div>
    </>
  );
}
