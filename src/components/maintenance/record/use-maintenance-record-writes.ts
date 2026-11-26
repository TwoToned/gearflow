"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";

import { useSession } from "@/lib/auth-client";
import { api } from "../../../../convex/_generated/api";

/** A part as the form sends it: blank optional fields are simply absent. */
export interface PartInput {
  name: string;
  supplierName?: string;
  quantity: number;
  unitPrice?: number;
  etaDate?: number;
}

export type CompleteInput = {
  result: "PASS" | "FAIL" | "CONDITIONAL";
  completedDate: number;
  /** Absent leaves the stored labour, `null` clears it. */
  labour?: number | null;
  /** Absent leaves it, `null` clears it. */
  nextDueDate?: number | null;
  dispositions?: { assetId: string; disposition: "RETURN_TO_SERVICE" | "KEEP_OUT_OF_SERVICE" | "RETIRE" }[];
};

/**
 * Browser-direct writes for ONE maintenance record's parts and lifecycle (UX Phase 14, 14b-3). Every write mints its
 * own audit id (the exact Undo takes ids only: `undoPart` / `undoLifecycle`) and returns it beside the result, so
 * the toast's Undo is built from the SAME call, never re-derived. The server owns every rule; this only calls.
 */
export function useMaintenanceRecordWrites(orgId: string | undefined, recordId: string) {
  const { data: session } = useSession();
  const addM = useMutation(api.maintenancePartsWrites.addNative);
  const editM = useMutation(api.maintenancePartsWrites.editNative);
  const removeM = useMutation(api.maintenancePartsWrites.removeNative);
  const arrivedM = useMutation(api.maintenancePartsWrites.markArrivedNative);
  const undoPartM = useMutation(api.maintenancePartsWrites.undoNative);
  const completeM = useMutation(api.maintenanceLifecycleWrites.completeNative);
  const reopenM = useMutation(api.maintenanceLifecycleWrites.reopenNative);
  const undoLifecycleM = useMutation(api.maintenanceLifecycleWrites.undoNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const org = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    addPart: async (part: PartInput): Promise<{ id: string; auditId: string }> => {
      const id = createId();
      const auditId = createId();
      await addM({ orgId: org(), recordId, id, part, actor: actor(), auditId, now: Date.now() });
      return { id, auditId };
    },
    editPart: async (id: string, set: Partial<PartInput>, clear: string[]): Promise<{ changed: boolean; auditId: string }> => {
      const auditId = createId();
      const r = await editM({ orgId: org(), recordId, id, set, clear, actor: actor(), auditId, now: Date.now() });
      return { changed: r.changed, auditId };
    },
    removePart: async (id: string): Promise<{ auditId: string }> => {
      const auditId = createId();
      await removeM({ orgId: org(), recordId, id, actor: actor(), auditId, now: Date.now() });
      return { auditId };
    },
    markArrived: async (id: string): Promise<{ changed: boolean; advanced: boolean; auditId: string }> => {
      const auditId = createId();
      const now = Date.now();
      const r = await arrivedM({ orgId: org(), recordId, id, arrivedAt: now, actor: actor(), auditId, now });
      return { changed: r.changed, advanced: r.advanced, auditId };
    },
    /** Exactly reverses ONE part write (add, edit, remove or arrive), ids only. */
    undoPart: async (auditId: string): Promise<void> => {
      await undoPartM({ orgId: org(), recordId, auditId, actor: actor(), now: Date.now() });
    },
    complete: async (input: CompleteInput): Promise<{ undoable: boolean; auditId: string }> => {
      const auditId = createId();
      const r = await completeM({ orgId: org(), id: recordId, ...input, actor: actor(), auditId, now: Date.now() });
      return { undoable: r.undoable, auditId };
    },
    reopen: async (): Promise<{ auditId: string }> => {
      const auditId = createId();
      await reopenM({ orgId: org(), id: recordId, actor: actor(), auditId, now: Date.now() });
      return { auditId };
    },
    /** Exactly reverses a Complete or a Reopen, ids only. */
    undoLifecycle: async (auditId: string): Promise<void> => {
      await undoLifecycleM({ orgId: org(), id: recordId, auditId, actor: actor(), now: Date.now() });
    },
  };
}
