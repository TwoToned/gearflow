"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { canDragLine, type PlannableLine } from "@/lib/packing-tab";
import { packingWriteMessage } from "@/lib/packing-write-error";
import { UNPLANNED_LABEL } from "@/lib/vocabulary";

export interface PlanTarget {
  id: string;
  label: string;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The toast's second line: what the write left alone, and why. */
function leftAloneNote(packed: number, otherJob: number): string | undefined {
  const parts: string[] = [];
  if (packed > 0) parts.push(`${count(packed, "packed line")} stay${packed === 1 ? "s" : ""} (move in the warehouse)`);
  if (otherJob > 0) parts.push(`${count(otherJob, "line")} on another version left alone`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * THE planning write (§7b.3): `planInto(ids, case | null)`. Drag, the bulk
 * `Plan n into…` and the row ⋯ `Plan into…` all call this one closure, so they
 * cannot disagree about what a plan change is, what it skips, or what its Undo
 * does. It
 *  - skips lines with a packed unit up front (the server skips them too),
 *  - toasts `3 lines → LX-04` with a quiet reason for anything left alone,
 *  - hands the toast ONE Undo: `restorePlannedContainers(batchAuditId)`, which
 *    the server answers from its own audit rows (the client supplies no prior
 *    values) and which refuses lines edited since,
 *  - surfaces the server's own sentence on failure (a sealed case says
 *    "Unseal it to …").
 */
export function usePackingPlan(lines: readonly PlannableLine[]) {
  const writes = useProjectContainerWrites();
  const lineById = useMemo(() => new Map(lines.map((l) => [l.item.id, l.item])), [lines]);

  const planInto = useCallback(
    async (ids: readonly string[], target: PlanTarget | null): Promise<{ updated: number } | null> => {
      const unique = [...new Set(ids)].filter((id) => lineById.has(id));
      const eligible = unique.filter((id) => canDragLine(lineById.get(id)!));
      const packedUpFront = unique.length - eligible.length;
      if (eligible.length === 0) {
        toast.info(leftAloneNote(packedUpFront, 0) ?? "Nothing to plan");
        return null;
      }
      let result: Awaited<ReturnType<typeof writes.setPlannedContainer>>;
      try {
        result = await writes.setPlannedContainer(eligible, target?.id ?? null);
      } catch (e) {
        toast.error(packingWriteMessage(e, "Failed to update the plan"));
        return null;
      }
      const serverPacked = result.skipped.filter((s) => s.reason === "PACKED").length;
      const otherJob = result.skipped.length - serverPacked;
      const note = leftAloneNote(packedUpFront + serverPacked, otherJob);
      const where = target?.label ?? UNPLANNED_LABEL;
      if (result.updated === 0) {
        toast.info(note ?? `Already in ${where}`);
        return { updated: 0 };
      }
      toast.success(`${count(result.updated, "line")} → ${where}`, {
        description: note,
        action: { label: "Undo", onClick: () => undoPlan(writes.restorePlannedContainers, result.batchAuditId) },
      });
      return { updated: result.updated };
    },
    [writes, lineById],
  );

  return { planInto };
}

/** The ONE Undo of a plan write: the server restores each line from its own audit rows. */
function undoPlan(restore: (batchAuditId: string) => Promise<{ restored: number; skipped: number }>, batchAuditId: string): void {
  restore(batchAuditId).then(
    ({ restored, skipped }) =>
      toast.success(skipped > 0 ? `Undone · ${count(skipped, "line")} changed since, left as is` : "Undone", {
        description: restored === 0 ? "Nothing needed restoring." : undefined,
      }),
    (e: unknown) => toast.error(packingWriteMessage(e, "Couldn't undo")),
  );
}
