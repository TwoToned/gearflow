"use client";

import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * The shared furniture behind the Overview tab's paired finance cards (#1061).
 *
 * The quote and invoicing cards are peers and have to READ as peers — same
 * header rule, same amount size, same meta-row alignment, same action footer.
 * Duplicating those classNames across two files is how two cards drift half a
 * pixel apart and start looking like an accident.
 */

export function OverviewCardHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h3 className="text-card-title font-bold tracking-tight text-ink">{title}</h3>
      {badge}
    </div>
  );
}

/**
 * The card's headline figure. A null value renders a faint em-dash rather than
 * "$0.00" — nothing quoted and zero dollars quoted are different facts.
 */
export function OverviewAmount({
  value,
  suffix,
  tone = "default",
}: {
  value: number | null;
  suffix?: string;
  tone?: "default" | "ok";
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <span
        className={cn(
          "font-display text-[26px] font-extrabold leading-none tracking-[-0.035em] tabular-nums",
          value == null ? "text-faint" : tone === "ok" ? "text-ok" : "text-ink",
        )}
      >
        {value == null ? "—" : formatCurrency(value)}
      </span>
      {suffix && value != null && <span className="text-caption font-semibold text-faint">{suffix}</span>}
    </p>
  );
}

export interface OverviewMetaRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

/** Label/value rows under the headline. `null` entries drop out entirely, so a
 *  card never shows a stack of "—" placeholders for facts that don't exist. */
export function OverviewMetaList({ rows }: { rows: (OverviewMetaRow | null | false)[] }) {
  const visible = rows.filter((r): r is OverviewMetaRow => Boolean(r));
  if (visible.length === 0) return null;
  return (
    <dl className="mt-3 space-y-0.5">
      {visible.map((row, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 text-caption">
          <dt className="text-muted">{row.label}</dt>
          <dd className="m-0 text-right font-medium text-ink-2 tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OverviewActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">{children}</div>;
}
