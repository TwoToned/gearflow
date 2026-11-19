"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionMenu } from "@/components/ui/action-menu";
import { useReturningLineUnits } from "@/hooks/use-returns";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import {
  groupHeadText, lineOutcomeWords, lineProgressText, overdueDays, pageGroups,
  type ReturningGroup, type ReturningLine,
} from "@/lib/returning";
import { buildUnitActions, type ReturningUnit, type UnitCtx } from "@/lib/row-actions/returning-line";
import { cn } from "@/lib/utils";

export interface ReturningViewProps {
  orgId: string | undefined;
  groups: ReturningGroup[];
  now: number;
  isMobile: boolean;
  /** Phone only: how many rows to show (`Show 25 more · n left`). */
  show: number;
  onShowMore: () => void;
  isSelected: (id: string) => boolean;
  onToggle: (id: string, shift: boolean) => void;
  lineMenu: (line: ReturningLine) => ActionMenuSpec;
  groupMenu: (group: ReturningGroup) => ActionMenuSpec;
  expanded: string | null;
  unitCtx: (line: ReturningLine) => UnitCtx;
}

const UNIT_TONE: Record<string, string> = {
  CHECKED_OUT: "border-line-2 text-ink",
  GOOD: "border-ok/40 text-ok",
  DAMAGED: "border-warn/50 text-warn",
  MISSING: "border-t-out/50 text-t-out",
};

function unitWord(u: ReturningUnit): string {
  if (u.status === "CHECKED_OUT") return "out";
  const c = u.returnCondition ?? "GOOD";
  const word = c === "GOOD" ? "back" : c.toLowerCase();
  return u.lateBack ? `${word} · late` : word;
}

function UnitChip({ unit, menu }: { unit: ReturningUnit; menu: ActionMenuSpec }) {
  const tone = UNIT_TONE[unit.status === "CHECKED_OUT" ? "CHECKED_OUT" : (unit.returnCondition ?? "GOOD")] ?? UNIT_TONE.GOOD;
  const label = `${unit.assetTag ?? `×${unit.quantity}`} · ${unitWord(unit)}`;
  const chip = (
    <span className={cn("inline-flex min-h-8 items-center rounded-full border px-2.5 font-mono text-caption", tone)}>{label}</span>
  );
  if (menu.items.length === 0) return chip;
  return (
    <ActionMenu
      spec={menu}
      label={`Unit ${unit.assetTag ?? unit.unitId}`}
      trigger={<button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red">{chip}</button>}
    />
  );
}

/** A line's unit chips (every unit, each with its outcome) plus its accessories. */
function LineDetail({ orgId, line, ctx }: { orgId: string | undefined; line: ReturningLine; ctx: UnitCtx }) {
  const data = useReturningLineUnits(orgId, line.lineItemId);
  return (
    <div className="flex flex-col gap-2 pb-2 pl-9">
      {data === undefined ? <span className="text-caption text-muted">Loading units…</span> : null}
      {data ? (
        <div className="flex flex-wrap gap-1.5" aria-label={`Units of ${line.description}`}>
          {data.units.map((u) => <UnitChip key={u.unitId} unit={u} menu={buildUnitActions(u, ctx)} />)}
          {data.truncated ? <span className="text-caption text-muted">showing the first {data.units.length}</span> : null}
        </div>
      ) : null}
      {line.accessories.length > 0 ? (
        <ul className="text-caption text-muted">
          {line.accessories.map((a) => (
            <li key={a.lineItemId}>{`+ ${a.description} · ${a.back} of ${a.out + a.back} back · returns with its parent`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineRow({ line, group, p }: { line: ReturningLine; group: ReturningGroup; p: ReturningViewProps }) {
  const words = lineOutcomeWords(line, group, p.now);
  const selectable = line.scannable && line.out > 0;
  return (
    <li className="border-t border-line first:border-t-0">
      <div className={cn("flex items-center gap-3 px-2", p.isMobile ? "min-h-16" : "min-h-11")}>
        <span className="flex w-6 justify-center">
          {selectable ? (
            <Checkbox
              checked={p.isSelected(line.lineItemId)}
              aria-label={`Select ${line.description}`}
              onClick={(e) => { e.preventDefault(); p.onToggle(line.lineItemId, e.shiftKey); }}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3">
          <span className="truncate text-ui-text text-ink">
            {line.description}
            {line.kitAssetTag ? <span className="ml-2 font-mono text-caption text-muted">{line.kitAssetTag}</span> : null}
            {line.scannable ? null : <span className="ml-2 text-caption text-muted">no serials</span>}
          </span>
          <span className="text-caption tabular-nums text-muted md:ml-auto">{lineProgressText(line)}</span>
          {words.length > 0 ? <span className="text-caption text-warn">{words.join(" · ")}</span> : null}
        </span>
        <ActionMenu spec={p.lineMenu(line)} label={`Actions for ${line.description}`} />
      </div>
      {p.expanded === line.lineItemId ? <LineDetail orgId={p.orgId} line={line} ctx={p.unitCtx(line)} /> : null}
    </li>
  );
}

/** Returning mode's body (spec §9c.4): lines grouped by job, outcome words,
 *  unit chips on demand. Desktop reads as a table; the phone keeps the same
 *  rows at 64 px and pages them (`Show 25 more`). */
export function ReturningView(p: ReturningViewProps) {
  const total = p.groups.reduce((n, g) => n + g.lines.length, 0);
  const shown = p.isMobile ? pageGroups(p.groups, p.show) : p.groups;
  return (
    <div className="flex flex-col gap-4" data-testid="returning-view">
      {shown.map((g) => {
        const lines = g.lines;
        const late = overdueDays(g, p.now) > 0;
        return (
          <section key={g.projectId} aria-label={`#${g.projectNumber} ${g.projectName}`} className="rounded-[var(--r)] border border-line bg-elev">
            <header className="flex min-h-11 items-center gap-2 border-b border-line px-3">
              <h2 className={cn("min-w-0 flex-1 truncate text-ui-text font-medium", late ? "text-t-out" : "text-ink")}>{groupHeadText(g, p.now)}</h2>
              <ActionMenu spec={p.groupMenu(g)} label={`Actions for #${g.projectNumber}`} />
            </header>
            <ul>{lines.map((l) => <LineRow key={l.lineItemId} line={l} group={g} p={p} />)}</ul>
          </section>
        );
      })}
      {p.isMobile && total > p.show ? (
        <Button variant="line" className="min-h-11" onClick={p.onShowMore}>{`Show 25 more · ${total - p.show} left`}</Button>
      ) : null}
    </div>
  );
}
