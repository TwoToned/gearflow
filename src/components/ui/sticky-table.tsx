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
   * 2nd+ frozen column knows its left offset. Full-width `colSpan` header/separator rows
   * are left alone (`:not([colspan])`), so they scroll rather than being wrongly pinned.
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
  const leftOffsets: number[] = [];
  let acc = 0;
  for (const w of frozenColWidths) {
    leftOffsets.push(acc);
    acc += w;
  }

  const css = React.useMemo(() => {
    const s = `.${uid} `;
    const stick = "position:sticky;background:var(--stkt-bg);z-index:1;";
    // Base rules apply at every width; they're benign on desktop.
    const base: string[] = [
      `.${uid}{position:relative;--stkt-bg:${safeBg};}`,
      `${s}.stkt-scroll{overflow-x:auto;overflow-y:visible;-webkit-overflow-scrolling:touch;}`,
      `${s}td{vertical-align:top;}`,
    ];
    // The frozen/scroll treatment is MOBILE ONLY. On desktop the table already fits, so
    // freezing columns there would (a) be pointless and (b) paint opaque frozen cells that
    // seam against row hover/selection/collab tints. Scoping to <768px keeps desktop a
    // plain table with no seam. Matches the app's `md` mobile cutover.
    const rows = `${s}tbody tr > `;
    const heads = `${s}thead tr > `;
    const mobile: string[] = [
      minTableWidth ? `${s}table{min-width:${minTableWidth}px;}` : "",
      // Header cells sit above scrolling body cells; frozen header cells above frozen body.
      `${s}thead tr > *{z-index:2;}`,
    ];
    // Freeze the first N cells of every row by nth-child. `:not([colspan])` leaves
    // full-width colSpan header/separator rows alone — a bare nth-child would pin their
    // single spanning cell as if it were the identity column.
    for (let i = 0; i < frozenCount; i++) {
      mobile.push(
        `${rows}:nth-child(${i + 1}):not([colspan]),${heads}:nth-child(${i + 1}):not([colspan]){${stick}left:${leftOffsets[i]}px;}`,
      );
    }
    for (let i = 0; i < frozenCount; i++) {
      mobile.push(`${heads}:nth-child(${i + 1}):not([colspan]){z-index:3;}`);
    }
    if (frozenCount > 0) {
      mobile.push(
        `${rows}:nth-child(${frozenCount}):not([colspan]),${heads}:nth-child(${frozenCount}):not([colspan]){box-shadow:8px 0 12px -8px rgba(0,0,0,.55);}`,
      );
    }

    // Print: undo everything so a print-oriented sheet reflows exactly as before.
    const print =
      `@media print{` +
      `${s}.stkt-scroll{overflow:visible!important;}` +
      `${s}table{min-width:0!important;}` +
      `${s}tbody tr > *,${s}thead tr > *{position:static!important;left:auto!important;background:transparent!important;box-shadow:none!important;z-index:auto!important;min-width:0!important;white-space:normal!important;vertical-align:initial!important;}` +
      `}`;
    return (
      base.filter(Boolean).join("") +
      `@media (max-width:767px){${mobile.filter(Boolean).join("")}}` +
      print
    );
  }, [uid, safeBg, minTableWidth, frozenCount, leftOffsets]);

  return (
    <div className={cn(uid, className)} {...rest}>
      {/* Scoped, print-aware styles for the frozen columns. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="stkt-scroll">{children}</div>
      {/* Right edge fade — a mobile scroll affordance; hidden on desktop and in print. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent md:hidden print:hidden"
      />
      {colCountHint != null && (
        <span className="absolute right-2 top-2 rounded-[8px] border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-faint md:hidden print:hidden">
          ↔ {colCountHint} cols
        </span>
      )}
    </div>
  );
}
