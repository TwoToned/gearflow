"use client";

import * as React from "react";

import { displayDate, keyOfMs } from "@/lib/crew-planner";
import { formatWeekday } from "@/lib/formatters";
import { cellWord, shortOnDay, type GearData, type GearRow } from "@/lib/schedule-gear";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/**
 * The Gear view on a phone (spec §9o.6): day chips for the week (`Wed 12 · 1 short`
 * red), then the models for ONE day as cards (`short 2` or `9 free`); a card
 * opens the model-day sheet. Zoom and the grid are hidden.
 */
interface Props {
  data: GearData;
  rows: GearRow[];
  day: string;
  onDay: (day: string) => void;
  onOpenCell: (modelId: string, day: string) => void;
}

function Chips({ data, rows, day, onDay }: Pick<Props, "data" | "rows" | "day" | "onDay">) {
  return (
    <div role="tablist" aria-label="Days" className="flex gap-2 overflow-x-auto pb-1">
      {data.dayStarts.map((ms, i) => {
        const key = keyOfMs(ms);
        const d = displayDate(key);
        const short = shortOnDay(rows, i);
        const on = key === day;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onDay(key)}
            className={cn("flex min-h-11 shrink-0 flex-col items-center justify-center rounded-[var(--r)] border px-3 text-caption", on ? "border-ink text-ink" : "border-line-2 text-muted")}
          >
            <span className="font-medium">{`${formatWeekday(d)} ${d.getDate()}`}</span>
            <span className={cn("font-mono", short > 0 ? intentStyles.error.text : "")}>{short > 0 ? `${short} short` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

/** `short 2`, or `9 free`; a cell that was not checked says so. */
function phoneWord(row: GearRow, i: number): { text: string; className: string } {
  const w = cellWord(row.cells[i]);
  if (w.kind === "unknown") return { text: "not checked", className: "text-muted" };
  const tone = w.intent ? intentStyles[w.intent].text : "text-ink";
  return { text: w.kind === "short" ? w.text : `${w.text} free${w.sub ? ` · ${w.sub}` : ""}`, className: tone };
}

export function PhoneGear({ data, rows, day, onDay, onOpenCell }: Props) {
  const i = Math.max(0, data.dayStarts.findIndex((ms) => keyOfMs(ms) === day));
  return (
    <div className="flex flex-col gap-3">
      <Chips data={data} rows={rows} day={day} onDay={onDay} />
      <ul className="flex flex-col gap-2" aria-label={`Gear on ${day}`}>
        {rows.map((r) => {
          const w = phoneWord(r, i);
          return (
            <li key={r.modelId}>
              <button
                type="button"
                onClick={() => onOpenCell(r.modelId, day)}
                className="flex min-h-[60px] w-full items-center justify-between gap-3 rounded-[var(--r)] border border-line-2 bg-card px-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ui-text text-ink">{r.name}</span>
                  <span className="block truncate text-caption text-muted">{r.unknown ? "stock not read" : `${r.owned} owned${r.inService > 0 ? ` · ${r.inService} in service` : ""}`}</span>
                </span>
                <span className={cn("shrink-0 font-mono text-ui-text font-medium", w.className)}>{w.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
