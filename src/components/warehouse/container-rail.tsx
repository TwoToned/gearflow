"use client";

import { Package, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { focusRing, cn } from "@/lib/utils";

export interface ContainerRailItem {
  id: string;
  label: string;
  parentContainerId?: string | null;
  unitCount: number;
}

export interface ContainerRailProps {
  /** Real `projectContainers.listForProject` rows for this job. */
  containers: ContainerRailItem[];
  /** `null` = Loose (no active container) is selected. */
  activeContainerId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  className?: string;
}

/** A container chip's indentation depth — nested chips sit under their
 *  parent (one level; #1296's containers can nest deeper, but the rail only
 *  shows the immediate parent/child relationship as a visual hint). */
function depthOf(item: ContainerRailItem, byId: Map<string, ContainerRailItem>): number {
  return item.parentContainerId && byId.has(item.parentContainerId) ? 1 : 0;
}

/**
 * The warehouse Pick/Prep container picker (#1296 build plan phase 2) —
 * replaces the free-text/creatable `ComboboxPicker` that used to key
 * `prepContainer` off an ad-hoc string. "Loose" (no active container, dashed)
 * is always first; exactly one chip is active at a time. Desktop: the Pick
 * tab's right column; mobile: a horizontal scroller — both use this same
 * component, the caller picks the wrapping layout via `className`.
 */
export function ContainerRail({ containers, activeContainerId, onSelect, onNew, className }: ContainerRailProps) {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const sorted = [...containers].sort((a, b) => depthOf(a, byId) - depthOf(b, byId));

  return (
    <div
      role="radiogroup"
      aria-label="Active packing container"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      <ContainerChip
        label="Loose"
        active={activeContainerId === null}
        dashed
        onClick={() => onSelect(null)}
      />
      {sorted.map((c) => (
        <ContainerChip
          key={c.id}
          label={c.label}
          unitCount={c.unitCount}
          indented={depthOf(c, byId) > 0}
          active={activeContainerId === c.id}
          onClick={() => onSelect(c.id)}
        />
      ))}
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-caption font-medium text-muted hover:bg-elev hover:text-ink",
          focusRing,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        New
      </button>
    </div>
  );
}

function ContainerChip({
  label,
  unitCount,
  active,
  dashed,
  indented,
  onClick,
}: {
  label: string;
  unitCount?: number;
  active: boolean;
  dashed?: boolean;
  indented?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-caption font-medium transition-colors",
        indented && "ml-3",
        active
          ? "border-transparent bg-ink text-paper"
          : dashed
            ? "border-dashed border-line text-muted hover:bg-elev"
            : "border-line bg-card text-ink-2 hover:bg-elev",
        focusRing,
      )}
    >
      <Package className="h-3.5 w-3.5" />
      {label}
      {unitCount != null && unitCount > 0 && (
        <Badge status="neutral" className={cn("h-4 min-w-4 px-1 text-micro tabular-nums", active && "bg-paper/20 text-paper")}>
          {unitCount}
        </Badge>
      )}
    </button>
  );
}
