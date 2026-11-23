"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCanDo } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { MoneyBridgeBar } from "@/components/projects/compare/compare-bridge";
import {
  buildCompareGroups,
  compareQueryArgs,
  resolveSideArg,
  shortLabel,
  sideDisplayLabel,
  type CompareData,
  type CompareRow,
} from "@/components/projects/compare/compare-model";
import { CompareRowsTable } from "@/components/projects/compare/compare-rows";
import { useCompareStepper } from "@/components/projects/compare/use-compare-stepper";
import type { CompareModeState, ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * Compare (UX Phase 8, D20): a READ-ONLY right sheet (a 92% bottom sheet on a
 * phone) over the job page instead of a page mode that hid every tab. It
 * renders `versionsRead.compareVersions` as it is: the server aligns rows,
 * builds the money bridge and reports plan-field changes; nothing here diffs
 * again (R-3.1). Kept from the page mode: both side pickers (the second may be
 * a sent quote's snapshot, which has totals only), the money bridge with its
 * jump, the change stepper (`n`/`p`), All/Only-changes, and `Make vN live`
 * (which hands off to the ONE Make-live dialog).
 *
 * The sheet is the one scroll container (D46); the header row, bridge and
 * controls scroll with it rather than adding a second scroller.
 */

export interface CompareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  compare: CompareModeState;
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  onChangeCompare: (next: CompareModeState) => void;
  onMakeLive: (versionNumber: number) => void;
}

export function CompareSheet(props: CompareSheetProps) {
  const isMobile = useIsMobile();
  const { open, onOpenChange } = props;
  // `key` remounts the body when either side changes, so the stepper index and
  // the All/Changes default reset with the pair instead of via an effect.
  const body = <CompareSheetBody key={JSON.stringify(props.compare)} {...props} />;

  if (isMobile) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Compare versions" className="max-h-[92dvh] gap-3 p-4">
        <div data-compare-sheet className="contents">
          {body}
        </div>
      </BottomSheet>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-compare-sheet className="w-full max-w-3xl sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Compare versions</SheetTitle>
          <SheetDescription>Read-only. Nothing here changes the job.</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function VersionPicker({
  value,
  versions,
  liveVersion,
  onChange,
  label,
  otherSide,
}: {
  value: { kind: "version"; number: number | null };
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  onChange: (next: { kind: "version"; number: number | null }) => void;
  label: string;
  /** The OTHER picker's side: a version cannot be compared with itself, so it is not offered here. */
  otherSide: CompareModeState["a"];
}) {
  const selectValue = value.number == null ? "live" : String(value.number);
  const taken = otherSide.kind === "version" ? (otherSide.number == null ? "live" : String(otherSide.number)) : undefined;
  return (
    <Select value={selectValue} onValueChange={(v) => onChange({ kind: "version", number: v === "live" ? null : Number(v) })}>
      <SelectTrigger aria-label={label} className="h-8 w-auto gap-1 border-line-2 bg-paper-2 px-2 text-caption">
        <SelectValue>{sideDisplayLabel(value, versions, liveVersion)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {liveVersion && taken !== "live" && <SelectItem value="live">v{liveVersion.number} · Live</SelectItem>}
        {versions
          .filter((v) => !v.isLive && String(v.number) !== taken)
          .map((v) => (
            <SelectItem key={v.id} value={String(v.number)}>
              v{v.number}
              {v.label ? ` · ${v.label}` : ""}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function SidePickers({ data, compare, versions, liveVersion, onChangeCompare }: Pick<CompareSheetProps, "compare" | "versions" | "liveVersion" | "onChangeCompare"> & { data: CompareData }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-table-cell">
      {compare.a.kind === "version" ? (
        <VersionPicker label="Compare from" otherSide={compare.b} value={compare.a} versions={versions} liveVersion={liveVersion} onChange={(next) => onChangeCompare({ a: next, b: compare.b })} />
      ) : (
        <span className="font-semibold">{data.a.label}</span>
      )}
      <span aria-hidden className="text-muted">{"→"}</span>
      {compare.b.kind === "version" ? (
        <VersionPicker label="Compare to" otherSide={compare.a} value={compare.b} versions={versions} liveVersion={liveVersion} onChange={(next) => onChangeCompare({ a: compare.a, b: next })} />
      ) : (
        <span className="font-semibold">{data.b.label}</span>
      )}
    </div>
  );
}

function ChangeStepper({ activeIndex, total, stepTo }: { activeIndex: number; total: number; stepTo: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="sm" aria-label="Previous change" disabled={activeIndex <= 0} onClick={() => stepTo(-1)}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="font-mono text-caption tabular-nums">
        Change {Math.min(activeIndex + 1, total)} of {total}
      </span>
      <Button type="button" variant="ghost" size="sm" aria-label="Next change" disabled={activeIndex >= total - 1} onClick={() => stepTo(1)}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <span className="hidden gap-1 sm:flex">
        <kbd className="rounded border border-line-2 px-1 text-caption text-ink-2">n</kbd>
        <kbd className="rounded border border-line-2 px-1 text-caption text-ink-2">p</kbd>
      </span>
    </div>
  );
}

function ViewToggle({ viewMode, setViewMode, data }: { viewMode: "all" | "changes"; setViewMode: (m: "all" | "changes") => void; data: CompareData }) {
  // 44 px tap targets on a phone (`min-h-11`), compact on desktop.
  const pill = (mode: "all" | "changes", text: string) => (
    <button
      type="button"
      onClick={() => setViewMode(mode)}
      className={cn("min-h-11 rounded-full px-3 py-1 text-caption font-medium md:min-h-0", viewMode === mode ? "bg-elev text-ink" : "text-muted")}
    >
      {text}
    </button>
  );
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-paper-2 p-0.5">
        {pill("all", "All rows")}
        {pill("changes", "Only changes")}
      </div>
      <span className="text-caption text-muted">
        cells show {shortLabel(data.a.label)} {"→"} {shortLabel(data.b.label)}
      </span>
    </div>
  );
}

function CompareBody({ data, groups, viewMode, registerRow, activeKey }: { data: CompareData; groups: ReturnType<typeof buildCompareGroups>; viewMode: "all" | "changes"; registerRow: (key: string, el: HTMLTableRowElement | null) => void; activeKey: string | undefined }) {
  return (
    <>
      {data.rows === null ? (
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-4 text-caption text-muted">
          Row-level breakdown isn&apos;t available for a sent snapshot: only the totals a sent quote froze are captured. The figures above are exact; there is nothing reliable to diff row by row.
        </div>
      ) : (
        <CompareRowsTable groups={groups} viewMode={viewMode} registerRow={registerRow} activeKey={activeKey} />
      )}
      {data.planFieldChanges && data.planFieldChanges.length > 0 && (
        <p className="text-caption text-muted">Other plan changes (no money effect): {data.planFieldChanges.map((c) => c.field).join(", ")}.</p>
      )}
    </>
  );
}

function CompareSheetBody({ open, onOpenChange, projectId, orgId, compare, versions, liveVersion, onChangeCompare, onMakeLive }: CompareSheetProps) {
  const argA = resolveSideArg(compare.a, versions, liveVersion);
  const argB = resolveSideArg(compare.b, versions, liveVersion);
  const data = useAuthedQuery(api.versionsRead.compareVersions, compareQueryArgs(orgId, projectId, argA, argB));

  const [viewMode, setViewMode] = useState<"all" | "changes">("changes");
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (defaultedRef.current || !data?.rows) return;
    defaultedRef.current = true;
    setViewMode(data.rows.length > 40 ? "changes" : "all"); // D52
  }, [data?.rows]);

  const allRows = useMemo<CompareRow[]>(() => (data?.rows as CompareRow[] | null) ?? [], [data]);
  const changedRows = useMemo(() => allRows.filter((r) => r.state !== "unchanged"), [allRows]);
  const groups = useMemo(() => buildCompareGroups(allRows, viewMode), [allRows, viewMode]);
  const { activeIndex, stepTo, registerRow, jumpToSegment } = useCompareStepper(changedRows);

  // Only a real, non-live, captured version can be made live, and only by someone who may publish
  // (the same gate the Versions tab's `Make vN live…` uses).
  const canPublish = useCanDo("invoice", "publish");
  const bNumber = compare.b.kind === "version" ? compare.b.number : null;
  const bTarget = bNumber == null ? undefined : versions.find((v) => v.number === bNumber);
  const makeLiveNumber = canPublish && bTarget && !bTarget.isLive && bTarget.contentState === "ready" ? bTarget.number : null;
  const compareData = data as CompareData | undefined;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        {compareData ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SidePickers data={compareData} compare={compare} versions={versions} liveVersion={liveVersion} onChangeCompare={onChangeCompare} />
              {changedRows.length > 0 && <ChangeStepper activeIndex={activeIndex} total={changedRows.length} stepTo={stepTo} />}
            </div>
            <MoneyBridgeBar data={compareData} allRows={allRows} jumpToSegment={jumpToSegment} />
            {compareData.rows !== null && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} data={compareData} />}
            <CompareBody data={compareData} groups={groups} viewMode={viewMode} registerRow={registerRow} activeKey={changedRows[activeIndex]?.key} />
          </>
        ) : (
          <p className="text-table-cell text-muted">Loading comparison{"…"}</p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {makeLiveNumber != null && compareData ? (
            <Button
              type="button"
              variant="line"
              onClick={() => {
                onOpenChange(false);
                onMakeLive(makeLiveNumber);
              }}
            >
              <Sparkles className="h-3.5 w-3.5" /> Make {shortLabel(compareData.b.label)} live
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
