"use client";

import { useState } from "react";
import { Check, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DASHBOARD_WIDGET_REGISTRY, type DashboardWidgetKind } from "@/lib/dashboard-widgets";
import { cn, focusRing } from "@/lib/utils";

/**
 * Home's Customise-mode controls (UX Phase 11, §6c.3). Customise is entered from
 * the page ⋯ (`Customise…`, desktop only), so outside it this renders nothing.
 * While customising, the red primary becomes `Done` (`+ New job` steps aside, so
 * there is still one primary), with `Add widget` and `Reset layout` beside it.
 */
export function DashboardCustomizeBar({
  availableToAdd,
  onAddWidget,
  onReset,
  onDone,
}: {
  availableToAdd: DashboardWidgetKind[];
  onAddWidget: (kind: DashboardWidgetKind) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button variant="line">
            <Plus className="h-4 w-4" /> Add widget
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <p className="t-overline mb-2 text-muted">Add a widget</p>
          {availableToAdd.length === 0 ? (
            <p className="text-caption text-muted">Every widget is already on your board.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {availableToAdd.map((kind) => {
                const def = DASHBOARD_WIDGET_REGISTRY[kind];
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      onClick={() => {
                        onAddWidget(kind);
                        setAddOpen(false);
                      }}
                      className={cn("w-full rounded-[var(--r)] px-2.5 py-2 text-left transition-colors hover:bg-elev", focusRing)}
                    >
                      <p className="text-[13.5px] font-medium text-ink">{def.title}</p>
                      <p className="text-caption text-muted">{def.description}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <Button variant="line" onClick={onReset}>
        <RotateCcw className="h-4 w-4" /> Reset layout
      </Button>
      <Button variant="halo" onClick={onDone}>
        <Check className="h-4 w-4" /> Done
      </Button>
    </>
  );
}
