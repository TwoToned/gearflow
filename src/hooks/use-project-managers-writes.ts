"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct PROJECT-MANAGER writes (Phase 3 — replaces the addProjectManager/
 * removeProjectManager/setProjectManagers server actions). Membership validation +
 * user-label resolution now happen inside the guarded `api.projectManagersWrites.*`
 * mutations via the Convex members/users mirrors — no Prisma seam. Consumers refetch the
 * project-detail composite (which carries the manager list) on success, so the write
 * return values feed no UI directly.
 */
export function useProjectManagerWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const addM = useMutation(api.projectManagersWrites.addNative);
  const removeM = useMutation(api.projectManagersWrites.removeNative);
  const setM = useMutation(api.projectManagersWrites.setNative);

  const actor = () => ({
    userId: session?.user.id ?? "",
    userName: session?.user.name ?? "",
  });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    add: async (projectId: string, userId: string): Promise<void> => {
      await addM({
        id: createId(),
        projectId,
        orgId: requireOrg(),
        userId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    remove: async (projectId: string, userId: string): Promise<void> => {
      await removeM({
        projectId,
        orgId: requireOrg(),
        userId,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
    },
    set: async (
      projectId: string,
      userIds: string[],
    ): Promise<{ added: string[]; removed: string[] }> => {
      return await setM({
        projectId,
        orgId: requireOrg(),
        userIds,
        now: Date.now(),
        actor: actor(),
        // Prefix seeds deterministic per-change cuids for the pm rows + audit rows
        // (a Convex mutation can't mint cuids); createId() gives a unique run id.
        auditPrefix: createId(),
      });
    },
  };
}
