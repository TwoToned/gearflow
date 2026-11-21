"use client";

import { toast } from "sonner";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { openLabel } from "@/components/documents/label-submenu";
import { packingWriteMessage } from "@/lib/packing-write-error";

interface CaseRef {
  id: string;
  label: string;
}

/** What re-creating a deleted case needs (only a CUSTOM case can be re-created exactly). */
export interface DeletableCase extends CaseRef {
  kind?: "ASSET" | "BULK_ASSET" | "CUSTOM";
  description?: string | null;
  parentContainerId?: string | null;
  versionId?: string | null;
}

/**
 * The case-card verbs on the job's Packing tab (spec §7b.2/§7b.3), on the
 * existing container mutations (org-checked, rate-limited, audited
 * server-side). Each write toasts; its Undo is ONE closure, built here next to
 * the write it reverses and handed to the toast as is. A failure shows the
 * server's own sentence (`CASE_SEALED` says "Unseal it to …").
 */
export function usePackingCaseWrites(projectId: string) {
  const writes = useProjectContainerWrites();

  async function run<T>(fn: () => Promise<T>, message: (r: T) => string, undo?: (r: T) => Promise<unknown>): Promise<T | null> {
    let result: T;
    try {
      result = await fn();
    } catch (e) {
      toast.error(packingWriteMessage(e));
      return null;
    }
    toast.success(message(result), undo && {
      action: {
        label: "Undo",
        onClick: () => {
          undo(result).then(
            () => toast.success("Undone"),
            (e: unknown) => toast.error(packingWriteMessage(e, "Couldn't undo")),
          );
        },
      },
    });
    return result;
  }

  return {
    rename: (c: CaseRef, label: string) =>
      run(() => writes.update(c.id, { label }), () => `Renamed ${c.label} to ${label}`, () => writes.update(c.id, { label: c.label })),

    /** Nest `c` inside `target`; Undo puts it back where it was (`from`, or top level). */
    moveInto: (c: CaseRef, target: CaseRef, from: CaseRef | null) =>
      run(
        () => writes.update(c.id, { parentContainerId: target.id }),
        () => `${c.label} is now in ${target.label}`,
        () => writes.update(c.id, { parentContainerId: from?.id ?? null }),
      ),

    takeOut: (c: CaseRef, parent: CaseRef) =>
      run(
        () => writes.update(c.id, { parentContainerId: null }),
        () => `${c.label} taken out of ${parent.label}`,
        () => writes.update(c.id, { parentContainerId: parent.id }),
      ),

    /** Un-PLAN the case's planned-only lines (they go Unplanned). Packed lines
     *  stay: packed wins, and physical moves happen in the warehouse. Undo is
     *  the server-sourced exact restore of THAT write. */
    unpack: async (c: CaseRef, plannedOnlyIds: string[], packedCount: number) => {
      const n = plannedOnlyIds.length;
      const loose = `${n} ${n === 1 ? "line" : "lines"} unplanned`;
      const stay = packedCount > 0 ? ` · ${packedCount} packed ${packedCount === 1 ? "line stays" : "lines stay"} (move in the warehouse)` : "";
      return run(
        () => writes.setPlannedContainer(plannedOnlyIds, null),
        () => `${loose}${stay}`,
        (r) => writes.restorePlannedContainers(r.batchAuditId),
      );
    },

    /** Seal: lock the plan and print the label the seal vouches for. Undo = unseal. */
    seal: async (c: CaseRef) => {
      const r = await run(
        () => writes.seal(c.id),
        (res) => (res.changed ? `${c.label} sealed` : `${c.label} was already sealed`),
        (res) => (res.changed ? writes.unseal(c.id) : Promise.resolve()),
      );
      if (r?.changed) openLabel(projectId, "container-label", c.id);
    },

    unseal: (c: CaseRef) =>
      run(
        () => writes.unseal(c.id),
        (res) => (res.changed ? `${c.label} unsealed` : `${c.label} was already open`),
        (res) => (res.changed ? writes.seal(c.id) : Promise.resolve()),
      ),

    printLabel: (c: CaseRef) => openLabel(projectId, "container-label", c.id),

    /** Delete an EMPTY case (the server answers `NOT_EMPTY` with its reason while
     *  anything is packed in it). Lines only planned into it return to Unplanned.
     *  Undo re-creates a CUSTOM case under the same id and restores those lines
     *  from the server's audit rows; asset-backed cases offer no Undo. */
    remove: (c: DeletableCase) =>
      run(
        () => writes.remove(c.id),
        () => `Deleted ${c.label}`,
        c.kind === "CUSTOM"
          ? async (r) => {
              await writes.create({
                id: c.id,
                projectId,
                kind: "CUSTOM",
                label: c.label,
                description: c.description ?? undefined,
                parentContainerId: c.parentContainerId ?? undefined,
                versionId: c.versionId ?? undefined,
              });
              await writes.restorePlannedContainers(r.batchAuditId);
            }
          : undefined,
      ),
  };
}
