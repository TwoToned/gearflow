"use client";

/**
 * Column width picker — preset buttons and custom slider for row column widths.
 * Shows visual rectangles representing the column split ratios.
 */
import { useCallback } from "react";
import { cn } from "@/lib/utils";

// ─── Presets ─────────────────────────────────────────────────────────────────

interface ColumnPreset {
  label: string;
  widths: number[];
}

const PRESETS: ColumnPreset[] = [
  { label: "Full", widths: [100] },
  { label: "50 / 50", widths: [50, 50] },
  { label: "60 / 40", widths: [60, 40] },
  { label: "40 / 60", widths: [40, 60] },
  { label: "70 / 30", widths: [70, 30] },
  { label: "30 / 70", widths: [30, 70] },
  { label: "33 / 33 / 33", widths: [33.33, 33.34, 33.33] },
  { label: "25 / 50 / 25", widths: [25, 50, 25] },
  { label: "25 / 25 / 25 / 25", widths: [25, 25, 25, 25] },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface ColumnWidthPickerProps {
  currentWidths: number[];
  onChange: (widths: number[]) => void;
  className?: string;
}

export function ColumnWidthPicker({
  currentWidths,
  onChange,
  className,
}: ColumnWidthPickerProps) {
  const isPresetActive = useCallback(
    (preset: ColumnPreset) => {
      if (preset.widths.length !== currentWidths.length) return false;
      return preset.widths.every(
        (w, i) => Math.abs(w - currentWidths[i]) < 1,
      );
    },
    [currentWidths],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">
        Column Layout
      </label>

      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map((preset) => {
          const active = isPresetActive(preset);
          return (
            <button
              key={preset.label}
              type="button"
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors",
                active
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/40 bg-bg-surface hover:border-border hover:bg-bg-surface/80",
              )}
              onClick={() => onChange(preset.widths)}
              title={preset.label}
            >
              {/* Visual preview */}
              <div className="flex w-full h-3 gap-px">
                {preset.widths.map((w, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-full rounded-[2px]",
                      active ? "bg-primary/40" : "bg-fg-4/20",
                    )}
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
              {/* Label */}
              <span className="text-[9px] text-fg-3 truncate w-full text-center">
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Custom width inputs for current columns */}
      {currentWidths.length > 1 && (
        <div className="mt-3 space-y-1.5">
          <label className="text-[10px] font-semibold text-fg-4 uppercase tracking-wider">
            Custom Widths
          </label>
          <div className="flex gap-1.5">
            {currentWidths.map((w, i) => (
              <div key={i} className="flex-1">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={10}
                    max={90}
                    step={5}
                    value={Math.round(w)}
                    onChange={(e) => {
                      const newVal = Math.max(10, Math.min(90, Number(e.target.value)));
                      const newWidths = [...currentWidths];
                      const diff = newVal - newWidths[i];
                      newWidths[i] = newVal;

                      // Distribute the difference to other columns
                      const otherCount = newWidths.length - 1;
                      if (otherCount > 0) {
                        const perOther = diff / otherCount;
                        for (let j = 0; j < newWidths.length; j++) {
                          if (j !== i) {
                            newWidths[j] = Math.max(10, newWidths[j] - perOther);
                          }
                        }
                      }

                      // Normalize to sum to 100
                      const sum = newWidths.reduce((a, b) => a + b, 0);
                      const normalized = newWidths.map((v) => (v / sum) * 100);
                      onChange(normalized);
                    }}
                    className="w-full rounded border border-border/40 bg-bg-surface px-1.5 py-0.5 text-xs text-fg text-center"
                  />
                  <span className="text-[9px] text-fg-4">%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
