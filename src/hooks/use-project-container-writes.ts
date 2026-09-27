"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

type ContainerKind = "ASSET" | "BULK_ASSET" | "CUSTOM";

/**
 * Browser-direct ProjectContainer writes (#1296 packing containers, build
 * plan phase 1b). Mirrors `use-warehouse-writes.ts`'s shape: the client mints
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
        id: createId(),
        orgId: requireOrg(),
        auditId: createId(),
        now: Date.now(),
        actor: actor(),
        ...args,
      });
    },

    update: async (
      id: string,
      patch: { label?: string; description?: string | null; parentContainerId?: string | null },
    ): Promise<{ ok: boolean }> => {
      return updateM({ id, orgId: requireOrg(), ...patch, auditId: createId(), now: Date.now(), actor: actor() });
    },

    remove: async (id: string): Promise<{ ok: boolean }> => {
      return deleteM({ id, orgId: requireOrg(), auditId: createId(), now: Date.now(), actor: actor() });
    },

    moveUnits: async (unitIds: string[], toContainerId: string | null): Promise<{ moved: number }> => {
      return moveUnitsM({ orgId: requireOrg(), unitIds, toContainerId, auditId: createId(), now: Date.now(), actor: actor() });
    },

    unpack: async (id: string): Promise<{ unpacked: number }> => {
      return unpackM({ id, orgId: requireOrg(), auditId: createId(), now: Date.now(), actor: actor() });
    },

    setPlannedContainer: async (lineItemIds: string[], containerId: string | null): Promise<{ updated: number }> => {
      return setPlannedContainerM({ orgId: requireOrg(), lineItemIds, containerId, now: Date.now() });
    },
  };
}
