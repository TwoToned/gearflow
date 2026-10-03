"use client";

import { useMutation, useQuery } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { mapNativeWriteError } from "@/lib/native-writes";
import { api } from "../../convex/_generated/api";

/**
 * #1230 pricing-lock hook — the successor to #957's `useProjectLockStatus` /
 * `useUnlockSession` (deleted along with the 4-tier lock system + unlock
 * sessions). One reactive `projectLocksRead.status` subscription backs every
 * lock surface (chip, strip, `<LockedField>`/`<GatedButton>` tooltips), plus
 * `lock`/`unlock` actions.
 */
type ProjectLockStatus = ReturnType<typeof useQuery<typeof api.projectLocksRead.status>>;

function deriveLockStatus(status: ProjectLockStatus) {
  const {
    pricingLocked = false,
    pricingLockedAt,
    pricingLockedByName,
    canUnlockPricing = false,
  } = status ?? {};
  return {
    loading: status === undefined,
    pricingLocked,
    pricingLockedAt,
    pricingLockedByName,
    canUnlockPricing,
  };
}

export function useProjectPricingLock(projectId: string | undefined, orgId: string | undefined) {
  const status = useQuery(
    api.projectLocksRead.status,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
  const derived = deriveLockStatus(status);
  const { data: session } = useSession();
  const lockM = useMutation(api.projectPricingLockWrites.lockPricingNative);
  const unlockM = useMutation(api.projectPricingLockWrites.unlockPricingNative);

  const enabled = !!orgId && !!projectId && !!session?.user;
  const actor = () => ({ userId: session!.user.id, userName: session!.user.name ?? "" });

  /** Re-lock — ungated (any `project:update` caller). */
  const lock = async (): Promise<void> => {
    if (!enabled) throw new Error("Not ready");
    try {
      await lockM({ id: projectId!, orgId: orgId!, actor: actor(), auditId: createId(), now: Date.now() });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  /** Clear the lock — one click, per the whole rule (D42's `canUnlockPricing`
   *  audience, server-enforced regardless of what this hook's own
   *  `canUnlockPricing` read shows). */
  const unlock = async (): Promise<void> => {
    if (!enabled) throw new Error("Not ready");
    try {
      await unlockM({ id: projectId!, orgId: orgId!, actor: actor(), auditId: createId(), now: Date.now() });
    } catch (e) {
      throw mapNativeWriteError(e);
    }
  };

  return { ...derived, lock, unlock };
}
