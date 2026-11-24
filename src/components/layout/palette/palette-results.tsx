"use client";

import { ChevronRight } from "lucide-react";
import { StatusWord } from "@/components/ui/status-word";
import { jobStatusLabel } from "@/lib/list-views/jobs";
import { getStatusIntent } from "@/lib/status-colors";
import type { PaletteRow, PaletteSection } from "@/lib/palette/model";
import { cn } from "@/lib/utils";
import { PaletteIcon } from "./palette-icons";

const KBD = "shrink-0 rounded border bg-bg-inset px-1 font-mono text-[10px] text-fg-3";

interface RowProps {
  row: PaletteRow;
  index: number;
  selected: boolean;
  isMobile: boolean;
  /** Children are drawn indented under their parent (not in a drill-down). */
  nested: boolean;
  onActivate: (row: PaletteRow, index: number) => void;
  onHover: (index: number) => void;
  register: (index: number, el: HTMLButtonElement | null) => void;
}

/** The right-hand words: a job's dot-word status, a hint, and the drill affordance. */
function RowTail({ row, selected, isMobile }: Pick<RowProps, "row" | "selected" | "isMobile">) {
  return (
    <>
      {row.status && (
        <StatusWord status={{ label: jobStatusLabel(row.status), intent: getStatusIntent("project", row.status) }} className="shrink-0 text-[12px]" />
      )}
      {row.hint && <span className={row.hint.startsWith("/") ? KBD : "shrink-0 text-xs text-fg-3/70"}>{row.hint}</span>}
      {row.hasChildren && selected && !isMobile && <kbd className={KBD}>Tab →</kbd>}
      {row.hasChildren && isMobile && <ChevronRight className="h-4 w-4 shrink-0 text-fg-3/60" aria-hidden />}
    </>
  );
}

/** One row: mono id, name, muted sub, dot-word status (§6d.3). 58px on a phone (§6d.6). */
function Row({ row, index, selected, isMobile, nested, onActivate, onHover, register }: RowProps) {
  const child = nested && row.isChild;
  return (
    <button
      type="button"
      ref={(el) => register(index, el)}
      onClick={() => onActivate(row, index)}
      onMouseEnter={() => !isMobile && onHover(index)}
      aria-selected={selected}
      role="option"
      className={cn(
        "flex w-full items-center gap-3 rounded-md text-left text-sm transition-colors",
        isMobile ? "min-h-[58px] py-2" : "py-1.5",
        child ? "pl-9 pr-3" : "px-3",
        selected ? "bg-accent text-accent-foreground" : "text-fg hover:bg-accent/50",
      )}
    >
      <PaletteIcon icon={row.icon} className={cn("h-3.5 w-3.5 shrink-0", child ? "text-fg-3/50" : "text-fg-3")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", child ? "text-xs" : "text-sm font-medium")}>
          {row.mono && <span className="mr-1.5 font-mono text-[12.5px] font-medium">{row.mono}</span>}
          {row.title}
        </span>
        {row.subtitle && <span className="block truncate text-xs text-fg-3">{row.subtitle}</span>}
      </span>
      <RowTail row={row} selected={selected} isMobile={isMobile} />
    </button>
  );
}

/**
 * The palette's grouped results. Each section has its label (when it has
 * one) and its rows; a row's children follow it, indented, while they are
 * shown. Indices run across every section, in the order the keys move.
 */
export function PaletteResults({
  sections,
  showChildren,
  selectedIndex,
  isMobile,
  onActivate,
  onHover,
  register,
}: {
  sections: readonly PaletteSection[];
  showChildren: boolean;
  selectedIndex: number;
  isMobile: boolean;
  onActivate: (row: PaletteRow, index: number) => void;
  onHover: (index: number) => void;
  register: (index: number, el: HTMLButtonElement | null) => void;
}) {
  const shared = { isMobile, onActivate, onHover, register };
  const laidOut = sections.map((s) => ({ s, rows: s.rows.flatMap((r) => (showChildren && r.children ? [r, ...r.children] : [r])) }));
  const starts = laidOut.map((_, k) => laidOut.slice(0, k).reduce((n, l) => n + l.rows.length, 0));
  return (
    <div className="p-1" role="listbox" aria-label="Results">
      {laidOut.map(({ s, rows }, k) => (
        <div key={s.key} role="group" aria-label={s.label ?? undefined}>
          {s.label && <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-fg-3">{s.label}</div>}
          {rows.map((row, j) => {
            const i = starts[k] + j;
            return <Row key={`${row.id}-${i}`} row={row} index={i} selected={i === selectedIndex} nested {...shared} />;
          })}
        </div>
      ))}
    </div>
  );
}
