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
  const undismissM = useMutation(api.orgActivationDismissalsWrites.undismissNative);

  /** Resolves to the row id this call created, or `null` when it was already dismissed (nothing to undo). */
  const dismiss = useCallback(async (): Promise<string | null> => {
    const id = createId();
    const { created } = await dismissM({ id, now: Date.now() });
    return created ? id : null;
  }, [dismissM]);

  /** The exact reverse of one `dismiss()`: pass the id it resolved to. */
  const undismiss = useCallback(
    async (id: string): Promise<void> => {
      await undismissM({ id });
    },
    [undismissM],
  );

  return {
    /** `undefined` while loading, `null` if never dismissed, else the timestamp. */
    dismissedAt: dismissedAt as number | null | undefined,
    dismissed: !!dismissedAt,
    dismiss,
    undismiss,
  };
}
