"use client";

import { useCallback } from "react";
import { useMutation, useConvex } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCanDo } from "@/lib/use-permissions";
import { announceWarehouseWrite, countLabel, type AnnouncedWrite } from "@/lib/warehouse-undo-toast";
import { OUT_LABEL } from "@/lib/vocabulary";
import type { ReturnCondition } from "@/lib/returning";
import { api } from "../../convex/_generated/api";

/**
 * The floor's Returning mode (spec §9c.4, D26): a LIVE board, held only while
 * `?mode=returning` (pass `enabled: false` otherwise and the subscription is
 * skipped). Every read is bounded server-side (`warehouseFloor.returning`).
 */
export function useReturningBoard(orgId: string | undefined, enabled: boolean) {
  const data = useAuthedQuery(api.warehouseFloor.returning, orgId && enabled ? { orgId } : "skip");
  return { data, isLoading: enabled && !!orgId && data === undefined };
}

/** One line's units (every unit, each with its outcome), live while expanded. */
export function useReturningLineUnits(orgId: string | undefined, lineItemId: string | null) {
  return useAuthedQuery(api.warehouseFloor.lineUnits, orgId && lineItemId ? { orgId, lineItemId } : "skip");
}

/** Project-less scan resolution — one-shot per scan, not a subscription. */
export function useResolveScan() {
  const convex = useConvex();
  return useCallback((orgId: string, value: string) => convex.query(api.returnsLookup.resolve, { orgId, value }), [convex]);
}

const CONDITION_WORD: Record<ReturnCondition, string> = { GOOD: "good", DAMAGED: "damaged", MISSING: "missing" };

/**
 * Returning-mode writes that `useWarehouseWrites` does not already announce.
 * Every one toasts through `announceWarehouseWrite`, and its `scanUndo` is the
 * toast's own Undo closure, so the strip and the toast share ONE reverse
 * (CLAUDE.md). Undo is ABSENT (never disabled) when the reverse permission is
 * missing or, for a bulk tag, when the server says it is not exactly reversible.
 */
export function useReturnsWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canUnreturn = useCanDo("warehouse", "check_out"); // the reverse of a return
  const canCorrect = useCanDo("warehouse", "check_in");
  const canDeleteRepair = useCanDo("maintenance", "delete");

  const returnBulkM = useMutation(api.returnsWrites.returnBulkNative);
  const unreturnBulkM = useMutation(api.returnsWrites.unreturnBulkNative);
  const correctConditionM = useMutation(api.returnsWrites.correctReturnConditionNative);
  const raiseRepairM = useMutation(api.maintenanceWrites.createNative);
  const deleteRepairM = useMutation(api.maintenanceWrites.deleteNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** A bulk tag returned onto ONE job (the server derives the line split).
     *  Undo moves back exactly the units this call flipped (`unreturnBulkNative`);
     *  absent for a partial return, which has no exact reverse. */
    returnBulk: async (item: { bulkAssetId: string; projectId: string; quantity: number; returnCondition?: ReturnCondition }) => {
      const org = requireOrg();
      const res = await returnBulkM({
        orgId: org,
        bulkAssetId: item.bulkAssetId,
        projectId: item.projectId,
        quantity: item.quantity,
        returnCondition: item.returnCondition ?? "GOOD",
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
      return announceWarehouseWrite(res, {
        doneTitle: `Returned ${countLabel(res.distributed, "item")}`,
        undoneTitle: `Undone — ${countLabel(res.distributed, "item")} back ${OUT_LABEL.toLowerCase()}`,
        canUndo: canUnreturn && res.exactUndo,
        performUndo: async () => {
          await unreturnBulkM({
            orgId: org,
            projectId: item.projectId,
            unitIds: res.returnedUnitIds,
            revertAutoAdvanceAuditId: res.autoStatusAuditId ?? undefined,
            auditId: createId(),
            now: Date.now(),
            actor: actor(),
          });
        },
      });
    },

    /** Post-hoc outcome on an already-returned unit. Undo = the same mutation
     *  restoring the condition the unit had before (`previous`). */
    correctCondition: async (
      item: { lineItemId: string; assetId?: string; unitId?: string; returnCondition: ReturnCondition },
      previous: ReturnCondition,
    ): Promise<AnnouncedWrite<{ updated: boolean; autoStatus: null }>> => {
      const org = requireOrg();
      const write = (returnCondition: ReturnCondition) =>
        correctConditionM({
          orgId: org,
          lineItemId: item.lineItemId,
          assetId: item.assetId,
          unitId: item.unitId,
          returnCondition,
          auditId: createId(),
          now: Date.now(),
          actor: actor(),
        });
      const res = await write(item.returnCondition);
      return announceWarehouseWrite({ ...res, autoStatus: null }, {
        doneTitle: `Marked ${CONDITION_WORD[item.returnCondition]}`,
        undoneTitle: `Undone — back to ${CONDITION_WORD[previous]}`,
        canUndo: canCorrect,
        performUndo: async () => {
          await write(previous);
        },
      });
    },

    /** "Raise repair" for damaged returned gear. Undo deletes the record, and is
     *  absent without `maintenance:delete`. */
    raiseRepair: async (item: { projectId: string; label: string; assets: Array<{ assetId: string; assetTag: string | null }> }) => {
      const org = requireOrg();
      const tags = item.assets.map((a) => a.assetTag).filter(Boolean).join(", ");
      const res = await raiseRepairM({
        orgId: org,
        recordId: createId(),
        type: "REPAIR",
        status: "SCHEDULED",
        title: `Damaged on return — ${item.label}${tags ? ` ${tags}` : ""}`,
        projectId: item.projectId,
        assetLinks: item.assets.map((a) => ({ id: createId(), assetId: a.assetId })),
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return announceWarehouseWrite({ ...res, autoStatus: null }, {
        doneTitle: "Repair raised",
        undoneTitle: "Undone — repair removed",
        canUndo: canDeleteRepair,
        performUndo: async () => {
          await deleteRepairM({ orgId: org, id: res.id, now: Date.now(), actor: actor(), auditId: createId() });
        },
      });
    },
  };
}
