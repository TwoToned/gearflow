"use client";

import * as React from "react";
import { useFormatters } from "@/components/providers/format-provider";
import type { TotalLine } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * `FooterTotals` — one muted footer line of derived totals (spec §5.6). The
 * caller derives every `TotalLine` (FEATUREDOCS/74); nothing here is stored or
 * summed. A `null` amount renders blank (`—`), never `$0` (CLAUDE.md "$0 is a
 * PRICE"). Render it once per tab, in the list footer.
 */
export function FooterTotals({
  lines,
  className,
}: {
  lines: TotalLine[];
  className?: string;
}) {
  const { formatCurrency } = useFormatters();
  if (lines.length === 0) return null;
  return (
    <dl
      aria-label="Totals"
      className={cn(
        "flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 border-t border-line px-1 pt-3 text-caption text-muted tabular-nums",
        className,
      )}
    >
      {lines.map((l) => (
        <div key={l.label} className="flex items-baseline gap-2">
          <dt>{l.label}</dt>
          <dd className="font-medium text-ink-2">{formatCurrency(l.amount)}</dd>
          {l.note ? <dd className="text-muted">{l.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
