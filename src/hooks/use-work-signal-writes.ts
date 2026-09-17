"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct USER-scoped writes for a human's decision about a derived
 * Triage signal (Phase 1, #1243) — see convex/workSignalStatesWrites.ts.
 * orgId is deliberately NOT an argument: these mutations read the verified
 * token's own active org (`requireSelfScope`), same as notifications.
 */
const DEFAULT_SNOOZE_MS = 24 * 60 * 60 * 1000; // "snooze" with no picker = until this time tomorrow

export function useWorkSignalWrites() {
  const { data: session } = useSession();
  const snoozeM = useMutation(api.workSignalStatesWrites.snoozeSignalNative);
  const dismissM = useMutation(api.workSignalStatesWrites.dismissSignalNative);
  const promoteM = useMutation(api.workSignalStatesWrites.promoteSignalNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });

  return {
    snooze: async (sourceKey: string, snoozedUntil: number = Date.now() + DEFAULT_SNOOZE_MS): Promise<void> => {
      await snoozeM({ sourceKey, snoozedUntil, now: Date.now() });
    },
    dismiss: async (sourceKey: string): Promise<void> => {
      await dismissM({ sourceKey, now: Date.now() });
    },
    promote: async (data: {
      sourceKey: string;
      title: string;
      projectId?: string;
      assigneeUserId?: string;
      assigneeCrewId?: string;
      dueDate?: number;
    }): Promise<string> => {
      const res = await promoteM({
        ...data,
        now: Date.now(),
        actor: actor(),
        auditId: createId(),
      });
      return res.id;
    },
  };
}
