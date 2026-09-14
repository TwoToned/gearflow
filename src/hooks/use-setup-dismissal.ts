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
