"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

/** What the next received scan / `Return` is saved as. Notes only appear for a bad condition. */
export function ReturnConditionBar({
  condition, notes, onCondition, onNotes,
}: {
  condition: ReturnCondition;
  notes: string;
  onCondition: (c: ReturnCondition) => void;
  onNotes: (n: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="return-condition" className="text-ui-text">Condition:</Label>
        <select
          id="return-condition"
          value={condition}
          onChange={(e) => onCondition(e.target.value as ReturnCondition)}
          className="flex h-11 rounded-[var(--r)] border-2 border-input bg-transparent px-3 py-1 text-ui-text text-ink"
        >
          <option value="GOOD">Good</option>
          <option value="DAMAGED">Damaged</option>
          <option value="MISSING">Missing</option>
        </select>
      </div>
      {condition !== "GOOD" && (
        <div className="min-w-48 flex-1">
          <Textarea placeholder="Notes about damage or missing items..." value={notes} onChange={(e) => onNotes(e.target.value)} rows={2} className="text-ui-text" />
        </div>
      )}
    </div>
  );
}
