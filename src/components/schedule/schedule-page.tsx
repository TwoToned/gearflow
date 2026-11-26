"use client";

import * as React from "react";
import Link from "next/link";

import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListHead, ListSegments, type ListPrimary } from "@/components/ui/list-page-parts";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemberRoster } from "@/hooks/use-member-roster";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { localDayKey } from "@/lib/crew-planner";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { jobsWord, phoneDayOf, type ScheduleData, type ScheduleJob, type StripCounts } from "@/lib/schedule";
import { JobsTimeline } from "./jobs-timeline";
import { PhoneSchedule } from "./phone-schedule";
import { DaySheet, JobSheet } from "./schedule-sheets";
import { rangeLabel, ScheduleToolbar } from "./schedule-toolbar";
import { useScheduleActions } from "./use-schedule-actions";
import { useScheduleRead } from "./use-schedule-read";
import { useScheduleUrl, type ScheduleUrl } from "./use-schedule-url";

/**
 * Schedule (UX Phase 18, spec §9o, D81–D84): the Jobs timeline over the org's
 * week or real calendar month, with the clash words the overbooking engine
 * derives, the strip All · Confirmed · Pencilled · Clashes, search and the
 * Status / PM / Category / Model filters (all in the URL), a job sheet and a
 * day sheet. Phone day mode is the agenda (D82). Keyed by the active org, so an
 * org switch drops every open sheet and cached row.
 */
export function SchedulePage() {
  const { data: activeOrg } = useActiveOrganization();
  return <ScheduleInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function ScheduleInner({ orgId }: { orgId: string | undefined }) {
  const today = localDayKey(useStableNow());
  const phone = useIsMobile();
  const url = useScheduleUrl(today, phone);
  const { data: session } = useSession();
  const roster = useMemberRoster(orgId);
  const read = useScheduleRead(orgId, url, roster.options);
  const act = useScheduleActions(url, session?.user.id, read.shown);

  return (
    <div className="space-y-4">
      <ListHead title="Schedule" subline={subline(url, read)} pageMenu={act.pageMenu} primary={act.primary} />
      <Strip url={url} counts={read.counts} />
      <ScheduleToolbar url={url} defs={read.defs} phone={phone} />
      <Body data={read.data} shown={read.shown} url={url} today={today} phone={phone} menuFor={act.menuFor} canCreate={act.canCreate} />
      <Notes truncated={read.data?.truncated ?? false} />
      {phone && <PhonePrimary primary={act.primary} />}
      <Sheets url={url} data={read.data} shown={read.shown} phone={phone} nameOf={roster.nameOf} />
    </div>
  );
}

/** `10 – 16 Nov · 9 jobs · 2 clash`, once the data is in. */
function subline(url: ScheduleUrl, read: ReturnType<typeof useScheduleRead>): string | undefined {
  if (!read.data) return undefined;
  const clashes = read.counts?.clashes ?? 0;
  const clash = clashes > 0 ? ` · ${clashes} clash` : "";
  return `${rangeLabel(url.range)} · ${jobsWord(read.filtered.length)}${clash}`;
}

function Strip({ url, counts }: { url: ScheduleUrl; counts: StripCounts | undefined }) {
  const segments = [
    { key: "all", label: "All", count: counts?.all },
    { key: "confirmed", label: "Confirmed", count: counts?.confirmed },
    { key: "pencilled", label: "Pencilled", count: counts?.pencilled },
    { key: "clashes", label: "Clashes", count: counts?.clashes },
  ];
  return <ListSegments segments={segments} value={url.state.seg} onChange={url.setSeg} />;
}

/** The phone's sticky `+ New job` (the bulk bar will replace it while anything is ticked, with the bulk slice). */
function PhonePrimary({ primary }: { primary: ListPrimary | undefined }) {
  if (!primary) return null;
  return (
    <PinnedAboveBottomNav>
      <Button className="w-full" onClick={primary.onSelect}>
        {primary.label}
      </Button>
    </PinnedAboveBottomNav>
  );
}

function Notes({ truncated }: { truncated: boolean }) {
  return (
    <>
      {truncated && (
        <p className="text-caption text-muted" data-testid="schedule-truncated">
          Part of this schedule could not be read in full: jobs marked not checked may clash, and some finished jobs may be missing.
        </p>
      )}
      <p className="text-caption text-muted">Solid bar holds gear · dashed bar is pencilled and holds nothing</p>
    </>
  );
}

/** The job sheet (always) and the day sheet (desktop; a phone's day is the list itself). */
function Sheets({ url, data, shown, phone, nameOf }: { url: ScheduleUrl; data: ScheduleData | undefined; shown: ScheduleJob[]; phone: boolean; nameOf: Map<string, string> }) {
  const open = data?.jobs.find((j) => j.id === url.view.job) ?? null;
  const pm = open?.projectManagerId ?? null;
  return (
    <>
      <JobSheet job={open} pmName={pm ? nameOf.get(pm) : undefined} onClose={() => url.openJob(null)} />
      {!phone && <DaySheet day={url.view.day} jobs={shown} onOpenJob={url.openJob} onClose={() => url.openDay(null)} />}
    </>
  );
}

interface BodyProps {
  data: ScheduleData | undefined;
  shown: ScheduleJob[];
  url: ScheduleUrl;
  today: string;
  phone: boolean;
  canCreate: boolean;
  menuFor: (j: ScheduleJob) => ActionMenuSpec;
}

function Body({ data, shown, url, today, phone, canCreate, menuFor }: BodyProps) {
  if (!data) return <ScheduleSkeleton />;
  if (shown.length === 0) return <ScheduleEmpty filtered={data.jobs.length > 0} url={url} canCreate={canCreate} />;
  if (phone) {
    const day = phoneDayOf(url.view.day, url.range.days, today);
    return <PhoneSchedule jobs={shown} range={url.range} day={day} onDay={url.openDay} onOpenJob={url.openJob} menuFor={menuFor} />;
  }
  return <JobsTimeline jobs={shown} range={url.range} today={today} onOpenJob={url.openJob} onOpenDay={url.openDay} menuFor={menuFor} />;
}

function ScheduleSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading the schedule">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function ScheduleEmpty({ filtered, url, canCreate }: { filtered: boolean; url: ScheduleUrl; canCreate: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        title="No jobs match that"
        description="Loosen a filter or clear them."
        action={<button type="button" onClick={url.clear} className="text-ui-text text-ink underline">Clear filters</button>}
      />
    );
  }
  return (
    <EmptyState
      title={url.range.zoom === "month" ? "Nothing booked this month" : "Nothing booked this week"}
      description="Step with ‹ › to look elsewhere."
      action={canCreate ? <Link href="/projects/new" className="text-ui-text text-ink underline">New job</Link> : undefined}
    />
  );
}
