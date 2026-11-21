"use client";
// An org-wide warehouse view (what's out right now), not personal work.

import Link from "next/link";
import { useNativeHome } from "@/hooks/use-native-dashboard";
import { useStableNow } from "@/hooks/use-stable-now";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusWord } from "@/components/ui/status-word";
import { WidgetCount } from "@/components/dashboard/widget-chrome";
import { floorBackText, sortSoonestBack } from "@/lib/home-rows";
import { jobStatusLabel } from "@/lib/list-views/jobs";
import { getStatusIntent } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";

const LIVE_STATUSES = new Set(["CHECKED_OUT", "ON_SITE"]);

interface LiveJob {
  id: string;
  name: string;
  projectNumber: string;
  status: string;
  rentalEndDate?: string | number | null;
  client?: { name?: string } | null;
  _count?: { lineItems?: number };
}

function LiveJobRow({ job, now }: { job: LiveJob; now: number }) {
  const items = job._count?.lineItems ?? 0;
  const back = floorBackText(job.rentalEndDate ? new Date(job.rentalEndDate).getTime() : null, now);
  const sub = [job.client?.name, `${items} item${items === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  return (
    <Link href={`/projects/${job.id}`} className={cn("group flex min-h-[52px] items-center gap-3 border-t border-line py-2", focusRing)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-ink group-hover:underline">
          {job.name}
          <span className="ml-1.5 font-mono text-[12px] font-medium text-muted">{job.projectNumber}</span>
        </span>
        <span className="block truncate text-[12.5px] text-muted">{sub}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-px">
        {/* The real status word: `Out` for CHECKED_OUT, `On site` for ON_SITE (the live widget said "On site" for both). */}
        <StatusWord status={{ label: jobStatusLabel(job.status), intent: getStatusIntent("project", job.status) }} className="text-[12.5px]" />
        {back && <span className={cn("whitespace-nowrap text-[12.5px]", back.late ? "text-t-out" : "text-muted")}>{back.text}</span>}
      </span>
    </Link>
  );
}

/** On the floor now (§6c.2): rows in two columns, soonest due back first, overdue in red. */
export function OnTheFloorNowWidget({ orgId }: { orgId: string | undefined }) {
  const myHome = useNativeHome(orgId);
  const now = useStableNow();
  if (!myHome) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const projects = (myHome.myProjects ?? []) as unknown as LiveJob[];
  const live = sortSoonestBack(projects.filter((p) => LIVE_STATUSES.has(p.status)));
  if (live.length === 0) {
    return (
      <p className="py-3 text-[13.5px] text-muted">
        <span className="font-semibold text-ink">Nothing out right now.</span> The warehouse is full and calm. Enjoy it.
      </p>
    );
  }
  return (
    <>
      <WidgetCount>{live.length} live</WidgetCount>
      <div className="grid gap-x-8 sm:grid-cols-2 [&>a:first-child]:border-t-0 sm:[&>a:nth-child(2)]:border-t-0">
        {live.slice(0, 4).map((p) => (
          <LiveJobRow key={p.id} job={p} now={now} />
        ))}
      </div>
    </>
  );
}
