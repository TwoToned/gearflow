"use client";

import { useCallback } from "react";
import { useMutation, useConvex } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

/**
 * Org-wide returns-station data + writes (issue #944 WS5).
 *
 * One-shot board fetch + session-local list (per the spec — the /warehouse/* LCP
 * budget is already over per docs/exceptions.md R-8.9.3, so this deliberately does
 * NOT hold a live whole-org subscription the way `useNativeWarehouseList` does).
 * `refetchBoard` re-runs the query on demand (refresh button + after every
 * mutation) instead.
 */
export function useReturnsBoard(orgId: string | undefined) {
  const bundle = useAuthedQuery(api.warehouseReturns.bundle, orgId ? { orgId } : "skip");
  const convex = useConvex();

  const refetch = useCallback(async () => {
    if (!orgId) return undefined;
    return convex.query(api.warehouseReturns.bundle, { orgId });
  }, [convex, orgId]);

  return {
    data: bundle,
    isLoading: !!orgId && bundle === undefined,
    refetch,
  };
}

/** Expand one line's CHECKED_OUT units on demand (unit chips) — a one-shot fetch
 *  triggered when a row is opened, not a subscription. */
export function useLineUnits() {
  const convex = useConvex();
  return useCallback(
    (orgId: string, lineItemId: string) => convex.query(api.warehouseReturns.unitsForLine, { orgId, lineItemId }),
    [convex],
  );
}

async function resolveScanImpl(convex: ReturnType<typeof useConvex>, orgId: string, value: string) {
  return convex.query(api.returnsLookup.resolve, { orgId, value });
}

/** Project-less scan resolution — one-shot per scan, not a subscription. */
export function useResolveScan() {
  const convex = useConvex();
  return useCallback((orgId: string, value: string) => resolveScanImpl(convex, orgId, value), [convex]);
}

export function useReturnsWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const returnScanM = useMutation(api.returnsWrites.returnScanNative);
  const returnBulkM = useMutation(api.returnsWrites.returnBulkNative);
  const returnBatchM = useMutation(api.returnsWrites.returnBatchNative);
  const correctConditionM = useMutation(api.returnsWrites.correctReturnConditionNative);
  const raiseRepairM = useMutation(api.maintenanceWrites.createNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    orgId,

    /** Single scan-and-return. Condition defaults to GOOD — never prompted mid-scan. */
    returnScan: async (item: {
      lineItemId: string;
      assetId?: string;
      bulkAssetId?: string;
      quantity?: number;
      returnCondition?: ReturnCondition;
      notes?: string;
    }): Promise<{ updatedLineIds: string[]; projectId: string; autoAdvanced: boolean }> => {
      return returnScanM({
        orgId: requireOrg(),
        lineItemId: item.lineItemId,
        assetId: item.assetId,
        bulkAssetId: item.bulkAssetId,
        quantity: item.quantity,
        returnCondition: item.returnCondition ?? "GOOD",
        notes: item.notes,
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    /** Bulk-tag scan resolved to a single project — quantity across whichever
     *  of that project's lines carry this bulk asset (server-re-derived, never a
     *  client line breakdown). Used both for the single-project resolver result
     *  and each per-project confirm in the bulk_multi disambiguation dialog. */
    returnBulk: async (item: {
      bulkAssetId: string;
      projectId: string;
      quantity: number;
      returnCondition?: ReturnCondition;
      notes?: string;
    }): Promise<{ distributed: number; updatedLineIds: string[]; autoAdvanced: boolean }> => {
      return returnBulkM({
        orgId: requireOrg(),
        bulkAssetId: item.bulkAssetId,
        projectId: item.projectId,
        quantity: item.quantity,
        returnCondition: item.returnCondition ?? "GOOD",
        notes: item.notes,
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    /** Multi-select batch return — cap enforced server-side too (100). */
    returnBatch: async (
      items: Array<{
        lineItemId: string;
        assetId?: string;
        bulkAssetId?: string;
        quantity?: number;
        returnCondition?: ReturnCondition;
        notes?: string;
      }>,
    ): Promise<Array<{ lineItemId: string; success: boolean; error?: string; projectId?: string }>> => {
      return returnBatchM({
        orgId: requireOrg(),
        items: items.map((it) => ({
          lineItemId: it.lineItemId,
          assetId: it.assetId,
          bulkAssetId: it.bulkAssetId,
          quantity: it.quantity,
          returnCondition: it.returnCondition ?? "GOOD",
          notes: it.notes,
          auditId: createId(),
        })),
        batchAuditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    /** Post-hoc "mark damaged / missing" on an already-returned session row. */
    correctCondition: async (item: {
      lineItemId: string;
      assetId?: string;
      unitId?: string;
      returnCondition: ReturnCondition;
      notes?: string;
    }): Promise<{ updated: boolean }> => {
      return correctConditionM({
        orgId: requireOrg(),
        lineItemId: item.lineItemId,
        assetId: item.assetId,
        unitId: item.unitId,
        returnCondition: item.returnCondition,
        notes: item.notes,
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
      });
    },

    /** "Raise repair" shortcut from a damaged return row (issue #944 WS5). */
    raiseRepair: async (item: { assetId: string; projectId: string; modelName: string; assetTag: string; returnNotes?: string }): Promise<{ id: string }> => {
      return raiseRepairM({
        orgId: requireOrg(),
        recordId: createId(),
        type: "REPAIR",
        status: "SCHEDULED",
        title: `Damaged on return — ${item.modelName} ${item.assetTag}`,
        description: item.returnNotes,
        projectId: item.projectId,
        assetLinks: [{ id: createId(), assetId: item.assetId }],
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
  };
}
