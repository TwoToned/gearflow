"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { CONTAINER_KIND_WORDS } from "@/lib/packing-tab";
import { cn } from "@/lib/utils";
import { useCaseDrop, useIsDragging } from "./packing-dnd";

/** Lines a card shows before `Show n more` (§7b.2). */
export const CARD_COLLAPSED_LINES = 6;
/** Rows one `Show n more` click reveals. */
const SHOW_MORE_STEP = 5;

interface CaseHeaderProps {
  label: string;
  kind?: keyof typeof CONTAINER_KIND_WORDS;
  parentLabel?: string | null;
  sealed: boolean;
  lineCount: number;
  packedCount: number;
  menu?: ActionMenuSpec;
  checked: boolean | "indeterminate";
  onCheckedChange: (on: boolean) => void;
}

function CaseHeader({ label, kind, parentLabel, sealed, lineCount, packedCount, menu, checked, onCheckedChange }: CaseHeaderProps) {
  const counts = `${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${packedCount} packed`;
  return (
    <header className="flex min-h-11 items-center gap-1 bg-paper-2/60 py-1 pl-1 pr-1">
      {/* A sealed card's lines cannot move, so the card offers nothing to tick. */}
      {lineCount > 0 && !sealed && <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} aria-label={`Select all in ${label}`} />}
      <div className={cn("flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2", (lineCount === 0 || sealed) && "pl-2")}>
        <span className="truncate font-mono text-ui-text font-semibold text-ink">{label}</span>
        {kind && <span className="text-caption text-muted">{CONTAINER_KIND_WORDS[kind]}</span>}
        {parentLabel && <span className="text-caption text-muted">· in {parentLabel}</span>}
        <span className="t-mono text-muted">{counts}</span>
        {sealed && (
          <span className="inline-flex items-center gap-1 text-caption font-medium text-ink-2">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Sealed
          </span>
        )}
      </div>
      {menu && menu.items.length > 0 && <ActionMenu spec={menu} label={`${label} actions`} />}
    </header>
  );
}

function dropClasses(dragging: boolean, isOver: boolean, sealed: boolean): string {
  if (isOver) return sealed ? "border-red/60 bg-red-soft/30" : "border-ink bg-elev/50";
  return dragging && !sealed ? "border-dashed border-ink-2/40" : "";
}

/**
 * A case card (§7b.2): the case name in mono, its kind muted, `· in LX-02`
 * when nested, `11 lines · 3 packed`, a header checkbox that ticks the card's
 * lines, a `Sealed` dot-word when locked, and the ⋯ (absent without
 * `project:manage_line_items`). The whole card is a drop target; a sealed one
 * stays a target so the drop can be refused with a toast naming Unseal. Rows
 * beyond the first six sit behind `Show 5 more · 5 left`.
 */
export function CaseCard({
  caseId,
  rows,
  expanded,
  onExpandedChange,
  ...header
}: CaseHeaderProps & {
  caseId: string;
  rows: ReactNode[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { setNodeRef, isOver } = useCaseDrop(caseId);
  const dragging = useIsDragging();
  // `Show 5 more` reveals five more rows, not the whole case; "Show every line" (the ⋯,
  // `expanded`) reveals all.
  const [extra, setExtra] = useState(0);
  const visibleCount = expanded ? rows.length : CARD_COLLAPSED_LINES + extra;
  const shown = rows.slice(0, visibleCount);
  const left = rows.length - visibleCount;
  const collapsible = rows.length > CARD_COLLAPSED_LINES;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Case ${header.label}`}
      data-testid={`case-card-${caseId}`}
      data-sealed={header.sealed || undefined}
      className={cn("overflow-hidden rounded-[var(--r-lg)] border border-line transition-colors", dropClasses(dragging, isOver, header.sealed))}
    >
      <CaseHeader {...header} />
      {header.lineCount === 0 ? <p className="px-3 py-3 text-caption text-muted">Nothing planned in this case</p> : shown}
      {header.lineCount > 0 && collapsible && (
        <button
          type="button"
          onClick={() => {
            if (left > 0) setExtra((n) => n + SHOW_MORE_STEP);
            else {
              setExtra(0);
              onExpandedChange(false);
            }
          }}
          className="min-h-11 w-full border-t border-line px-3 py-2 text-left text-caption font-medium text-muted hover:bg-elev/60 hover:text-ink"
        >
          {left > 0 ? `Show ${Math.min(SHOW_MORE_STEP, left)} more · ${left} left` : "Show fewer lines"}
        </button>
      )}
    </section>
  );
}
