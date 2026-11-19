"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { BulkBar } from "@/components/ui/bulk-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanDock } from "@/components/ui/scan-dock";
import { ScanStrip, type ScanStripEntry } from "@/components/ui/scan-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { StageFilter } from "@/components/ui/stage-filter";
import { useScanTarget } from "@/components/scanner/scan-target";
import { useReturningBoard } from "@/hooks/use-returns";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { filterReturning, outcomeTotals, overdueDays, RETURN_OUTCOMES, type ReturnOutcome, type ReturningLine } from "@/lib/returning";
import {
  buildReturningBulkActions, buildReturningGroupActions, buildReturningLineActions, type ReturningCtx, type UnitCtx,
} from "@/lib/row-actions/returning-line";
import { useCanDo } from "@/lib/use-permissions";
import { RETURN_OUTCOME_LABELS } from "@/lib/vocabulary";
import { DEFAULT_SHOW, type FloorUrlState } from "@/lib/warehouse-floor";
import { ReturningView } from "./returning-view";
import { useReceiveScan, type ReceiveEntry } from "./use-receive-scan";
import { useReturningWrites } from "./use-returning-writes";
import { WhichJobDialog } from "./which-job-dialog";

export const FLOOR_DOCK_MODES = [
  { value: "lookup", label: "Look up" },
  { value: "receive", label: "Receive" },
];

function OutcomeMenu({ entry, onOutcome, onRepair, canRepair }: {
  entry: ReceiveEntry;
  onOutcome: (c: "DAMAGED" | "MISSING") => void;
  onRepair: () => void;
  canRepair: boolean;
}) {
  const spec: ActionMenuSpec = {
    items: [
      { key: "damaged", label: "Damaged", group: "edit", onSelect: () => onOutcome("DAMAGED") },
      ...(canRepair ? [{ key: "repair", label: "Damaged · raise repair", group: "organise" as const, onSelect: () => { onOutcome("DAMAGED"); onRepair(); } }] : []),
      {
        key: "missing", label: "Missing", group: "danger", danger: true, onSelect: () => onOutcome("MISSING"),
        confirm: { title: "Mark this unit missing?", body: "It is recorded as lost. Undo is offered right after.", confirmLabel: "Mark missing" },
      },
    ],
  };
  return (
    <ActionMenu
      spec={spec}
      label={`Outcome for ${entry.returned?.tag ?? "item"}`}
      trigger={<Button size="sm" variant="ghost">Outcome ▾</Button>}
    />
  );
}

/**
 * Returning mode (`/warehouse?mode=returning`, spec §9c.4, D26): the returns
 * desk as a mode of the floor. A live board held only while this mode is open,
 * an outcome strip, the dock in `Receive`, the one result strip, rows grouped
 * by job with unit chips, and bulk Return / Damaged / Raise repair / Missing.
 */
export function ReturningMode({ orgId, now, isMobile, state, update }: {
  orgId: string | undefined;
  now: number;
  isMobile: boolean;
  state: FloorUrlState;
  update: (patch: Partial<FloorUrlState>) => void;
}) {
  const router = useRouter();
  const { data, isLoading } = useReturningBoard(orgId, true);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const canReturn = useCanDo("warehouse", "check_in");
  const canRepair = useCanDo("maintenance", "create");
  const writes = useReturningWrites(orgId, groups);
  const receive = useReceiveScan(orgId);
  const [expanded, setExpanded] = useState<string | null>(null);

  // The phone's raised Scan sends its decoded value here while this mode is open (6a ScanTarget).
  useScanTarget((value) => void receive.scan(value));

  const visible = useMemo(() => filterReturning(groups, { outcome: state.outcome, job: state.job, now }), [groups, state.outcome, state.job, now]);
  const lines = useMemo(() => visible.flatMap((g) => g.lines), [visible]);
  const ids = useMemo(() => lines.map((l) => l.lineItemId), [lines]);
  const selection = useRowSelection(ids);
  const totals = useMemo(() => outcomeTotals(groups, now), [groups, now]);

  const ctx: ReturningCtx = {
    canReturn,
    canRepair,
    returnLines: async (ls, c) => { await writes.returnLines(ls, c); selection.clear(); },
    raiseRepair: writes.raiseRepair,
    toggleUnits: (l) => setExpanded((cur) => (cur === l.lineItemId ? null : l.lineItemId)),
    openJob: (id) => router.push(`/warehouse/${id}`),
  };
  const unitCtx = useCallback(
    (line: ReturningLine): UnitCtx => ({
      canReturn,
      canRepair,
      returnUnit: (u, c) => writes.returnUnit(line, u, c),
      correct: (u, c) => writes.correct(line, u, c),
      raiseRepair: (u) => writes.raiseUnitRepair(line, u),
    }),
    [canReturn, canRepair, writes],
  );

  const stripEntries: ScanStripEntry[] = receive.entries.map((e) => ({
    id: e.id,
    tone: e.tone,
    text: e.text,
    undo: e.undo,
    trailing: (
      <>
        {e.returned && e.undo ? (
          <OutcomeMenu entry={e} canRepair={canRepair} onOutcome={(c) => void receive.setOutcome(e.returned!, c)} onRepair={() => void receive.raiseRepair(e.returned!)} />
        ) : null}
        <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => receive.dismiss(e.id)}>✕</Button>
      </>
    ),
  }));

  const overdue = groups.filter((g) => overdueDays(g, now) > 0).length;
  const pageMenu: ActionMenuSpec = {
    items: [
      { key: "floor", label: "Back to the floor", group: "organise", icon: LayoutGrid, onSelect: () => update({ mode: "floor" }) },
      ...(state.outcome || state.job
        ? [{ key: "clear", label: "Show everything coming back", group: "organise" as const, icon: ListFilter, onSelect: () => update({ outcome: null, job: null }) }]
        : []),
    ],
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-page-title font-extrabold leading-tight tracking-tight text-ink">
            Returning <span className="text-muted">· {totals.out} out</span>
          </h1>
          <p className="text-caption text-muted">{[`${groups.length} jobs`, overdue ? `${overdue} overdue` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <ActionMenu spec={pageMenu} label="Returning actions" />
      </header>
      <StageFilter
        label="Outcome"
        clearable
        options={RETURN_OUTCOMES.map((k) => ({ key: k, label: RETURN_OUTCOME_LABELS[k], count: totals[k] }))}
        value={state.outcome}
        onChange={(k) => update({ outcome: (k as ReturnOutcome) || null })}
      />
      <div className={isMobile ? "sticky top-0 z-20 -mx-4 flex flex-col gap-2 bg-paper px-4 py-2" : "flex flex-col gap-2"}>
        <ScanDock
          onScan={(raw) => void receive.scan(raw)}
          modes={FLOOR_DOCK_MODES}
          mode="receive"
          onModeChange={(m) => m === "lookup" && update({ mode: "floor" })}
          placeholder="Scan what came back"
          cameraTitle="Receive with camera"
          inputId="q"
        />
        <ScanStrip entries={stripEntries} />
      </div>
      {data?.truncated ? <p className="text-caption text-warn">Showing the first jobs and lines only; narrow by outcome or job to see the rest.</p> : null}
      <ReturningBody isLoading={isLoading} total={groups.length} visible={visible.length} onClear={() => update({ outcome: null, job: null })}>
        <ReturningView
          orgId={orgId}
          groups={visible}
          now={now}
          isMobile={isMobile}
          show={state.show}
          onShowMore={() => update({ show: state.show + DEFAULT_SHOW })}
          isSelected={selection.isSelected}
          onToggle={(id, shift) => selection.toggle(id, { shift })}
          lineMenu={(l) => buildReturningLineActions(l, ctx)}
          groupMenu={(g) => buildReturningGroupActions(g, ctx)}
          expanded={expanded}
          unitCtx={unitCtx}
        />
      </ReturningBody>
      <BulkBar selection={selection} actions={buildReturningBulkActions(lines.filter((l) => selection.isSelected(l.lineItemId)), ctx)} noun="line" />
      <WhichJobDialog state={receive.whichJob} onClose={receive.closeWhichJob} onReturn={receive.write} />
    </div>
  );
}

function ReturningBody({ isLoading, total, visible, onClear, children }: {
  isLoading: boolean; total: number; visible: number; onClear: () => void; children: React.ReactNode;
}) {
  if (isLoading) return <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--r)]" />)}</div>;
  if (total === 0) return <EmptyState title="Nothing out" description="Every job's gear is home." />;
  if (visible === 0) {
    return <EmptyState title="Nothing here" description="No line matches this outcome." action={<Button variant="line" onClick={onClear}>Show all</Button>} />;
  }
  return <>{children}</>;
}
