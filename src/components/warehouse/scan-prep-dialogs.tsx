"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ScanAccessoryOption } from "./warehouse-types";

/** How a scan that needs a check form is handled. `ask` = not chosen yet. */
export type ScanCheckMode = "ask" | "inline" | "batch";

export interface ScanAccessoryPromptData {
  parentName: string;
  /** Parent already packed — only its accessories are left to prep. */
  parentPrepped: boolean;
  options: ScanAccessoryOption[];
}

export type ScanAccessoryDecision =
  | { kind: "with"; accessoryIds: string[] | undefined }
  | { kind: "without" }
  | { kind: "accessoriesOnly"; accessoryIds: string[] | undefined };

/**
 * Shown when a scanned parent has accessories on the job. The operator ticks the
 * accessories that are physically with it, then preps with them, without them,
 * or discards the scan. Mirrors Pick/Prep's "Prep" / "Prep without accessories" /
 * "Prep accessories only" actions.
 */
export function ScanAccessoryDialog({
  prompt,
  onDecide,
  onDiscard,
}: {
  prompt: ScanAccessoryPromptData;
  onDecide: (d: ScanAccessoryDecision) => void;
  onDiscard: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(prompt.options.map((o) => o.id)));
  const selected = prompt.options.filter((o) => checked.has(o.id));
  // All ticked = no narrowing, so the server's full roll-up applies unchanged.
  const accessoryIds =
    selected.length === prompt.options.length ? undefined : selected.flatMap((o) => o.assetIds);

  return (
    <Dialog open onOpenChange={(open) => !open && onDiscard()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm accessories</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{prompt.parentName}</span> has accessories on this job.
            Tick the ones that are with it.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {prompt.options.map((o) => (
            <li key={o.id}>
              <label className="flex items-center gap-2 text-ui-text text-ink cursor-pointer">
                <Checkbox
                  checked={checked.has(o.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(checked);
                    if (v) next.add(o.id);
                    else next.delete(o.id);
                    setChecked(next);
                  }}
                />
                <span>{o.name}</span>
                {o.optional && <span className="text-muted text-xs">optional</span>}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="line" size="sm" onClick={onDiscard}>
            Discard scan
          </Button>
          {prompt.parentPrepped ? (
            <Button
              size="sm"
              disabled={selected.length === 0}
              onClick={() => onDecide({ kind: "accessoriesOnly", accessoryIds })}
            >
              Prep accessories only ({selected.length})
            </Button>
          ) : (
            <>
              <Button variant="line" size="sm" onClick={() => onDecide({ kind: "without" })}>
                Prep without accessories
              </Button>
              <Button
                size="sm"
                disabled={selected.length === 0}
                onClick={() => onDecide({ kind: "with", accessoryIds })}
              >
                Prep with {selected.length} accessor{selected.length === 1 ? "y" : "ies"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** First time a scan needs a check form: do the checks now, or queue the scans. */
export function ScanCheckModeDialog({
  itemName,
  onChoose,
  onDiscard,
}: {
  itemName: string;
  onChoose: (mode: "inline" | "batch") => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDiscard()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run checks as you scan?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{itemName}</span> has checks to complete. Do them as you
            go, or keep scanning and run all the checks in one go afterwards.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="line" size="sm" onClick={onDiscard}>
            Discard scan
          </Button>
          <Button variant="line" size="sm" onClick={() => onChoose("batch")}>
            Bulk after scanning
          </Button>
          <Button size="sm" onClick={() => onChoose("inline")}>
            Check as I go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Checks-mode toggle plus the held "bulk after scanning" batch. */
export function ScanModeBar({
  mode,
  onModeChange,
  batchNames,
  onFinish,
  onClear,
}: {
  mode: ScanCheckMode;
  onModeChange: (m: ScanCheckMode) => void;
  batchNames: string[];
  onFinish: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-ui-text">
        <span className="text-muted">Checks:</span>
        <Button size="sm" variant={mode === "inline" ? "primary" : "line"} onClick={() => onModeChange("inline")}>
          As I scan
        </Button>
        <Button size="sm" variant={mode === "batch" ? "primary" : "line"} onClick={() => onModeChange("batch")}>
          Bulk after scanning
        </Button>
        {mode === "ask" && <span className="text-muted">Asked on the first scan that needs checks</span>}
      </div>
      {batchNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r)] ring-1 ring-line px-3 py-2">
          <span className="text-ui-text text-ink flex-1 min-w-0 truncate">
            {batchNames.length} scanned: {batchNames.join(", ")}
          </span>
          <Button size="sm" variant="line" onClick={onClear}>
            Clear
          </Button>
          <Button size="sm" onClick={onFinish}>
            Finish &amp; run checks ({batchNames.length})
          </Button>
        </div>
      )}
    </>
  );
}
