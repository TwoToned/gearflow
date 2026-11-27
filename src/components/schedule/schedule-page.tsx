"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";
import { DateMoveImpactDialog } from "@/components/projects/date-move-impact-dialog";
import { BulkBar, PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListHead, ListSegments, type HeadWords, type ListPrimary } from "@/components/ui/list-page-parts";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemberRoster } from "@/hooks/use-member-roster";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { keyOfMs, localDayKey } from "@/lib/crew-planner";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { jobsWord, phoneDayOf, scheduleCsv, type ScheduleJob } from "@/lib/schedule";
import { cellAt, gearCsv } from "@/lib/schedule-gear";
import { parseCell } from "@/lib/schedule-url";
import { projectStatusLabels } from "@/lib/status-labels";
import { useCanDo } from "@/lib/use-permissions";
import { GearGrid } from "./gear-grid";
import { ModelDaySheet } from "./gear-sheet";
import { MoveDatesDialog } from "./move-dates-dialog";
import { JobsTimeline, type JobSelection } from "./jobs-timeline";
import { PhoneGear } from "./phone-gear";
import { PhoneSchedule } from "./phone-schedule";
import { DaySheet, JobSheet } from "./schedule-sheets";
import { rangeLabel, ScheduleToolbar } from "./schedule-toolbar";
import { useScheduleActions } from "./use-schedule-actions";
import { useScheduleBulk } from "./use-schedule-bulk";
import { useScheduleRead } from "./use-schedule-read";
import { useScheduleUrl, type ScheduleUrl } from "./use-schedule-url";

/**
 * Schedule (UX Phase 18, spec §9o, D81-D84): two views as head words, `Jobs  Gear`.
 * Jobs is the timeline over the org's week or real calendar month with the clash
 * words the overbooking engine derives; Gear is the free count per model per day.
 * Both share the strip, search, the Status / PM / Category / Model filters (all
 * in the URL) and the sheets. Phone day mode is the agenda (D82). Keyed by the
 * active org, so an org switch drops every open sheet and cached row.
 */
export function SchedulePage() {
  const { data: activeOrg } = useActiveOrganization();
  return <ScheduleInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

type Read = ReturnType<typeof useScheduleRead>;
type Bulk = ReturnType<typeof useScheduleBulk>;

/** The two view words, each a link that keeps the range and filters and drops the strip and open sheets. */
function useHeadWords(url: ScheduleUrl): HeadWords {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (view: "jobs" | "gear") => {
    const p = new URLSearchParams(params.toString());
    for (const k of ["seg", "day", "job", "cell", "view"]) p.delete(k);
    if (view === "gear") p.set("view", "gear");
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return { value: url.mode, words: [{ key: "jobs", label: "Jobs", href: href("jobs") }, { key: "gear", label: "Gear", href: href("gear") }] };
}

function ScheduleInner({ orgId }: { orgId: string | undefined }) {
  const today = localDayKey(useStableNow());
  const phone = useIsMobile();
  const url = useScheduleUrl(today, phone);
  const { data: session } = useSession();
  const roster = useMemberRoster(orgId);
  const read = useScheduleRead(orgId, url, roster.options);
  const headWords = useHeadWords(url);
  const exportCsv = () => (url.mode === "gear" && read.gear.data ? gearCsv(read.gear.data, read.gear.shown) : scheduleCsv(read.jobs.shown, (s) => projectStatusLabels[s] ?? s));
  const bulk = useScheduleBulk(orgId, read.jobs.shown);
  const act = useScheduleActions(url, session?.user.id, exportCsv, bulk.verbs);

  return (
    <div className="space-y-4">
      <ListHead title="Schedule" headWords={headWords} subline={subline(url, read)} pageMenu={act.pageMenu} primary={act.primary} />
      <Strip url={url} read={read} />
      <ScheduleToolbar url={url} defs={read.defs} phone={phone} />
      {url.mode === "gear" ? (
        <GearBody read={read} url={url} today={today} phone={phone} />
      ) : (
        <JobsBody read={read} url={url} today={today} phone={phone} menuFor={act.menuFor} canCreate={act.canCreate} selection={bulk.selection} />
      )}
      <Notes truncated={read.truncated} mode={url.mode} />
      {url.mode === "jobs" && <BulkBar selection={{ count: bulk.ticked.length, clear: bulk.clear }} actions={bulk.actions} noun="job" />}
      {phone && url.mode === "jobs" && bulk.ticked.length === 0 && <PhonePrimary primary={act.primary} />}
      <Sheets url={url} read={read} phone={phone} nameOf={roster.nameOf} bulk={bulk} />
      <GateDialogs bulk={bulk} />
    </div>
  );
}

/** `10 – 16 Nov · 9 jobs · 2 clash` or `10 – 16 Nov · 16 models · 1 short`, once the data is in. */
function subline(url: ScheduleUrl, read: Read): string | undefined {
  if (url.mode === "gear") {
    if (!read.gear.data) return undefined;
    const short = read.gear.counts?.short ?? 0;
    return `${rangeLabel(url.range)} · ${read.gear.filtered.length} models${short > 0 ? ` · ${short} short` : ""}`;
  }
  if (!read.jobs.data) return undefined;
  const clashes = read.jobs.counts?.clashes ?? 0;
  return `${rangeLabel(url.range)} · ${jobsWord(read.jobs.filtered.length)}${clashes > 0 ? ` · ${clashes} clash` : ""}`;
}

function Strip({ url, read }: { url: ScheduleUrl; read: Read }) {
  const j = read.jobs.counts;
  const g = read.gear.counts;
  const segments =
    url.mode === "gear"
      ? [
          { key: "all", label: "All", count: g?.all },
          { key: "short", label: "Short", count: g?.short },
          { key: "atrisk", label: "At risk", count: g?.atRisk },
        ]
      : [
          { key: "all", label: "All", count: j?.all },
          { key: "confirmed", label: "Confirmed", count: j?.confirmed },
          { key: "pencilled", label: "Pencilled", count: j?.pencilled },
          { key: "clashes", label: "Clashes", count: j?.clashes },
        ];
  return <ListSegments segments={segments} value={url.filters.seg} onChange={url.setSeg} />;
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

function Notes({ truncated, mode }: { truncated: boolean; mode: "jobs" | "gear" }) {
  return (
    <>
      {truncated && (
        <p className="text-caption text-muted" data-testid="schedule-truncated">
          Part of this schedule could not be read in full: {mode === "gear" ? "a cell marked not checked has no number" : "jobs marked not checked may clash"}, and some finished jobs may be missing.
        </p>
      )}
      <p className="text-caption text-muted">
        {mode === "gear"
          ? "Free = serviceable stock minus what held jobs take · amber is what pencilled jobs would take if confirmed"
          : "Solid bar holds gear · dashed bar is pencilled and holds nothing"}
      </p>
    </>
  );
}

/** The job sheet (both views: a Gear cell's `Held by` row opens it), the day sheet (Jobs, desktop) and the model-day sheet (Gear). */
function Sheets({ url, read, phone, nameOf, bulk }: { url: ScheduleUrl; read: Read; phone: boolean; nameOf: Map<string, string>; bulk: Bulk }) {
  const canSubHire = useCanDo("subHire", "create");
  const canModel = useCanDo("model", "read");
  const open = read.jobs.data?.jobs.find((j) => j.id === url.view.job) ?? null;
  const pm = open?.projectManagerId ?? null;
  const cell = parseCell(url.view.cell);
  const opened = cell && read.gear.data ? cellAt(read.gear.data, cell.modelId, cell.day) : null;
  return (
    <>
      <JobSheet job={open} pmName={pm ? nameOf.get(pm) : undefined} onClose={() => url.openJob(null)} verbs={open ? bulk.sheetVerbsFor(open) : undefined} />
      {!phone && url.mode === "jobs" && <DaySheet day={url.view.day} jobs={read.jobs.shown} onOpenJob={url.openJob} onClose={() => url.openDay(null)} />}
      <ModelDaySheet opened={opened} onOpenJob={url.openJob} onClose={() => url.openCell(null)} canSubHire={canSubHire} canModel={canModel} />
    </>
  );
}

interface BodyProps {
  read: Read;
  url: ScheduleUrl;
  today: string;
  phone: boolean;
}

function JobsBody({ read, url, today, phone, menuFor, canCreate, selection }: BodyProps & { menuFor: (j: ScheduleJob) => ActionMenuSpec; canCreate: boolean; selection: JobSelection }) {
  const { data, shown } = read.jobs;
  if (!data) return <ScheduleSkeleton />;
  if (shown.length === 0) return <ScheduleEmpty filtered={data.jobs.length > 0} url={url} canCreate={canCreate} />;
  if (phone) {
    const day = phoneDayOf(url.view.day, url.range.days, today);
    return <PhoneSchedule jobs={shown} range={url.range} day={day} onDay={url.openDay} onOpenJob={url.openJob} menuFor={menuFor} selection={selection} />;
  }
  return <JobsTimeline jobs={shown} range={url.range} today={today} onOpenJob={url.openJob} onOpenDay={url.openDay} menuFor={menuFor} selection={selection} />;
}

function GearBody({ read, url, today, phone }: BodyProps) {
  const { data, shown } = read.gear;
  if (!data) return <ScheduleSkeleton />;
  if (shown.length === 0) return <GearEmpty filtered={data.rows.length > 0} url={url} cut={read.truncated} />;
  const open = (modelId: string, day: string) => url.openCell(`${modelId}:${day}`);
  if (phone) {
    const keys = data.dayStarts.map(keyOfMs);
    return <PhoneGear data={data} rows={shown} day={phoneDayOf(url.view.day, keys, today)} onDay={url.openDay} onOpenCell={open} />;
  }
  return <GearGrid data={data} rows={shown} range={url.range} today={today} categoryName={read.categoryName} onOpenCell={open} />;
}

/** The two existing heads-up dialogs (confirm-impact and date-move-impact) and the Move dates dialog, each hosted once. */
function GateDialogs({ bulk }: { bulk: Bulk }) {
  const w = bulk.writes;
  return (
    <>
      <ConfirmStatusImpactDialog open={!!w.confirmGate.pending} impact={w.confirmGate.pending?.impact ?? null} pending={false} onConfirm={w.confirmGate.confirmPending} onCancel={w.cancelConfirm} />
      <DateMoveImpactDialog open={!!w.moveGate.pending} rows={w.moveGate.pending?.rows ?? []} pending={false} onConfirm={w.moveGate.confirmPending} onCancel={w.cancelMove} />
      <MoveDatesDialog jobs={bulk.moveJobs} onClose={bulk.closeMove} onMove={(jobs, days) => void bulk.move(jobs, days)} />
    </>
  );
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

function GearEmpty({ filtered, url, cut }: { filtered: boolean; url: ScheduleUrl; cut: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        title="No models match that"
        description="Loosen a filter or clear them."
        action={<button type="button" onClick={url.clear} className="text-ui-text text-ink underline">Clear filters</button>}
      />
    );
  }
  // A cut read can hide bookings: an empty grid then says it could not check, never "nothing is booked".
  if (cut) return <EmptyState title="Couldn't check this range in full" description="Part of the read was cut, so an empty grid does not mean nothing is booked." />;
  return <EmptyState title="No gear is booked in this range" description="Models appear here once a job holds or pencils them." />;
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
