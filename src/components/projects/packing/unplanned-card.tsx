"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { UNPLANNED_LABEL } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";
import { useCaseDrop, useIsDragging } from "./packing-dnd";

/**
 * The Unplanned card (§7b.2): one dashed card, sticky on the left of the
 * desktop layout and first on the phone. A drop target (`null` case): dropping
 * a line here un-plans it. Titled `Unplanned`, not `Loose`: this is a PLAN
 * state; Loose is the PHYSICAL state (gear not in a case).
 */
export function UnplannedCard({
  count,
  rows,
  checked,
  onCheckedChange,
  emptyText,
}: {
  count: number;
  rows: ReactNode[];
  checked: boolean | "indeterminate";
  onCheckedChange: (on: boolean) => void;
  /** `Every line has a case` (nothing unplanned) or `No lines match that` (filters). */
  emptyText: string;
}) {
  const { setNodeRef, isOver } = useCaseDrop(null);
  const dragging = useIsDragging();
  return (
    <section
      ref={setNodeRef}
      aria-label={UNPLANNED_LABEL}
      data-testid="unplanned-card"
      className={cn(
        "overflow-hidden rounded-[var(--r-lg)] border border-dashed border-line transition-colors md:sticky md:top-4 md:max-h-[calc(100vh-8rem)] md:overflow-y-auto",
        dragging && "border-ink-2/40",
        isOver && "border-ink bg-elev/50",
      )}
    >
      <header className="flex min-h-11 items-center gap-1 bg-paper-2/60 py-1 pl-1 pr-3">
        {count > 0 && <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} aria-label={`Select all ${UNPLANNED_LABEL}`} />}
        <span className={cn("text-ui-text font-semibold text-ink", count === 0 && "pl-2")}>{UNPLANNED_LABEL}</span>
        <span className="t-mono ml-auto text-muted">{count}</span>
      </header>
      {count === 0 ? <p className="px-3 py-4 text-caption text-muted">{emptyText}</p> : rows}
    </section>
  );
}
