"use client";

import type { MouseEvent } from "react";
import { GripVertical } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusWord } from "@/components/ui/status-word";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { lineDisplayName, lineSubtitle, planGlyph } from "@/lib/packing-tab";
import type { LineItemData } from "@/components/projects/equipment-row-types";
import { cn } from "@/lib/utils";
import { useLineDrag } from "./packing-dnd";

const INTERACTIVE = "button, a, input, [role='checkbox'], [role='menu'], [data-no-open]";

/**
 * One plannable line on the Packing tab (§7b.2): title, muted
 * `Category · Kit · moves whole · Sub-hire · Custom`, `×qty`, the glyph rule
 * (`● Packed`; `Planned → LX-04` only when plan and reality disagree) and the
 * ⋯. Nothing is priced. The whole row toggles selection (the phone's tap and
 * the desktop's shift-click range); the grip (desktop only) drags it, and is
 * absent for a packed line or a line inside a sealed case, which cannot move.
 */
export function PackingLineRow({
  item,
  categoryName,
  labelById,
  selected,
  onToggle,
  canDrag,
  menu,
}: {
  item: LineItemData;
  categoryName: string;
  labelById: ReadonlyMap<string, string>;
  selected: boolean;
  onToggle: (opts: { range: boolean }) => void;
  canDrag: boolean;
  menu: ActionMenuSpec;
}) {
  const glyph = planGlyph(item, labelById);
  const { setNodeRef, isDragging, gripProps } = useLineDrag(item.id, !canDrag);
  const name = lineDisplayName(item);

  const onRowClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onToggle({ range: e.shiftKey });
  };

  return (
    <div
      ref={setNodeRef}
      data-testid={`packing-row-${item.id}`}
      data-selected={selected || undefined}
      onClick={onRowClick}
      className={cn(
        "flex min-h-16 items-center gap-2 border-b border-line px-1 last:border-b-0 md:min-h-[46px]",
        "cursor-default hover:bg-elev/60",
        selected && "bg-elev",
        isDragging && "opacity-40",
      )}
    >
      <Checkbox checked={selected} onCheckedChange={() => onToggle({ range: false })} aria-label={`Select ${name}`} />
      {canDrag ? (
        <button
          type="button"
          aria-label={`Drag ${name}`}
          className="hidden h-8 w-5 shrink-0 cursor-grab touch-none place-items-center text-faint hover:text-ink-2 active:cursor-grabbing md:grid"
          {...gripProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span aria-hidden="true" className="hidden w-5 shrink-0 md:block" />
      )}
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-ui-text font-medium text-ink">{name}</span>
          {glyph.packed && <StatusWord status={{ label: "Packed", intent: "success" }} className="text-caption" />}
        </div>
        <p className="truncate text-caption text-muted">
          {lineSubtitle(item, categoryName)}
          {glyph.plannedElsewhere && <span className="ml-1.5 text-ink-2">· {glyph.plannedElsewhere}</span>}
        </p>
      </div>
      <span className="t-mono shrink-0 text-muted">×{item.quantity}</span>
      {menu.items.length > 0 ? <ActionMenu spec={menu} label={`${name} actions`} /> : <span aria-hidden="true" className="w-10 shrink-0" />}
    </div>
  );
}
