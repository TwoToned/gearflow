"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { blankableNumber } from "@/lib/validations/blankable";
import { z } from "zod";

const levelSchema = blankableNumber(z.number().int().min(0));

/** The field's value: blank (clear), a whole number >= 0, or invalid. Blank is NEVER 0. */
function parseLevel(raw: string): { kind: "blank" } | { kind: "value"; value: number } | { kind: "invalid" } {
  const r = levelSchema.safeParse(raw.trim());
  if (!r.success) return { kind: "invalid" };
  return r.data === undefined ? { kind: "blank" } : { kind: "value", value: r.data };
}

export interface ReorderTarget {
  id: string;
  name: string;
  reorderLevel: number | null;
}

const titleOf = (t: ReorderTarget[] | null): string =>
  t && t.length > 1 ? `Set reorder level — ${t.length} models` : `Set reorder level — ${t?.[0]?.name ?? ""}`;

/** `Now: 20.` for a single model that has a level. */
const nowText = (t: ReorderTarget[] | null): string => (t && t.length === 1 && t[0].reorderLevel != null ? ` Now: ${t[0].reorderLevel}.` : "");

/**
 * `Set reorder level…` (row ⋯ and bulk): one whole number applied to each model, or blank to clear
 * (an unset level is never 0). The page owns the write and its Undo.
 */
export function ReorderLevelDialog({
  targets,
  onClose,
  onSave,
}: {
  /** Null = closed. */
  targets: ReorderTarget[] | null;
  onClose: () => void;
  onSave: (targets: ReorderTarget[], level: number | null) => Promise<void>;
}) {
  const [raw, setRaw] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const parsed = parseLevel(raw);

  const save = async () => {
    if (!targets || parsed.kind === "invalid") return;
    setPending(true);
    try {
      await onSave(targets, parsed.kind === "blank" ? null : parsed.value);
      setRaw("");
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={targets !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{titleOf(targets)}</DialogTitle>
          <DialogDescription>
            An item reads as Low stock when what is available is at or under this number. Leave it blank to clear the level (blank is not 0).
            {nowText(targets)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="reorder-level">Reorder at</Label>
          <Input id="reorder-level" type="number" step="1" min="0" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="e.g. 20" autoFocus />
          {parsed.kind === "invalid" && <p className="text-caption text-error">Enter a whole number of 0 or more, or leave it blank.</p>}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending} disabled={parsed.kind === "invalid"}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
