"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

type ContainerKind = "ASSET" | "BULK_ASSET" | "CUSTOM";

/**
 * Browser-direct ProjectContainer writes (#1296 packing containers, build
 * plan phase 1b/2). Mirrors `use-warehouse-writes.ts`'s shape: the client mints
 * the audit cuid and supplies actor/orgId/now; each `api.projectContainersWrites.*`
 * mutation folds kill-switch + rate limit + RBAC + FK/org validation + the
 * in-mutation audit into one transaction.
 */
export function useProjectContainerWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.projectContainersWrites.createNative);
  const updateM = useMutation(api.projectContainersWrites.updateNative);
  const deleteM = useMutation(api.projectContainersWrites.deleteNative);
  const moveUnitsM = useMutation(api.projectContainersWrites.moveUnitsNative);
  const unpackM = useMutation(api.projectContainersWrites.unpackNative);
  const setPlannedContainerM = useMutation(api.projectContainersWrites.setPlannedContainerNative);
  const restorePlannedM = useMutation(api.projectContainerPlanWrites.restorePlannedContainersNative);
  const sealM = useMutation(api.projectContainerPlanWrites.sealNative);
  const unsealM = useMutation(api.projectContainerPlanWrites.unsealNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (args: {
      /** Re-create under a specific id: only the Undo of a case delete (so lines planned into it can be restored). */
      id?: string;
      projectId: string;
      kind: ContainerKind;
      label: string;
      assetId?: string;
      bulkAssetId?: string;
      modelId?: string;
      description?: string;
      parentContainerId?: string;
      versionId?: string;
    }): Promise<{ id: string; lineItemId: string }> => {
      return createM({
        orgId: requireOrg(),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
        ...args,
        id: args.id ?? createId(),
      });
    },

    update: async (
      id: string,
      patch: { label?: string; description?: string | null; parentContainerId?: string | null },
    ): Promise<{ ok: boolean }> => {
      return updateM({ id, orgId: requireOrg(), ...patch, auditId: createId(), now: Date.now(), actor: actor() });
    },

    /** Delete an (empty) case. `batchAuditId` is the handle `restorePlannedContainers`
     *  uses, after re-creating the case, to put its planned lines back. */
    remove: async (id: string): Promise<{ ok: boolean; batchAuditId: string }> => {
      const batchAuditId = createId();
      const res = await deleteM({ id, orgId: requireOrg(), auditId: batchAuditId, now: Date.now(), actor: actor() });
      return { ...res, batchAuditId };
    },

    moveUnits: async (unitIds: string[], toContainerId: string | null): Promise<{ moved: number }> => {
      return moveUnitsM({ orgId: requireOrg(), unitIds, toContainerId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    unpack: async (id: string): Promise<{ unpacked: number }> => {
      return unpackM({ id, orgId: requireOrg(), auditId: createId(), now: Date.now(), actor: actor() });
    },

    /** Plan lines into a case (or `null` = unplanned). Returns the changed
     *  lines (`changes`), what was left alone (`skipped`: packed, or on another
     *  job) and `batchAuditId`, the handle `restorePlannedContainers` undoes. */
    setPlannedContainer: async (lineItemIds: string[], containerId: string | null) => {
      const batchAuditId = createId();
      const result = await setPlannedContainerM({
        orgId: requireOrg(),
        lineItemIds,
        containerId,
        now: Date.now(),
        actor: actor(),
        auditId: batchAuditId,
      });
      return { ...result, batchAuditId };
    },

    /** The exact Undo of `setPlannedContainer`: only the batch id; the server
     *  reads each line's previous case from its own audit rows. */
    restorePlannedContainers: async (batchAuditId: string) => {
      return restorePlannedM({ orgId: requireOrg(), batchAuditId, now: Date.now(), actor: actor(), auditId: createId() });
    },

    seal: async (id: string) => sealM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
    unseal: async (id: string) => unsealM({ id, orgId: requireOrg(), now: Date.now(), actor: actor(), auditId: createId() }),
  };
}
