"use client";

import { useEffect } from "react";
import { useMira } from "@/components/providers/mira-context-provider";
import type { MiraPageContext } from "@/lib/mira/types";

/**
 * Publish "what the user is currently looking at" into Mira's context so its
 * system prompt (src/lib/mira/system-prompt.ts) can point the model at the
 * entity on screen without the user having to name it (Phase 8, #1004:
 * "page context (route, current entity) flows into the agent's tool calls
 * automatically"). Clears itself on unmount so navigating away doesn't leave
 * a stale entity behind for the next question.
 *
 * A no-op when no `MiraContextProvider` is mounted (`useMira()` returns
 * `null` — see mira-context-provider.tsx) or when `context` is `null`,
 * e.g. before an id has loaded.
 */
export function useMiraPageContext(context: MiraPageContext | null): void {
  const mira = useMira();
  const setPageContext = mira?.setPageContext;

  useEffect(() => {
    if (!setPageContext) return;
    setPageContext(context);
    return () => setPageContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPageContext, context?.entityType, context?.entityId]);
}
