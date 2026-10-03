"use client";
// Extracted from dashboard/page.tsx's Zone 1 ("On the floor now") — same
// hooks, same JSX, unchanged logic (R-3.1). An org-wide warehouse view (what's
// out right now), not personal work — see FEATUREDOCS/79's note on why this
// stayed on Dashboard when the personal "My work" zone moved to Today.

import Link from "next/link";
import { useNativeHome } from "@/hooks/use-native-dashboard";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { cn, focusRing } from "@/lib/utils";

const DAY = 24 * 60 * 60 * 1000;
const LIVE_STATUSES = new Set(["CHECKED_OUT", "ON_SITE"]);

function LivePulse() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-ok opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
    </span>
  );
}

function LiveJobRow({ project, now }: { project: Record<string, unknown>; now: Date }) {
  const client = project.client as { name?: string } | null;
  const end = project.rentalEndDate ? new Date(project.rentalEndDate as string) : null;
  const itemCount = (project._count as { lineItems?: number } | undefined)?.lineItems ?? 0;
  let back = "";
  if (end) {
    const days = Math.round((end.getTime() - now.getTime()) / DAY);
    back = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "back today" : `back in ${days}d`;
  }
  const overdue = back.includes("overdue");
  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        "group block rounded-[var(--r)] border border-line bg-elev p-3 shadow-[var(--lit)] transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-card),var(--lit)]",
        focusRing,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[14px] font-semibold text-ink">{project.name as string}</p>
        <span className={`shrink-0 text-[11px] font-medium ${overdue ? "text-t-out" : "text-muted"}`}>{back}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1 text-ok">
          <LivePulse /> On site
        </span>
        <span>·</span>
        <span className="font-mono">{project.projectNumber as string}</span>
        {client?.name ? (
          <>
            <span>·</span>
            <span className="truncate">{client.name}</span>
          </>
        ) : null}
        <span>·</span>
        <span>
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}

export function OnTheFloorNowWidget({ orgId }: { orgId: string | undefined }) {
  const myHome = useNativeHome(orgId);
  const now = new Date();
  const myProjects = (myHome?.myProjects ?? []) as unknown as Record<string, unknown>[];
  const liveJobs = myProjects.filter((p) => LIVE_STATUSES.has(p.status as string));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {liveJobs.length > 0 && <LivePulse />}
          <span className="t-micro text-faint">what&rsquo;s out right now</span>
        </div>
        {liveJobs.length > 0 && <span className="text-[11px] text-muted">{liveJobs.length} live</span>}
      </div>
      {!myHome ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-[var(--r)]" />
          <Skeleton className="h-16 w-full rounded-[var(--r)]" />
        </div>
      ) : liveJobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <FlowMascot className="h-10 w-10" eyeColor="var(--ok)" />
          <p className="text-[14px] font-medium text-ink">Nothing out right now</p>
          <p className="t-micro text-muted">The warehouse is full and calm. Enjoy it.</p>
        </div>
      ) : (
        <StaggerList className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
          {liveJobs.slice(0, 4).map((p) => (
            <StaggerItem key={p.id as string}>
              <LiveJobRow project={p} now={now} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
