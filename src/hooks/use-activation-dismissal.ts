"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * The single persisted bit behind the dashboard's "Get started" activation
 * checklist (D1, #1105) — the four milestones themselves are derived live
 * from the org's real state (`useActivationMilestones`). Reactive: a dismiss
 * updates every mounted reader immediately, no manual refetch.
 */
export function useActivationDismissal() {
  const dismissedAt = useAuthedQuery(api.orgActivationDismissalsWrites.mine, {});
  const dismissM = useMutation(api.orgActivationDismissalsWrites.dismissNative);

  const dismiss = useCallback(async (): Promise<void> => {
    await dismissM({ id: createId(), now: Date.now() });
  }, [dismissM]);

  return {
    /** `undefined` while loading, `null` if never dismissed, else the timestamp. */
    dismissedAt: dismissedAt as number | null | undefined,
    dismissed: !!dismissedAt,
    dismiss,
  };
}
