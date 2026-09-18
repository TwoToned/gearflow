"use client";

import { useState } from "react";
import { LayoutGrid, Check, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DASHBOARD_WIDGET_REGISTRY, type DashboardWidgetKind } from "@/lib/dashboard-widgets";
import { cn, focusRing } from "@/lib/utils";

/**
 * The dashboard's Customize-mode controls (#1267) — a page-header action
 * alongside "New job"/"Warehouse"/"Add gear". Default view has no drag
 * handles, resize corners or remove buttons (`editMode=false` everywhere in
 * `<DashboardGrid>`); entering Customize reveals them plus this bar's "Add
 * widget" popover and "Reset to default".
 */
export function DashboardCustomizeBar({
  editMode,
  onToggleEditMode,
  availableToAdd,
  onAddWidget,
  onReset,
}: {
  editMode: boolean;
  onToggleEditMode: () => void;
  availableToAdd: DashboardWidgetKind[];
  onAddWidget: (kind: DashboardWidgetKind) => void;
  onReset: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  if (!editMode) {
    return (
      <Button variant="line" onClick={onToggleEditMode}>
        <LayoutGrid className="h-4 w-4" /> Customize
      </Button>
    );
  }

  return (
    <>
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button variant="line" disabled={availableToAdd.length === 0}>
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
                      className={cn(
                        "w-full rounded-[var(--r)] px-2.5 py-2 text-left transition-colors hover:bg-elev",
                        focusRing,
                      )}
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
        <RotateCcw className="h-4 w-4" /> Reset to default
      </Button>
      <Button variant="halo" onClick={onToggleEditMode}>
        <Check className="h-4 w-4" /> Done
      </Button>
    </>
  );
}
