"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateLong } from "@/lib/formatters";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { BulkBar } from "@/components/ui/bulk-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanDock } from "@/components/ui/scan-dock";
import { ScanStrip, type ScanStripEntry } from "@/components/ui/scan-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { StageFilter } from "@/components/ui/stage-filter";
import { useNativeWarehouseList } from "@/hooks/use-native-warehouse";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { buildFloorBulkActions, buildFloorJobActions, type FloorDocType } from "@/lib/row-actions/floor-job";
import { useCanDo } from "@/lib/use-permissions";
import { FLOOR_STAGE_LABELS, MODULE_NAMES } from "@/lib/vocabulary";
import {
  FLOOR_SCOPES, inScope, matchesQuery, nextOutText, overdueDays, type FloorJob, type FloorScope,
} from "@/lib/warehouse-floor";
import { FLOOR_STAGE_KEYS } from "../../../../convex/lib/warehouseStage";
import { FloorBoard, FloorPhoneList } from "./floor-board";
import { useFloorScan, type FloorScanEntry } from "./use-floor-scan";
import { useFloorUrl } from "./use-floor-url";
import { useFloorWrites } from "./use-floor-writes";

const SCOPE_LABELS: Record<FloorScope, string> = { today: "Today", week: "This week", mine: "Mine", all: "All" };
/** Until Returning mode lands on this page (build step 4) the old station still serves it. */
const RETURNING_HREF = "/warehouse/returns";
const LOOK_UP_MODES = [{ value: "lookup", label: "Look up" }];

function stripEntry(e: FloorScanEntry, dismiss: (id: string) => void): ScanStripEntry {
  return {
    id: e.id,
    tone: e.tone,
    text: e.text,
    trailing: (
      <>
        {e.openHref ? <Button size="sm" variant="ghost" asChild><Link href={e.openHref}>Open</Link></Button> : null}
        <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => dismiss(e.id)}>✕</Button>
      </>
    ),
  };
}

function useFloorData(now: number) {
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const orgId = activeOrg?.id;
  const { projects, isLoading } = useNativeWarehouseList(orgId);
  const jobs = useMemo(() => projects ?? [], [projects]);
  const userId = session?.user.id;
  const scopeCounts = useMemo(
    () => Object.fromEntries(FLOOR_SCOPES.map((s) => [s, jobs.filter((j) => inScope(j, s, { now, userId })).length])) as Record<FloorScope, number>,
    [jobs, now, userId],
  );
  return { orgId, userId, jobs, isLoading, scopeCounts };
}

function FloorHead({ count, overdue, nextOut, now, onScan, menu, isMobile }: {
  count: number; overdue: number; nextOut: string | null; now: number; onScan: () => void; menu: ActionMenuSpec; isMobile: boolean;
}) {
  const late = overdue ? `${overdue} overdue` : null;
  const sub = isMobile ? [`${count} jobs`, late] : [formatDateLong(new Date(now)), nextOut, late];
  return (
    <header className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-page-title font-extrabold leading-tight tracking-tight text-ink">
          {MODULE_NAMES.floor}{isMobile ? null : <span className="text-muted"> · {count}</span>}
        </h1>
        <p className="text-caption text-muted">{sub.filter(Boolean).join(" · ")}</p>
      </div>
      {isMobile ? null : <Button onClick={onScan}>Scan</Button>}
      <ActionMenu spec={menu} label="Floor actions" />
    </header>
  );
}

function ScopeStrip({ scope, counts, returningCount, onScope }: {
  scope: FloorScope; counts: Record<FloorScope, number>; returningCount: number; onScope: (s: FloorScope) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <StageFilter
        label="Scope"
        options={FLOOR_SCOPES.map((s) => ({ key: s, label: SCOPE_LABELS[s], count: counts[s] }))}
        value={scope}
        onChange={(k) => k && onScope(k as FloorScope)}
      />
      <Link href={RETURNING_HREF} className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-caption font-medium text-ink [@media(pointer:fine)]:min-h-8">
        Returning <span className="font-mono text-muted tabular-nums">{returningCount}</span>
      </Link>
    </div>
  );
}

/** The floor (spec §9c): `/warehouse`. Head, scope strip, the one dock, five derived columns. */
export function FloorPage() {
  const now = useStableNow();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { state, update } = useFloorUrl();
  const { orgId, userId, jobs, isLoading, scopeCounts } = useFloorData(now);
  const canCheckOut = useCanDo("warehouse", "check_out");
  const canCloseOut = useCanDo("warehouse", "close");
  const writes = useFloorWrites(orgId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [ringedId, setRingedId] = useState<string | null>(null);

  const visible = useMemo(
    () => jobs.filter((j) => inScope(j, state.scope, { now, userId }) && matchesQuery(j, state.q)),
    [jobs, state.scope, state.q, now, userId],
  );
  const visibleIds = useMemo(() => visible.map((j) => j.id), [visible]);
  const selection = useRowSelection(visibleIds);

  const onRing = useCallback(
    (jobId: string) => {
      setRingedId(jobId);
      if (!visibleIds.includes(jobId)) update({ scope: "all", q: "" });
    },
    [visibleIds, update],
  );
  const lookup = useFloorScan({ orgId, jobs, onRing });

  useEffect(() => {
    if (ringedId) document.getElementById(`floor-card-${ringedId}`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [ringedId, visible]);

  const menuFor = useCallback(
    (job: FloorJob) =>
      buildFloorJobActions(job, {
        canCheckOut,
        canCloseOut,
        open: (href) => router.push(href),
        openDocument: (type: FloorDocType) => window.open(`/api/documents/${job.id}?type=${type}`, "_blank"),
        setStatus: (target) => writes.setStatus(job.id, target),
        closeOut: () => writes.closeOut([job.id]),
      }),
    [canCheckOut, canCloseOut, router, writes],
  );

  const selectedJobs = visible.filter((j) => selection.isSelected(j.id));
  const bulk = buildFloorBulkActions(selectedJobs, {
    canCloseOut,
    closeOut: async (ids) => { await writes.closeOut(ids); selection.clear(); },
  });

  const overdue = jobs.filter((j) => overdueDays(j, now) > 0).length;
  const returningCount = jobs.reduce((n, j) => n + j.counts.out, 0);
  const pageMenu: ActionMenuSpec = {
    items: [
      { key: "returning", label: "Returning mode", group: "organise", icon: RotateCcw, onSelect: () => router.push(RETURNING_HREF) },
      { key: "all", label: "Show all jobs", group: "organise", icon: ExternalLink, onSelect: () => update({ scope: "all", q: "" }) },
    ],
  };
  const stageCounts = FLOOR_STAGE_KEYS.map((k) => ({ key: k, label: FLOOR_STAGE_LABELS[k], count: visible.filter((j) => j.stage === k).length }));
  const boardProps = {
    jobs: visible, now, ringedId,
    isSelected: selection.isSelected,
    onToggle: (id: string, shift: boolean) => selection.toggle(id, { shift }),
    menuFor,
  };

  return (
    <div className="flex flex-col gap-4">
      <FloorHead count={visible.length} overdue={overdue} nextOut={nextOutText(jobs, now)} now={now} onScan={() => inputRef.current?.focus()} menu={pageMenu} isMobile={isMobile} />
      {isMobile ? (
        <StageFilter
          label="Stage"
          clearable
          options={[{ key: "all", label: "All", count: visible.length }, ...stageCounts]}
          value={state.stage ?? "all"}
          onChange={(k) => update({ stage: !k || k === "all" ? null : (k as FloorJob["stage"]) })}
        />
      ) : (
        <ScopeStrip scope={state.scope} counts={scopeCounts} returningCount={returningCount} onScope={(scope) => update({ scope })} />
      )}
      <div className={isMobile ? "sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-paper px-4 py-2" : "flex flex-col gap-2"}>
        <ScanDock
          onScan={(raw) => void lookup.scan(raw)}
          modes={LOOK_UP_MODES}
          mode="lookup"
          onModeChange={() => {}}
          placeholder="Scan a tag, or type a job, name or client"
          inputRef={inputRef}
          inputId="q"
          onValueChange={(q) => update({ q })}
        />
        <ScanStrip entries={lookup.entries.map((e) => stripEntry(e, lookup.dismiss))} />
      </div>
      {isMobile ? (
        <ScopeStrip scope={state.scope} counts={scopeCounts} returningCount={returningCount} onScope={(scope) => update({ scope })} />
      ) : null}
      <FloorBody isLoading={isLoading} total={jobs.length} visible={visible.length} isMobile={isMobile} onShowAll={() => update({ scope: "all", q: "" })}>
        {isMobile ? <FloorPhoneList {...boardProps} stage={state.stage} /> : <FloorBoard {...boardProps} />}
      </FloorBody>
      {visible.length > 0 ? (
        <p className="text-caption text-muted">{`${visible.length} of ${jobs.length} jobs · ${SCOPE_LABELS[state.scope]}`}</p>
      ) : null}
      <BulkBar selection={selection} actions={bulk} noun="job" />
    </div>
  );
}

function FloorBody({ isLoading, total, visible, isMobile, onShowAll, children }: {
  isLoading: boolean; total: number; visible: number; isMobile: boolean; onShowAll: () => void; children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className={isMobile ? "flex flex-col gap-2" : "grid grid-cols-1 gap-3 md:grid-cols-5"}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-[var(--r)]" />)}
      </div>
    );
  }
  if (total === 0) return <EmptyState title="The floor is clear" description="Jobs land here the moment they're confirmed and ready to prep." />;
  if (visible === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="No job in this view matches."
        action={<Button variant="line" onClick={onShowAll}>Show all</Button>}
      />
    );
  }
  return <>{children}</>;
}
