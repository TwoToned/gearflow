"use client";

import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { focusRing, cn } from "@/lib/utils";
import type { ContainerRailItem } from "./container-rail";

export interface MoveToContainerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many real units this move will touch (already resolved via
   *  `resolveSelectionToUnitIds`) — 0 disables Move. */
  unitCount: number;
  containers: ContainerRailItem[];
  onConfirm: (containerId: string | null) => void;
  pending?: boolean;
}

function ContainerOption({
  label,
  unitCount,
  selected,
  dashed,
  onClick,
}: {
  label: string;
  unitCount?: number;
  selected: boolean;
  dashed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-[var(--r)] border px-3 py-2 text-left text-ui-text transition-colors",
        selected
          ? "border-transparent bg-ink text-paper"
          : dashed
            ? "border-dashed border-line text-muted hover:bg-elev"
            : "border-line hover:bg-elev",
        focusRing,
      )}
    >
      <span className="flex items-center gap-2">
        <Package className="h-4 w-4" />
        {label}
      </span>
      {unitCount != null && unitCount > 0 && (
        <Badge status="neutral" className={cn(selected && "bg-paper/20 text-paper")}>
          {unitCount}
        </Badge>
      )}
    </button>
  );
}

/**
 * #1296 Move-to… (build plan Phase 2) — reassign an already-resolved batch of
 * real unit ids to a different container, or to Loose. The confirm-and-write
 * half of `useProjectContainerWrites().moveUnits`; the caller resolves WHICH
 * units are moving (`resolveSelectionToUnitIds` in `warehouse-types.ts`)
 * before opening this dialog, so this component only ever deals in a plain
 * count + a container choice — no selection-key parsing here.
 *
 * Deliberately NOT `ContainerRail`: the rail always has exactly one chip
 * "active" (it mirrors live prep state), where this dialog starts with
 * NOTHING chosen each time it opens — reusing the rail's always-one-active
 * radiogroup would either falsely pre-select Loose or need a second
 * "nothing chosen yet" state the rail was never built to express.
 */
export function MoveToContainerDialog({
  open,
  onOpenChange,
  unitCount,
  containers,
  onConfirm,
  pending,
}: MoveToContainerDialogProps) {
  const [targetId, setTargetId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (open) setTargetId(undefined);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
          <DialogDescription>
            {unitCount === 0
              ? "Nothing in your selection can be moved right now."
              : `Move ${unitCount} item${unitCount === 1 ? "" : "s"} into a different container.`}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Move to container" className="max-h-64 space-y-1.5 overflow-y-auto">
          <ContainerOption label="Loose" dashed selected={targetId === null} onClick={() => setTargetId(null)} />
          {containers.map((c) => (
            <ContainerOption
              key={c.id}
              label={c.label}
              unitCount={c.unitCount}
              selected={targetId === c.id}
              onClick={() => setTargetId(c.id)}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => targetId !== undefined && onConfirm(targetId)}
            disabled={pending || unitCount === 0 || targetId === undefined}
            loading={pending}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
