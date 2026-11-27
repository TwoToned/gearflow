"use client";

import * as React from "react";

import { displayDate, isWeekend, keyOfMs } from "@/lib/crew-planner";
import { formatWeekday } from "@/lib/formatters";
import type { ScheduleRange } from "@/lib/schedule";
import { cellWord, groupByCategory, shortOnDay, slimCellText, type GearData, type GearRow } from "@/lib/schedule-gear";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/**
 * The Gear grid (spec §9o.4): rows are models grouped by category, columns days,
 * a cell the free count that day. A plain day prints only the number (faint when
 * nothing holds it); a shortfall prints a red `short 2` with `held 10` under it;
 * a pencilled risk prints the free number in amber with `pencilled −2`; a cell
 * the read could not cover in full prints `—` and `not checked`, never a
 * number. Month zoom shrinks a cell to the number. A cell opens the model-day
 * sheet (`?cell=`). Same column widths and sticky label column as the Jobs timeline.
 */
const LABEL_PX = 264;

interface Props {
  data: GearData;
  rows: GearRow[];
  range: ScheduleRange;
  today: string;
  categoryName: (id: string) => string | null;
  onOpenCell: (modelId: string, day: string) => void;
}

function dayClass(day: string, today: string): string {
  return cn("border-l border-line", isWeekend(day) && "bg-paper-2/50", day === today && "border-x border-x-ink/40");
}

function Header({ data, rows, today, month, cols }: { data: GearData; rows: GearRow[]; today: string; month: boolean; cols: string }) {
  return (
    <div role="row" className="grid border-b border-line-2" style={{ gridTemplateColumns: cols }}>
      <div className="sticky left-0 z-20 bg-card px-3 py-2 text-caption text-muted">{rows.length === 1 ? "1 model" : `${rows.length} models`}</div>
      {data.dayStarts.map((ms, i) => {
        const key = keyOfMs(ms);
        const d = displayDate(key);
        const short = shortOnDay(rows, i);
        return (
          <div key={key} role="columnheader" className={cn("flex flex-col items-center gap-0.5 py-2", dayClass(key, today))}>
            <span className="font-mono text-caption font-medium text-ink">{month ? `${formatWeekday(d).slice(0, 1)} ${d.getDate()}` : `${formatWeekday(d)} ${d.getDate()}`}</span>
            {!month && <span className={cn("font-mono text-caption", short > 0 ? intentStyles.error.text : "text-muted")}>{short > 0 ? `${short} short` : ""}</span>}
            {month && short > 0 && <span aria-label={`${short} short`} className={cn("size-1.5 rounded-full", intentStyles.error.dot)} />}
          </div>
        );
      })}
    </div>
  );
}

function Cell({ row, i, data, month, today, onOpen }: { row: GearRow; i: number; data: GearData; month: boolean; today: string; onOpen: (modelId: string, day: string) => void }) {
  const key = keyOfMs(data.dayStarts[i]);
  const w = cellWord(row.cells[i]);
  const tone = w.intent ? intentStyles[w.intent].text : w.quiet ? "text-muted" : "text-ink";
  return (
    <button
      type="button"
      aria-label={`${row.name}, ${key}: ${w.text}${w.sub ? `, ${w.sub}` : ""}`}
      onClick={() => onOpen(row.modelId, key)}
      className={cn("flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red", dayClass(key, today))}
      style={{ gridRow: 1, gridColumn: i + 2 }}
    >
      {month ? (
        <span className={cn("font-mono text-caption", tone)}>{slimCellText(row.cells[i])}</span>
      ) : (
        <>
          <span className={cn("flex items-center gap-1 font-mono text-ui-text", tone, w.kind === "short" && "font-medium")}>
            {w.kind === "short" && <span aria-hidden="true" className={cn("size-1.5 rounded-full", intentStyles.error.dot)} />}
            {w.text}
          </span>
          {w.sub && <span className="font-mono text-caption text-muted">{w.sub}</span>}
        </>
      )}
    </button>
  );
}

function ModelRow({ row, data, month, today, cols, onOpen }: { row: GearRow; data: GearData; month: boolean; today: string; cols: string; onOpen: (modelId: string, day: string) => void }) {
  const stock = row.unknown ? "stock not read" : `${row.owned} owned${row.inService > 0 ? ` · ${row.inService} in service` : ""}`;
  return (
    <div role="row" className="grid border-b border-line last:border-b-0" style={{ gridTemplateColumns: cols }}>
      <div className="sticky left-0 z-20 flex min-w-0 flex-col justify-center bg-card py-1 pl-3 pr-2" style={{ gridRow: 1, gridColumn: 1 }}>
        <span className="truncate text-ui-text text-ink">{row.name}</span>
        <span className="truncate text-caption text-muted">{stock}</span>
      </div>
      {data.dayStarts.map((ms, i) => (
        <Cell key={ms} row={row} i={i} data={data} month={month} today={today} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function GearGrid({ data, rows, range, today, categoryName, onOpenCell }: Props) {
  const month = range.zoom === "month";
  const col = month ? 34 : 88;
  const cols = `${LABEL_PX}px repeat(${data.dayStarts.length}, minmax(${col}px, 1fr))`;
  const groups = groupByCategory(rows, categoryName);
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] border border-line-2 bg-card" data-testid="schedule-gear">
      <div role="table" aria-label="Free gear by day" style={{ minWidth: LABEL_PX + data.dayStarts.length * col }}>
        <Header data={data} rows={rows} today={today} month={month} cols={cols} />
        {groups.map((g) => (
          <div key={g.key} role="rowgroup" aria-label={g.label}>
            <div role="row" className="sticky left-0 border-b border-line bg-paper-2/60 px-3 py-1 text-caption font-medium uppercase tracking-wide text-muted">
              {g.label} {g.rows.length}
            </div>
            {g.rows.map((r) => (
              <ModelRow key={r.modelId} row={r} data={data} month={month} today={today} cols={cols} onOpen={onOpenCell} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
