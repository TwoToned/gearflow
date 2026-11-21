"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * The single persisted bit behind the dashboard's "Finish setup" checklist
 * (C6, #1104) — everything else on that card is derived live from the org's
 * real settings. Reactive: a dismiss updates every mounted reader immediately,
 * no manual refetch.
 */
export function useSetupDismissal() {
  const dismissedAt = useAuthedQuery(api.orgSetupDismissalsWrites.mine, {});
  const dismissM = useMutation(api.orgSetupDismissalsWrites.dismissNative);
  const undismissM = useMutation(api.orgSetupDismissalsWrites.undismissNative);

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
