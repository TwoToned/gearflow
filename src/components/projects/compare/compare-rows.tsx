"use client";

import { intentStyles, type ColorIntent } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import {
  STATE_INTENT,
  money,
  stateBadgeLabel,
  type CompareGroup,
  type CompareRow,
  type Ghost,
  type RowSnapshot,
} from "@/components/projects/compare/compare-model";

/**
 * The Compare sheet's row table (D49-D51): rows grouped by category, changed
 * cells printed `old → new`, a ghost where a moved row used to sit. The sheet
 * itself is the ONE scroll container (D46), so this table does not scroll.
 */

type RegisterRow = (key: string, el: HTMLTableRowElement | null) => void;

function Th({ children, align }: { children?: React.ReactNode; align?: "right" }) {
  return <th className={cn("px-3 py-2 text-caption font-semibold text-muted", align === "right" && "text-right")}>{children}</th>;
}

export function CompareRowsTable({
  groups,
  viewMode,
  registerRow,
  activeKey,
}: {
  groups: CompareGroup[];
  viewMode: "all" | "changes";
  registerRow: RegisterRow;
  activeKey: string | undefined;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card">
      <table className="w-full border-collapse">
        <thead className="bg-card">
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

function RowGroup({ label, rows, registerRow, activeKey }: { label: string; rows: (CompareRow | Ghost)[]; registerRow: RegisterRow; activeKey: string | undefined }) {
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

/** Static class lookup, not a template-built string: Tailwind's JIT scanner
 *  only picks up class names it can see literally in source. */
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
  return cn("outline-none focus-visible:ring-2 focus-visible:ring-red", !changed && "opacity-55", changed && ROW_EDGE_CLASS[intent], isActive && "bg-elev");
}

function RowStatePill({ row, intent }: { row: CompareRow; intent: ColorIntent }) {
  if (row.state === "unchanged") return null;
  const text = row.state === "moved" ? `Moved from ${row.movedFromCategoryLabel ?? "—"}` : stateBadgeLabel(row.state);
  return <span className={cn("rounded-full px-1.5 py-0.5 text-badge font-semibold", intentStyles[intent].pill)}>{text}</span>;
}

function RowLabelCell({ row, intent }: { row: CompareRow; intent: ColorIntent }) {
  const label = row.b?.label ?? row.a?.label ?? "—";
  return (
    <td className="px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("text-table-cell", row.state === "removed" && "text-muted line-through")}>{label}</span>
        <RowStatePill row={row} intent={intent} />
        {row.alsoRepriced && <span className="text-caption text-muted">also repriced</span>}
      </div>
    </td>
  );
}

/** `snap?.[field] ?? null` as a call: keeps the optional-chain and the nullish
 *  coalesce (two decision points each, six times over) off `CompareRowView`'s
 *  complexity budget (POLICY.md R-3.6). */
function numField(snap: RowSnapshot | null, field: "quantity" | "unitPrice" | "lineTotal"): number | null {
  return snap?.[field] ?? null;
}

function CompareRowView({ row, isActive, registerRow }: { row: CompareRow; isActive: boolean; registerRow: RegisterRow }) {
  const intent = STATE_INTENT[row.state] ?? "neutral";
  return (
    <tr ref={(el) => registerRow(row.key, el)} tabIndex={-1} className={rowClassName(row, intent, isActive)}>
      <td />
      <RowLabelCell row={row} intent={intent} />
      <td className="px-3 py-1.5 text-right font-mono text-table-cell tabular-nums">
        <OldNewCell oldVal={numField(row.a, "quantity")} newVal={numField(row.b, "quantity")} state={row.state} format={String} />
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

function fmtOrDash(v: number | null, format: (n: number) => string): string {
  return v != null ? format(v) : "—";
}

const DIFFABLE_STATES = new Set(["changed", "moved"]);

/** D51: for a CHANGED row only the differing cells show `old → new`; an
 *  unchanged cell on an otherwise-changed row prints its one value. */
function OldNewCell({ oldVal, newVal, state, format }: { oldVal: number | null; newVal: number | null; state: string; format: (n: number) => string }) {
  if (state === "added") return <>{fmtOrDash(newVal, format)}</>;
  if (state === "removed") {
    return (
      <>
        <span className="text-muted line-through">{fmtOrDash(oldVal, format)}</span> <span className="text-t-out">→ 0</span>
      </>
    );
  }
  if (DIFFABLE_STATES.has(state) && (oldVal ?? null) !== (newVal ?? null)) {
    return (
      <>
        <span className="text-muted line-through">{fmtOrDash(oldVal, format)}</span> <span className="text-warn">→ {fmtOrDash(newVal, format)}</span>
      </>
    );
  }
  return <>{newVal != null ? fmtOrDash(newVal, format) : fmtOrDash(oldVal, format)}</>;
}
