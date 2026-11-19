"use client";

import { toast } from "sonner";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";

interface CaseRef {
  id: string;
  label: string;
}

/**
 * The case-card verbs on the job's Packing tab (spec §7b.2/§7b.3), on the
 * existing container mutations (org-checked, rate-limited, audited
 * server-side). Each write toasts; its Undo is ONE closure, built here next to
 * the write it reverses and handed to the toast as is.
 */
export function usePackingCaseWrites() {
  const writes = useProjectContainerWrites();

  async function run(fn: () => Promise<unknown>, message: string, undo: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't save");
      return;
    }
    toast.success(message, {
      action: {
        label: "Undo",
        onClick: () => {
          undo().then(
            () => toast.success("Undone"),
            (e: Error) => toast.error(e.message),
          );
        },
      },
    });
  }

  return {
    rename: (c: CaseRef, label: string) =>
      run(() => writes.update(c.id, { label }), `Renamed ${c.label} to ${label}`, () => writes.update(c.id, { label: c.label })),

    /** Nest `c` inside `target`; Undo puts it back where it was (`from`, or top level). */
    moveInto: (c: CaseRef, target: CaseRef, from: CaseRef | null) =>
      run(
        () => writes.update(c.id, { parentContainerId: target.id }),
        `${c.label} is now in ${target.label}`,
        () => writes.update(c.id, { parentContainerId: from?.id ?? null }),
      ),

    takeOut: (c: CaseRef, parent: CaseRef) =>
      run(
        () => writes.update(c.id, { parentContainerId: null }),
        `${c.label} taken out of ${parent.label}`,
        () => writes.update(c.id, { parentContainerId: parent.id }),
      ),

    /** Un-PLAN the case's planned-only lines (they go loose). Packed lines
     *  stay: packed wins, and physical moves happen in the warehouse. */
    unpack: (c: CaseRef, plannedOnlyIds: string[], packedCount: number) => {
      const loose = `${plannedOnlyIds.length} ${plannedOnlyIds.length === 1 ? "line" : "lines"} loose`;
      const stay = packedCount > 0 ? ` · ${packedCount} packed ${packedCount === 1 ? "line stays" : "lines stay"} (move in the warehouse)` : "";
      return run(
        () => writes.setPlannedContainer(plannedOnlyIds, null),
        `${loose}${stay}`,
        () => writes.setPlannedContainer(plannedOnlyIds, c.id),
      );
    },
  };
}
