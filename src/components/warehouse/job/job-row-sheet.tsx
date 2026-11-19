"use client";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import type { Fact, LineRowData } from "@/lib/primitives/types";

const factText = (f: Fact | undefined): string => {
  if (!f) return "";
  if (f.kind === "qty") return f.of != null ? `${f.value}/${f.of}` : `${f.value}`;
  if (f.kind === "place") return f.label;
  return "";
};

/**
 * The phone's row sheet for a warehouse row (spec §9.4): status and case, name, tags and count, the
 * ACCESSORIES first (one line each with tier, state, case and its own action), then the row's own menu
 * under `More…`, and one primary action: tick the row so the sticky action bar above the bottom nav carries
 * the stage verb (the verb itself never lives in the sheet, so there is one path and one Undo).
 */
export function JobRowSheet({
  row, open, onOpenChange, selected, onToggleSelect,
}: {
  row: LineRowData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  if (!row) return null;
  const place = factText(row.facts.place);
  const qty = factText(row.facts.qty);
  const accessories = (row.children ?? []).filter((c) => c.kind === "accessory");
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={row.title} description={[row.status?.label, place].filter(Boolean).join(" · ")}>
      <div className="flex flex-col gap-3 px-4 pb-2" data-testid="job-row-sheet">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-muted">{(row.tags ?? []).join(" · ")}</span>
          <span className="t-mono text-ink text-lg">{qty}</span>
        </div>
        {accessories.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--r)] ring-1 ring-line" aria-label="Accessories">
            {accessories.map((a) => (
              <li key={a.id} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui-text text-ink">{a.title}</div>
                  <div className="truncate text-caption text-muted">
                    {[...(a.tags ?? []), a.status?.label, a.cells?.place ? String(a.cells.place) : factText(a.facts.place)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {a.primary && (
                  <Button size="sm" variant="line" className="min-h-11" onClick={() => void a.primary!.onSelect()}>
                    {a.primary.label}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button className="min-h-11 flex-1" variant={selected ? "line" : "primary"} onClick={() => { onToggleSelect(); onOpenChange(false); }}>
            {selected ? "Untick this row" : "Tick for the action bar"}
          </Button>
          {row.menu && <ActionMenu spec={row.menu} label={`${row.title}: More…`} />}
        </div>
      </div>
    </BottomSheet>
  );
}
