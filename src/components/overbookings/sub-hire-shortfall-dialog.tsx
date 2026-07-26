"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { OverbookingProjectRef } from "@/hooks/use-native-overbooking-board";

/**
 * Prefilled sub-hire prompt for a hard-overbooked gear row (WS3 #942 spec:
 * "prefilled sub-hire dialog — reuse checkSubHireOpportunity shape... but the
 * board query returns what the dialog needs — no N server actions"). The
 * board's `computeGearShortageBoard` already computed the shortfall qty and
 * every contributing project, so this dialog is pure presentation — it does
 * NOT call `checkSubHireOpportunity` (that would be one server action per
 * row); it mirrors that function's `{ modelId, modelName, shortfall }` shape
 * with data the board already fetched in ONE round trip.
 *
 * There's no standalone "create a sub-hire" entry point outside a project
 * (sub-hires are always scoped to one project's equipment tab —
 * `sub-hire-order-dialog.tsx`), so the action here is: pick which contributing
 * project to open, then add the sub-hire from that project's Equipment tab as
 * normal.
 */
export function SubHireShortfallDialog({
  open,
  onOpenChange,
  modelName,
  shortfallQty,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  shortfallQty: number;
  projects: OverbookingProjectRef[];
}) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-t-out" />
            Sub-hire {modelName}?
          </DialogTitle>
          <DialogDescription>
            {shortfallQty} unit{shortfallQty === 1 ? "" : "s"} short across the jobs below. Open one of them
            and add a sub-hire line from its Equipment tab to cover the gap.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {projects.length === 0 ? (
            <p className="t-micro text-muted">No contributing projects to show.</p>
          ) : (
            projects.map((p) => (
              <Button
                key={p.id}
                variant="line"
                className="justify-between"
                onClick={() => {
                  onOpenChange(false);
                  router.push(`/projects/${p.id}`);
                }}
              >
                <span className="truncate">{p.projectNumber} — {p.name}</span>
                <ExternalLink className="h-4 w-4 shrink-0" />
              </Button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
