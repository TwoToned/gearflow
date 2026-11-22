"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { intentBorderClass, intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import {
  STATE_INTENT,
  money,
  pluralize,
  shortLabel,
  signedMoney,
  type BridgeSegment,
  type CompareData,
  type CompareRow,
} from "@/components/projects/compare/compare-model";

/**
 * THE MONEY BRIDGE (D48): a list of clickable segments connecting the two
 * totals, every one traced to rows or plan-field changes server-side
 * (`assertBridgeIntegrity`) so the sum is exact. A segment jumps to its first
 * row (the bridge jump, kept per overseer Q9). Must render inside a
 * `TooltipProvider` (the sheet provides it).
 */

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

function TotalPill({ label, amount, emphasized }: { label: string; amount: number; emphasized?: boolean }) {
  return (
    <div className={cn("flex min-w-[100px] flex-col items-center justify-center rounded-[var(--r)] border border-line-2 px-3 py-2", emphasized ? "bg-red-soft" : "bg-paper-2")}>
      <span className={cn("font-mono text-caption font-bold tabular-nums", emphasized ? "text-red-text" : "text-ink")}>{money(amount)}</span>
      <span className="mt-0.5 text-caption text-muted">{shortLabel(label)}</span>
    </div>
  );
}

export function MoneyBridgeBar({ data, allRows, jumpToSegment }: { data: CompareData; allRows: CompareRow[]; jumpToSegment: (seg: BridgeSegment) => void }) {
  const totalDelta = data.bridge.totalB - data.bridge.totalA;
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="t-overline">
          {shortLabel(data.a.label)} {"→"} {shortLabel(data.b.label)} {"·"} {signedMoney(totalDelta)}
        </span>
        <span className="text-caption text-muted">{pluralize(data.bridge.segments.length, "change")} {"·"} click a step to jump to its rows</span>
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
