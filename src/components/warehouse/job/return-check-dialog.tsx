"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ReturnConditionValue } from "./job-types";

export type ReturnCheckResult = { condition: ReturnConditionValue; notes: string };

const CONDITIONS: Array<{ value: ReturnConditionValue; label: string }> = [
  { value: "GOOD", label: "Good" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "MISSING", label: "Missing" },
];

/**
 * The return check (§9.5): what condition did this gear come back in? One answer covers the ticked rows
 * (accessory units included, through the unit-level RETURN with the same condition, so `Missing` takes
 * the existing missing path). Notes are optional and only offered for a bad condition. Used to return the
 * selection, or (`scanDefault`) to set what the dock's received scans are saved as.
 */
export function ReturnCheckDialog({
  count, scanDefault = false, initial, onConfirm, onCancel,
}: {
  /** Rows the check applies to (ignored for `scanDefault`). */
  count: number;
  scanDefault?: boolean;
  initial: ReturnCheckResult;
  onConfirm: (r: ReturnCheckResult) => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState<ReturnConditionValue>(initial.condition);
  const [notes, setNotes] = useState(initial.notes);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{scanDefault ? "Scans save as" : "Return check"}</DialogTitle>
          <DialogDescription>
            {scanDefault ? "The condition the next received scans are saved with." : `What condition did the ${count} selected item${count === 1 ? "" : "s"} come back in?`}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Return condition" className="flex flex-wrap gap-2">
          {CONDITIONS.map((c) => (
            <Button
              key={c.value} type="button" role="radio" aria-checked={condition === c.value}
              variant={condition === c.value ? "primary" : "line"} onClick={() => setCondition(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </div>
        {condition !== "GOOD" && (
          <Textarea aria-label="Notes about damage or missing items" placeholder="Notes about damage or missing items..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-ui-text" />
        )}
        <DialogFooter>
          <Button variant="line" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm({ condition, notes: condition === "GOOD" ? "" : notes })}>{scanDefault ? "Save" : "Return"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
