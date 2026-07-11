"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StickyTable — a horizontally-scrollable data table with a frozen identity column,
 * for mobile ("Notion-style": the row label stays put while the rest scrolls sideways).
 *
 * Design notes (from the mobile data-table framework, §3D / P2):
 *  - It **owns its single scroll container**. Do NOT feed it `ui/table.tsx`'s `<Table>`,
 *    which already wraps itself in `overflow-auto` — nesting scrollers breaks the sticky
 *    column and the edge fade. Pass the raw `<table>` (with TableHeader/Body/Row/Cell/Head
 *    used *without* the outer <Table> wrapper is fine too, but simplest: plain table
 *    elements or the *cell* primitives inside a `<table>` you render).
 *  - Freezing is applied by column *position* via scoped CSS: the first `frozenColWidths.length`
 *    cells of every row become `position: sticky` with cumulative left offsets. A short
 *    shadow marks the seam so scrolling columns visibly pass *under* the frozen ones.
 *  - Rows are `vertical-align: top` so wrapping cells grow the row downward and never overlap
 *    (smart wrapping). Callers choose which columns wrap (`whitespace-normal` + a max width)
 *    vs stay compact (`whitespace-nowrap`).
 *  - **Print-safe:** every enhancement (scroll, sticky, min-width, fade) is reset under
 *    `@media print`, so a print-oriented sheet renders exactly as it did before.
 */
export interface StickyTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Pixel widths of the frozen left columns, in order. One entry per frozen column.
   * Defaults to a single frozen column (`[]` freezes none). Widths are needed so the
   * 2nd+ frozen column knows its left offset.
   */
  frozenColWidths?: number[];
  /** Minimum width of the inner table on screen — forces horizontal scroll below it. */
  minTableWidth?: number;
  /** Solid background for the frozen cells; must match the surface behind the table. */
  frozenBg?: string;
  /** Optional "↔ N cols" affordance shown top-right (screen only). */
  colCountHint?: number;
  children: React.ReactNode;
}

export function StickyTable({
  frozenColWidths = [0],
  minTableWidth,
  frozenBg = "var(--paper)",
  colCountHint,
  className,
  children,
  ...rest
}: StickyTableProps) {
  const rawId = React.useId();
  const uid = "stkt" + rawId.replace(/[^a-zA-Z0-9]/g, "");

  // frozenBg is interpolated into a <style> via dangerouslySetInnerHTML. Restrict it
  // to safe CSS color/var characters so no caller (present or future) can break out of
  // the style element with something like `red}</style><script>`.
  const safeBg = /^[a-zA-Z0-9#(),.%\s_-]+$/.test(frozenBg) ? frozenBg : "var(--paper)";

  const frozenCount = frozenColWidths.length;
  // Cumulative left offsets: col i sits at the sum of the widths before it.
  const offsets: number[] = [];
  let acc = 0;
  for (const w of frozenColWidths) {
    offsets.push(acc);
    acc += w;
  }

  const css = React.useMemo(() => {
    const rows = `.${uid} tbody tr > `;
    const heads = `.${uid} thead tr > `;
    const parts: string[] = [
      `.${uid}{position:relative;--stkt-bg:${safeBg};}`,
      `.${uid} .stkt-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;}`,
      minTableWidth ? `.${uid} table{min-width:${minTableWidth}px;}` : "",
      `.${uid} td{vertical-align:top;}`,
    ];
    for (let i = 0; i < frozenCount; i++) {
      const n = i + 1;
      const left = offsets[i];
      parts.push(
        `${rows}:nth-child(${n}),${heads}:nth-child(${n}){position:sticky;left:${left}px;background:var(--stkt-bg);z-index:1;}`,
      );
    }
    // Header cells (including frozen ones) sit above body cells.
    parts.push(`${heads}*{z-index:2;}`);
    for (let i = 0; i < frozenCount; i++) {
      parts.push(`${heads}:nth-child(${i + 1}){z-index:3;}`);
    }
    // Seam shadow on the last frozen column.
    if (frozenCount > 0) {
      parts.push(
        `${rows}:nth-child(${frozenCount}),${heads}:nth-child(${frozenCount}){box-shadow:8px 0 12px -8px rgba(0,0,0,.55);}`,
      );
    }
    // Print: undo everything so the physical sheet is unchanged. This also resets the
    // cell min-width / white-space / vertical-align that consumers add for the on-screen
    // scroll layout, so the printed table reflows exactly as it did before StickyTable.
    parts.push(
      `@media print{` +
        `.${uid} .stkt-scroll{overflow:visible!important;}` +
        `.${uid} table{min-width:0!important;}` +
        `.${uid} tbody tr > *,.${uid} thead tr > *{position:static!important;left:auto!important;background:transparent!important;box-shadow:none!important;z-index:auto!important;min-width:0!important;white-space:normal!important;vertical-align:initial!important;}` +
        `}`,
    );
    return parts.filter(Boolean).join("");
  }, [uid, safeBg, minTableWidth, frozenCount, offsets]);

  return (
    <div className={cn(uid, className)} {...rest}>
      {/* Scoped, print-aware styles for the frozen columns. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="stkt-scroll">{children}</div>
      {/* Right edge fade — a scroll affordance; hidden in print. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent print:hidden"
      />
      {colCountHint != null && (
        <span className="absolute right-2 top-2 rounded-[8px] border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-faint print:hidden">
          ↔ {colCountHint} cols
        </span>
      )}
    </div>
  );
}
