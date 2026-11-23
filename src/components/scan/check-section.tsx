"use client";

import { Lock } from "lucide-react";

import { CHECK_CONDITION_VALUE, type CheckConditionValue, type CheckConditionWord } from "../../../convex/lib/assetCondition";
import type { CheckItemData, CheckState, CheckStates } from "@/lib/check-item-state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CheckItemFields } from "@/components/warehouse/check-item-fields";

const WORDS: CheckConditionWord[] = ["Good", "Worn", "Damaged"];

/**
 * Check mode's inline form (spec §9i.2): the model's items in order through the
 * shared `CheckItemFields` (Pass/Fail, measurement, dropdown, note; a FAIL needs a
 * reason and a photo), `Pass all` in the section head, then Condition `Good Worn
 * Damaged` (forced and locked to Damaged by any fail, D50) and the check's Notes.
 */
export function CheckSection({
  items,
  states,
  onUpdate,
  onFailPhotoUploadingChange,
  canPassAll,
  onPassAll,
  condition,
  conditionLocked,
  onCondition,
  notes,
  onNotes,
}: {
  items: CheckItemData[] | undefined;
  states: CheckStates;
  onUpdate: (checkItemId: string, updates: Partial<CheckState>) => void;
  onFailPhotoUploadingChange: (checkItemId: string, uploading: boolean) => void;
  canPassAll: boolean;
  onPassAll: () => void;
  condition: CheckConditionValue;
  conditionLocked: boolean;
  onCondition: (c: CheckConditionValue) => void;
  notes: string;
  onNotes: (n: string) => void;
}) {
  const answered = items ? items.filter((i) => i.checkItem.type === "NOTES" || states[i.checkItem.id]?.result).length : 0;
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="scan-checks-head" className="flex flex-col gap-2">
        <div className="flex min-h-11 items-center gap-2 border-b border-line">
          <h2 id="scan-checks-head" className="flex-1 text-ui-text font-semibold text-ink">
            Checks{" "}
            {items ? <span className="font-mono text-caption text-muted tabular-nums">{answered}/{items.length}</span> : null}
          </h2>
          {canPassAll ? (
            <Button variant="ghost" size="sm" onClick={onPassAll}>
              Pass all
            </Button>
          ) : null}
        </div>
        {items ? (
          <div className="flex flex-col gap-1">
            <CheckItemFields items={items} states={states} onUpdate={onUpdate} onFailPhotoUploadingChange={onFailPhotoUploadingChange} />
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-20 rounded-[var(--r)]" />
            <Skeleton className="h-20 rounded-[var(--r)]" />
          </div>
        )}
      </section>

      <section aria-labelledby="scan-condition-head" className="flex flex-col gap-2">
        <h2 id="scan-condition-head" className="text-ui-text font-semibold text-ink">Condition</h2>
        <div role="radiogroup" aria-labelledby="scan-condition-head" className="flex items-center gap-4 text-ui-text">
          {WORDS.map((w) => {
            const value = CHECK_CONDITION_VALUE[w];
            const active = condition === value;
            return (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={conditionLocked && !active}
                onClick={() => onCondition(value)}
                className={cn(
                  "min-h-11 border-b-2 px-1 font-medium disabled:opacity-50 [@media(pointer:fine)]:min-h-8",
                  active ? "border-ink text-ink" : "border-transparent text-muted",
                )}
              >
                {w}
              </button>
            );
          })}
        </div>
        {conditionLocked ? (
          <p className="flex items-center gap-1.5 text-caption text-muted">
            <Lock aria-hidden="true" className="size-3.5" /> Locked to Damaged: an item failed.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="scan-notes-head" className="flex flex-col gap-2">
        <h2 id="scan-notes-head" className="text-ui-text font-semibold text-ink">Notes</h2>
        <Textarea
          aria-labelledby="scan-notes-head"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="Anything about this asset (shown in its activity)"
          rows={2}
          maxLength={2000}
          className="text-reading-body md:text-ui-text"
        />
      </section>
    </div>
  );
}
