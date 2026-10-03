"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../../../convex/_generated/api";
import { intentStyles, intentBorderClass, type ColorIntent } from "@/lib/status-colors";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { CompareModeState, CompareSide, ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * Project Versioning v2, Phase 5b (#1232, parent #1221, design §5.1
 * D46-D53) — Compare mode. A MODE on the real project page, not a screen
 * (D46/D47): one scroll container, one grid, editing suspended, exit is one
 * click. See `convex/lib/versionCompare.ts` for the pure alignment/bridge
 * math this renders — nothing here re-derives it (R-3.1).
 *
 * D46 — this component renders exactly ONE scrollable element (the row
 * table below); the header strip, bridge and controls are fixed/non-
 * scrolling. Grep for `overflow-y-auto`/`overflow-auto` in this file to
 * verify there is only ever the one.
 */

type CompareRow = {
  key: string;
  kind: "line" | "group" | "service";
  state: "unchanged" | "changed" | "added" | "removed" | "moved";
  categoryLabel?: string;
  movedFromCategoryLabel?: string;
  alsoRepriced?: boolean;
  a: RowSnapshot | null;
  b: RowSnapshot | null;
};
type RowSnapshot = {
  id: string;
  label: string;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number;
  status?: string;
};
type BridgeSegment = { key: string; state: string; label: string; detail?: string; amount: number; rowKeys: string[] };

const STATE_INTENT: Record<string, ColorIntent> = {
  added: "success",
  removed: "error",
  changed: "warning",
  moved: "info",
  planField: "info",
  snapshotOnly: "neutral",
  unexplained: "error",
};

function stateBadgeLabel(state: string): string {
  switch (state) {
    case "added": return "Added";
    case "removed": return "Removed";
    case "changed": return "Repriced";
    case "moved": return "Moved";
    default: return state;
  }
}

function money(n: number): string {
  return formatCurrency(n);
}

function signedMoney(n: number): string {
  const abs = Math.abs(n);
  return `${n >= 0 ? "+" : "−"}${money(abs)}`;
}

/** Resolves a `CompareSide` (a version NUMBER, live, or a quote snapshot)
 *  into the `versionsRead.compareVersions` query's own arg shape. Returns
 *  `null` while the referenced version can't yet be resolved (still
 *  loading, or a stale side after the version list changed) — the caller
 *  skips the query rather than sending a bad id. */
function resolveSideArg(
  side: CompareSide,
  versions: ProjectVersionSummary[],
  liveVersion: ProjectVersionSummary | null,
): { kind: "version"; versionId: string } | { kind: "quoteSnapshot"; quoteId: string } | null {
  if (side.kind === "quoteSnapshot") return { kind: "quoteSnapshot", quoteId: side.quoteId };
  const target = side.number == null ? liveVersion : (versions.find((v) => v.number === side.number) ?? null);
  return target ? { kind: "version", versionId: target.id } : null;
}

function hasModifierKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
}

/** `1` to step forward (`n`), `-1` back (`p`), `null` for any other key. */
function stepDirectionForKey(key: string): 1 | -1 | null {
  const lower = key.toLowerCase();
  if (lower === "n") return 1;
  if (lower === "p") return -1;
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!el?.isContentEditable;
}

function isOverlayOpen(): boolean {
  return !!document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"]');
}

/** A ghost row — the placeholder D50 requires at a moved row's OLD
 *  category/group, so the reader can see it didn't just vanish. */
type Ghost = { ghost: true; key: string; text: string };

function ghostFor(row: CompareRow): Ghost {
  return {
    ghost: true,
    key: `${row.key}:ghost`,
    text: `${row.b?.label ?? row.a?.label ?? "This line"} moved to ${row.categoryLabel ?? "another category"} — counted there, not here`,
  };
}

/** Groups rows by category label for display (D49/D50), including ghost
 *  placeholders at a moved row's OLD category — ALWAYS shown (even in
 *  "Only changes" mode), since a moved row IS a change. Pure and
 *  module-scoped rather than inline in `CompareView`'s `useMemo` so its own
 *  branching doesn't count against that component's complexity budget
 *  (POLICY.md R-3.6). */
function buildCompareGroups(allRows: CompareRow[], viewMode: "all" | "changes"): { label: string; rows: (CompareRow | Ghost)[] }[] {
  const visible = allRows.filter((r) => viewMode === "all" || r.state !== "unchanged");
  const byLabel = new Map<string, (CompareRow | Ghost)[]>();
  const order: string[] = [];
  function bucket(label: string) {
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    return byLabel.get(label)!;
  }
  for (const r of visible) bucket(r.categoryLabel ?? "Uncategorized").push(r);
  for (const r of allRows) {
    if (r.state === "moved" && r.movedFromCategoryLabel && r.movedFromCategoryLabel !== r.categoryLabel) {
      bucket(r.movedFromCategoryLabel).push(ghostFor(r));
    }
  }
  return order.map((label) => ({ label, rows: byLabel.get(label)! }));
}

function sideDisplayLabel(side: CompareSide, versions: ProjectVersionSummary[], liveVersion: ProjectVersionSummary | null): string {
  if (side.kind === "quoteSnapshot") return side.label;
  const target = side.number == null ? liveVersion : versions.find((v) => v.number === side.number);
  if (!target) return "…";
  return `v${target.number}${target.isLive ? " · Live" : ""}${target.label ? ` · ${target.label}` : ""}`;
}

type CompareQueryArg = { kind: "version"; versionId: string } | { kind: "quoteSnapshot"; quoteId: string };

function compareQueryArgs(orgId: string, projectId: string, argA: CompareQueryArg | null, argB: CompareQueryArg | null) {
  if (!argA || !argB) return "skip" as const;
  return { organizationId: orgId, projectId, a: argA, b: argB };
}

interface CompareViewProps {
  projectId: string;
  orgId: string;
  compare: CompareModeState;
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  onChangeCompare: (next: CompareModeState) => void;
  onExit: () => void;
  onMakeLive: (versionNumber: number) => void;
}

export function CompareView({ projectId, orgId, compare, versions, liveVersion, onChangeCompare, onExit, onMakeLive }: CompareViewProps) {
  const argA = resolveSideArg(compare.a, versions, liveVersion);
  const argB = resolveSideArg(compare.b, versions, liveVersion);
  const data = useAuthedQuery(api.versionsRead.compareVersions, compareQueryArgs(orgId, projectId, argA, argB));

  const [viewMode, setViewMode] = useState<"all" | "changes">("changes");
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (defaultedRef.current || !data?.rows) return;
    defaultedRef.current = true;
    // D52 — defaults to "Only changes" above 40 rows, otherwise "All rows".
    setViewMode(data.rows.length > 40 ? "changes" : "all");
  }, [data?.rows]);

  const allRows = useMemo<CompareRow[]>(() => (data?.rows as CompareRow[] | null) ?? [], [data]);
  const changedRows = useMemo(() => allRows.filter((r) => r.state !== "unchanged"), [allRows]);
  // Resets to 0 whenever either side changes via the `key` the page mounts
  // this component with (see `page.tsx`'s CompareView usage) — a remount,
  // not a `setState`-in-effect, so there's no cascading-render warning and
  // no risk of an index left pointing at a change from the PREVIOUS pair.
  const [activeIndex, setActiveIndex] = useState(0);

  const rowElsRef = useRef(new Map<string, HTMLTableRowElement>());
  const registerRow = useCallback((key: string, el: HTMLTableRowElement | null) => {
    if (el) rowElsRef.current.set(key, el);
    else rowElsRef.current.delete(key);
  }, []);

  const focusRowByKey = useCallback((key: string) => {
    const el = rowElsRef.current.get(key);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const stepTo = useCallback(
    (delta: number) => {
      if (changedRows.length === 0) return;
      setActiveIndex((i) => {
        const next = Math.min(Math.max(i + delta, 0), changedRows.length - 1);
        focusRowByKey(changedRows[next].key);
        return next;
      });
    },
    [changedRows, focusRowByKey],
  );

  // D52 a11y — n/p step through changes and move keyboard FOCUS (not just
  // scroll). Skipped while typing or a dialog/menu is open, matching the
  // header pill's own `V`-shortcut convention.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (hasModifierKey(e)) return;
      const stepKey = stepDirectionForKey(e.key);
      if (!stepKey || isTypingTarget(e.target) || isOverlayOpen()) return;
      e.preventDefault();
      stepTo(stepKey);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepTo]);

  const jumpToSegment = useCallback(
    (seg: BridgeSegment) => {
      const key = seg.rowKeys[0];
      if (!key) return;
      const idx = changedRows.findIndex((r) => r.key === key);
      if (idx >= 0) {
        setActiveIndex(idx);
        setViewMode((m) => m); // no-op, keeps the row visible under either mode since it's a change row
        focusRowByKey(key);
      }
    },
    [changedRows, focusRowByKey],
  );

  const bTarget = compare.b.kind === "version" ? compare.b : null;
  const canMakeLive = bTarget != null && bTarget.number != null; // only a real, non-live version can be made live

  const groups = useMemo(() => buildCompareGroups(allRows, viewMode), [allRows, viewMode]);

  if (!data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border-l-[3px] border-l-blue bg-blue-soft px-4 py-3 text-sm text-blue">
        <span>Loading comparison…</span>
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <X className="h-3.5 w-3.5" /> Exit compare
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <CompareHeaderStrip
          data={data}
          compare={compare}
          versions={versions}
          liveVersion={liveVersion}
          onChangeCompare={onChangeCompare}
          changedRows={changedRows}
          activeIndex={activeIndex}
          stepTo={stepTo}
          canMakeLive={canMakeLive}
          bTarget={bTarget}
          onMakeLive={onMakeLive}
          onExit={onExit}
        />

        <MoneyBridgeBar data={data} allRows={allRows} jumpToSegment={jumpToSegment} />

        {data.rows !== null && <CompareControlsRow viewMode={viewMode} setViewMode={setViewMode} data={data} />}

        <CompareBody data={data} groups={groups} viewMode={viewMode} registerRow={registerRow} activeKey={changedRows[activeIndex]?.key} />
      </div>
    </TooltipProvider>
  );
}

/** D46's ONE scroll container (the row table) plus its two non-scrolling
 *  siblings (the no-row-data note and the plan-field footnote) — split out
 *  purely to keep `CompareView`'s own branch count down (POLICY.md R-3.6). */
function CompareBody({
  data,
  groups,
  viewMode,
  registerRow,
  activeKey,
}: {
  data: CompareData;
  groups: { label: string; rows: (CompareRow | Ghost)[] }[];
  viewMode: "all" | "changes";
  registerRow: (key: string, el: HTMLTableRowElement | null) => void;
  activeKey: string | undefined;
}) {
  return (
    <>
      {data.rows === null ? (
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-4 text-caption text-muted">
          Row-level breakdown isn&apos;t available for a sent snapshot — only the totals a sent quote froze are captured. The figures above are exact; the table below isn&apos;t shown because there&apos;s nothing reliable to diff row-by-row.
        </div>
      ) : (
        <CompareRowsTable groups={groups} viewMode={viewMode} registerRow={registerRow} activeKey={activeKey} />
      )}
      {data.planFieldChanges && data.planFieldChanges.length > 0 && (
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-3 text-caption text-muted">
          Other plan changes (no money effect): {data.planFieldChanges.map((c) => c.field).join(", ")}.
        </div>
      )}
    </>
  );
}

type CompareData = {
  a: { label: string; totals: { total: number } };
  b: { label: string; totals: { total: number } };
  rows: CompareRow[] | null;
  bridge: { totalA: number; totalB: number; segments: BridgeSegment[] };
  planFieldChanges: { field: string }[] | null;
};

function shortLabel(label: string): string {
  return label.split(" ·")[0];
}

function CompareHeaderStrip({
  data,
  compare,
  versions,
  liveVersion,
  onChangeCompare,
  changedRows,
  activeIndex,
  stepTo,
  canMakeLive,
  bTarget,
  onMakeLive,
  onExit,
}: {
  data: CompareData;
  compare: CompareModeState;
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  onChangeCompare: (next: CompareModeState) => void;
  changedRows: CompareRow[];
  activeIndex: number;
  stepTo: (delta: number) => void;
  canMakeLive: boolean;
  bTarget: { kind: "version"; number: number | null } | null;
  onMakeLive: (versionNumber: number) => void;
  onExit: () => void;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-[3px] px-4 py-3 text-sm", intentBorderClass("info"), intentStyles.info.bg, intentStyles.info.text)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold">Comparing {data.a.label}</span>
        <span className="text-muted">with</span>
        {compare.b.kind === "version" ? (
          <VersionPicker value={compare.b} versions={versions} liveVersion={liveVersion} onChange={(next) => onChangeCompare({ a: compare.a, b: next })} />
        ) : (
          <span className="font-semibold">{data.b.label}</span>
        )}
        <span className="text-caption text-muted">· editing paused while comparing</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {changedRows.length > 0 && (
          <ChangeStepper activeIndex={activeIndex} total={changedRows.length} stepTo={stepTo} />
        )}
        {canMakeLive && bTarget?.number != null && (
          <Button type="button" variant="primary" size="sm" onClick={() => onMakeLive(bTarget.number!)}>
            <Sparkles className="h-3.5 w-3.5" /> Make {shortLabel(data.b.label)} live
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="h-3.5 w-3.5" /> Exit compare
        </Button>
      </div>
    </div>
  );
}

function ChangeStepper({ activeIndex, total, stepTo }: { activeIndex: number; total: number; stepTo: (delta: number) => void }) {
  return (
    <>
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
    </>
  );
}

function BridgeSegmentButton({ seg, allRows, jumpToSegment }: { seg: BridgeSegment; allRows: CompareRow[]; jumpToSegment: (seg: BridgeSegment) => void }) {
  const intent = STATE_INTENT[seg.state] ?? "neutral";
  const clickable = seg.rowKeys.length > 0 && seg.rowKeys[0] !== `planField:${seg.key}` && allRows.some((r) => r.key === seg.rowKeys[0]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => jumpToSegment(seg)}
          className={cn(
            "flex min-w-[120px] flex-col items-start gap-0.5 rounded-[var(--r)] border px-3 py-2 text-left transition-colors",
            intentBorderClass(intent),
            intentStyles[intent].bg,
            clickable ? "cursor-pointer hover:brightness-110" : "cursor-default",
          )}
        >
          <span className={cn("font-mono text-caption font-semibold tabular-nums", intentStyles[intent].text)}>{signedMoney(seg.amount)}</span>
          <span className="line-clamp-2 text-caption text-ink-2">{seg.label}</span>
        </button>
      </TooltipTrigger>
      {seg.detail && <TooltipContent>{seg.detail}</TooltipContent>}
    </Tooltip>
  );
}

/** THE MONEY BRIDGE (D48) — a horizontal list of clickable segments
 *  connecting the two totals; not a pixel-precise waterfall render, but the
 *  same substance: every segment traces to rows/plan-field changes
 *  (`assertBridgeIntegrity`, server-side) and the sum is exact. */
function MoneyBridgeBar({ data, allRows, jumpToSegment }: { data: CompareData; allRows: CompareRow[]; jumpToSegment: (seg: BridgeSegment) => void }) {
  const totalDelta = data.bridge.totalB - data.bridge.totalA;
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4 shadow-[var(--sh-card)]">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="t-overline">
          Why {shortLabel(data.b.label)} {totalDelta >= 0 ? "costs more" : "costs less"}
        </span>
        <span className="text-caption text-muted">{pluralize(data.bridge.segments.length, "change")} · click a step to jump to its rows</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        <TotalPill label={data.a.label} amount={data.bridge.totalA} />
        {data.bridge.segments.map((seg) => (
          <BridgeSegmentButton key={seg.key} seg={seg} allRows={allRows} jumpToSegment={jumpToSegment} />
        ))}
        <TotalPill label={data.b.label} amount={data.bridge.totalB} emphasized />
      </div>
    </div>
  );
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Controls (D52) — three, no more: this All/Only-changes toggle, the
 *  stepper (in the header strip), the target picker (also in the header
 *  strip, inline with "Comparing... with..."). */
function CompareControlsRow({ viewMode, setViewMode, data }: { viewMode: "all" | "changes"; setViewMode: (m: "all" | "changes") => void; data: CompareData }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-paper-2 p-0.5">
        <button type="button" onClick={() => setViewMode("all")} className={cn("rounded-full px-3 py-1 text-caption font-medium", viewMode === "all" ? "bg-elev text-ink" : "text-muted")}>
          All rows
        </button>
        <button type="button" onClick={() => setViewMode("changes")} className={cn("rounded-full px-3 py-1 text-caption font-medium", viewMode === "changes" ? "bg-elev text-ink" : "text-muted")}>
          Only changes
        </button>
      </div>
      <span className="text-caption text-muted">
        cells show {shortLabel(data.a.label)} → {shortLabel(data.b.label)}
      </span>
    </div>
  );
}

function CompareRowsTable({
  groups,
  viewMode,
  registerRow,
  activeKey,
}: {
  groups: { label: string; rows: (CompareRow | Ghost)[] }[];
  viewMode: "all" | "changes";
  registerRow: (key: string, el: HTMLTableRowElement | null) => void;
  activeKey: string | undefined;
}) {
  return (
    <div className="max-h-[60vh] overflow-y-auto rounded-[var(--r-lg)] border border-line bg-card">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <Th />
            <Th>Item</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Unit</Th>
            <Th align="right">Line</Th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-caption text-muted">
                No changes to show{viewMode === "changes" ? " — try “All rows”" : ""}.
              </td>
            </tr>
          )}
          {groups.map((group) => (
            <RowGroup key={group.label} label={group.label} rows={group.rows} registerRow={registerRow} activeKey={activeKey} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VersionPicker({
  value,
  versions,
  liveVersion,
  onChange,
}: {
  value: { kind: "version"; number: number | null };
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  onChange: (next: { kind: "version"; number: number | null }) => void;
}) {
  const selectValue = value.number == null ? "live" : String(value.number);
  const label = sideDisplayLabel(value, versions, liveVersion);
  return (
    <Select value={selectValue} onValueChange={(v) => onChange({ kind: "version", number: v === "live" ? null : Number(v) })}>
      <SelectTrigger className="h-7 w-auto gap-1 border-line-2 bg-paper-2 px-2 text-caption">
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {liveVersion && (
          <SelectItem value="live">
            v{liveVersion.number} · Live
          </SelectItem>
        )}
        {versions
          .filter((v) => !v.isLive)
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

function TotalPill({ label, amount, emphasized }: { label: string; amount: number; emphasized?: boolean }) {
  return (
    <div className={cn("flex min-w-[100px] flex-col items-center justify-center rounded-[var(--r)] border border-line-2 px-3 py-2", emphasized ? "bg-red-soft" : "bg-paper-2")}>
      <span className={cn("font-mono text-caption font-bold tabular-nums", emphasized ? "text-red" : "text-ink")}>{money(amount)}</span>
      <span className="mt-0.5 text-caption text-faint">{label.split(" ·")[0]}</span>
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "right" }) {
  return <th className={cn("px-3 py-2 text-caption font-semibold text-muted", align === "right" && "text-right")}>{children}</th>;
}

function RowGroup({
  label,
  rows,
  registerRow,
  activeKey,
}: {
  label: string;
  rows: (CompareRow | { ghost: true; key: string; text: string })[];
  registerRow: (key: string, el: HTMLTableRowElement | null) => void;
  activeKey: string | undefined;
}) {
  const totalA = rows.reduce((s, r) => ("ghost" in r ? s : s + (r.a?.lineTotal ?? 0)), 0);
  const totalB = rows.reduce((s, r) => ("ghost" in r ? s : s + (r.b?.lineTotal ?? 0)), 0);
  return (
    <>
      <tr className="bg-paper-2/50">
        <td colSpan={5} className="px-3 py-2">
          <span className="t-overline">{label}</span>{" "}
          <span className="text-caption text-muted">
            · {rows.filter((r) => !("ghost" in r)).length} line{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="font-mono tabular-nums">
              {money(totalA)} → {money(totalB)}
            </span>
          </span>
        </td>
      </tr>
      {rows.map((r) =>
        "ghost" in r ? (
          <tr key={r.key} className="opacity-40">
            <td />
            <td colSpan={4} className="px-3 py-1.5 text-caption italic text-muted">
              {r.text}
            </td>
          </tr>
        ) : (
          <CompareRowView key={r.key} row={r} isActive={r.key === activeKey} registerRow={registerRow} />
        ),
      )}
    </>
  );
}

function fieldChanged(a: number | null, b: number | null): boolean {
  return (a ?? null) !== (b ?? null);
}

/** Static class lookup, not a template-built string — Tailwind's JIT scanner
 *  only picks up class names it can see literally in source, so a runtime-
 *  interpolated `shadow-[...var(--${x})]` would silently compile to nothing. */
const ROW_EDGE_CLASS: Record<ColorIntent, string> = {
  success: "shadow-[inset_3px_0_0_0_var(--ok)]",
  error: "shadow-[inset_3px_0_0_0_var(--t-out)]",
  warning: "shadow-[inset_3px_0_0_0_var(--warn)]",
  info: "shadow-[inset_3px_0_0_0_var(--blue)]",
  neutral: "shadow-[inset_3px_0_0_0_var(--rep)]",
  primary: "shadow-[inset_3px_0_0_0_var(--red)]",
};

function rowClassName(row: CompareRow, intent: ColorIntent, isActive: boolean): string {
  const changed = row.state !== "unchanged";
  return cn(
    "outline-none focus-visible:ring-2 focus-visible:ring-red",
    !changed && "opacity-55",
    changed && ROW_EDGE_CLASS[intent],
    isActive && "bg-elev",
  );
}

function RowStatePill({ row, intent }: { row: CompareRow; intent: ColorIntent }) {
  if (row.state === "unchanged") return null;
  const text = row.state === "moved" ? `Moved from ${row.movedFromCategoryLabel ?? "—"}` : stateBadgeLabel(row.state);
  return <span className={cn("rounded-full px-1.5 py-0.5 text-badge font-semibold", intentStyles[intent].pill)}>{text}</span>;
}

function RowLabelCell({ row, intent }: { row: CompareRow; intent: ColorIntent }) {
  const label = row.b?.label ?? row.a?.label ?? "—";
  const labelClassName = cn("text-table-cell", row.state === "removed" && "text-muted line-through");
  return (
    <td className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className={labelClassName}>{label}</span>
        <RowStatePill row={row} intent={intent} />
        {row.alsoRepriced && <span className="text-caption text-muted">also repriced</span>}
      </div>
    </td>
  );
}

function quantityFormat(n: number): string {
  return String(n);
}

/** `snap?.[field] ?? null` as a call — an optional-chain PLUS a nullish
 *  coalesce each count as a decision point for `complexity` (POLICY.md
 *  R-3.6), and `CompareRowView` needs six of these (2 sides x 3 fields);
 *  moving them into one small helper keeps that cost on this function
 *  instead of ballooning the caller's count for what reads as one lookup. */
function numField(snap: RowSnapshot | null, field: "quantity" | "unitPrice" | "lineTotal"): number | null {
  return snap?.[field] ?? null;
}

function CompareRowView({ row, isActive, registerRow }: { row: CompareRow; isActive: boolean; registerRow: (key: string, el: HTMLTableRowElement | null) => void }) {
  const intent = STATE_INTENT[row.state] ?? "neutral";

  return (
    <tr ref={(el) => registerRow(row.key, el)} tabIndex={-1} className={rowClassName(row, intent, isActive)}>
      <td />
      <RowLabelCell row={row} intent={intent} />
      <td className="px-3 py-1.5 text-right font-mono text-table-cell tabular-nums">
        <OldNewCell oldVal={numField(row.a, "quantity")} newVal={numField(row.b, "quantity")} state={row.state} format={quantityFormat} />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-table-cell tabular-nums">
        <OldNewCell oldVal={numField(row.a, "unitPrice")} newVal={numField(row.b, "unitPrice")} state={row.state} format={money} />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-table-cell tabular-nums">
        <OldNewCell oldVal={numField(row.a, "lineTotal")} newVal={numField(row.b, "lineTotal")} state={row.state} format={money} />
      </td>
    </tr>
  );
}

/** D51 — for a CHANGED row, only the differing cells show `old → new`; an
 *  unchanged cell on an otherwise-changed row just prints its one value. */
function fmtOrDash(v: number | null, format: (n: number) => string): string {
  return v != null ? format(v) : "—";
}

const DIFFABLE_STATES = new Set(["changed", "moved"]);

function OldNewCell({ oldVal, newVal, state, format }: { oldVal: number | null; newVal: number | null; state: string; format: (n: number) => string }) {
  if (state === "added") return <>{fmtOrDash(newVal, format)}</>;
  if (state === "removed") {
    return (
      <>
        <span className="text-faint line-through">{fmtOrDash(oldVal, format)}</span> <span className="text-t-out">→ 0</span>
      </>
    );
  }
  if (DIFFABLE_STATES.has(state) && fieldChanged(oldVal, newVal)) {
    return (
      <>
        <span className="text-faint line-through">{fmtOrDash(oldVal, format)}</span>{" "}
        <span className="text-warn">→ {fmtOrDash(newVal, format)}</span>
      </>
    );
  }
  return <>{newVal != null ? fmtOrDash(newVal, format) : fmtOrDash(oldVal, format)}</>;
}
