"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { canDragLine, plannedCaseOf, type CaseLike, type PlannableLine } from "@/lib/packing-tab";
import { packingWriteMessage } from "@/lib/packing-write-error";
import { announceUndo } from "@/lib/packing-undo";
import { UNPLANNED_LABEL } from "@/lib/vocabulary";
import { MAX_PLAN_LINES } from "../../convex/lib/packingPlan";

export interface PlanTarget {
  id: string;
  label: string;
}

export interface PlanOptions {
  /** Packed lines the caller already left out (Unpack): named in the toast, not passed on. */
  packedStay?: number;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The toast's second line: what the write left alone, and why. */
function leftAloneNote(left: { packed: number; otherJob: number; sealed: number }): string | undefined {
  const parts: string[] = [];
  if (left.packed > 0) parts.push(`${count(left.packed, "packed line")} stay${left.packed === 1 ? "s" : ""} (move in the warehouse)`);
  if (left.sealed > 0) parts.push(`${count(left.sealed, "line")} in a sealed case left alone`);
  if (left.otherJob > 0) parts.push(`${count(left.otherJob, "line")} on another version left alone`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * THE planning write (§7b.3): `planInto(ids, case | null)`, the ONLY caller of
 * `setPlannedContainer`. Drag, the bulk `Plan n into…`, the row ⋯ `Plan into…`
 * and the case's `Unpack` all call this one closure, so they cannot disagree
 * about what a plan change is, what it skips, or what its Undo does. It
 *  - skips lines with a packed unit up front, and lines sitting in a SEALED case
 *    (the server refuses those, atomically, so a mixed batch would fail whole),
 *    naming each group quietly,
 *  - toasts `3 lines → LX-04` with a quiet reason for anything left alone,
 *  - hands the toast ONE Undo: `restorePlannedContainers(batchAuditId)`, which
 *    the server answers from its own audit rows (the client supplies no prior
 *    values) and which refuses lines edited since,
 *  - surfaces the server's own sentence on failure (a sealed target says
 *    "Unseal it to …").
 */
export function usePackingPlan(lines: readonly PlannableLine[], containers: readonly CaseLike[]) {
  const writes = useProjectContainerWrites();
  const lineById = useMemo(() => new Map(lines.map((l) => [l.item.id, l.item])), [lines]);

  const planInto = useCallback(
    async (ids: readonly string[], target: PlanTarget | null, opts: PlanOptions = {}): Promise<{ updated: number } | null> => {
      const unique = [...new Set(ids)].filter((id) => lineById.has(id));
      const unpacked = unique.filter((id) => canDragLine(lineById.get(id)!));
      const eligible = unpacked.filter((id) => !plannedCaseOf(lineById.get(id)!, containers)?.sealed);
      const packedUpFront = unique.length - unpacked.length + (opts.packedStay ?? 0);
      const sealedUpFront = unpacked.length - eligible.length;
      if (eligible.length === 0) {
        toast.info(leftAloneNote({ packed: packedUpFront, otherJob: 0, sealed: sealedUpFront }) ?? "Nothing to plan");
        return null;
      }
      if (eligible.length > MAX_PLAN_LINES) {
        // The server caps one call; say so up front instead of surfacing a raw array-length error.
        toast.error(`Plan up to ${MAX_PLAN_LINES} lines at a time`, { description: `${eligible.length} are selected. Do them in batches.` });
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
      const note = leftAloneNote({
        packed: packedUpFront + serverPacked,
        otherJob: result.skipped.length - serverPacked,
        sealed: sealedUpFront,
      });
      const where = target?.label ?? UNPLANNED_LABEL;
      if (result.updated === 0) {
        toast.info(note ?? `Already in ${where}`);
        return { updated: 0 };
      }
      toast.success(`${count(result.updated, "line")} → ${where}`, {
        description: note,
        action: { label: "Undo", onClick: () => announceUndo(() => writes.restorePlannedContainers(result.batchAuditId)) },
      });
      return { updated: result.updated };
    },
    [writes, lineById, containers],
  );

  return { planInto };
}
