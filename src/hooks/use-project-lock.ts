"use client";

import { useMutation, useQuery } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { api } from "../../convex/_generated/api";

/**
 * #957 lifecycle-lock status + unlock-session hooks. `useProjectLockStatus`
 * is the one reactive read every gated surface (banner, lock icons,
 * useJustifiedMutation) subscribes to; `useUnlockSession` opens/commits/
 * discards a session (#791 FINANCIAL scope, #792 FULL scope — same mutations,
 * different `scope` + server-checked audience).
 */
export function useProjectLockStatus(projectId: string | undefined, orgId: string | undefined) {
  const status = useQuery(
    api.projectLocksRead.status,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
  return {
    loading: status === undefined,
    tier: status?.tier ?? "OPEN",
    openSession: status?.openSession ?? null,
    hasOpenSession: status != null && status.openSession != null,
    canOverrideHardLock: status?.canOverrideHardLock ?? false,
  };
}

export function useUnlockSession(projectId: string | undefined, orgId: string | undefined) {
  const { data: session } = useSession();
  const openM = useMutation(api.projectUnlockSessionsWrites.openNative);
  const commitM = useMutation(api.projectUnlockSessionsWrites.commitNative);
  const discardM = useMutation(api.projectUnlockSessionsWrites.discardNative);

  const enabled = !!orgId && !!projectId && !!session?.user;
  const actor = () => ({ userId: session!.user.id, userName: session!.user.name ?? "" });

  const open = async (scope: "FINANCIAL" | "FULL", justification: string): Promise<void> => {
    if (!enabled) throw new Error("Not ready");
    try {
      await openM({
        projectId: projectId!,
        orgId: orgId!,
        scope,
        justification,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  const commit = async (note?: string): Promise<void> => {
    if (!enabled) throw new Error("Not ready");
    try {
      await commitM({
        projectId: projectId!,
        orgId: orgId!,
        note,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  const discard = async (): Promise<{ conflicts: string[] }> => {
    if (!enabled) throw new Error("Not ready");
    try {
      return await discardM({
        projectId: projectId!,
        orgId: orgId!,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return { enabled, open, commit, discard };
}
