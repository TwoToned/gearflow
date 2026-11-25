"use client";

import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useStableNow } from "@/hooks/use-stable-now";

/**
 * The two inputs of the ONE overdue rule (`convex/lib/taskDue.ts`): a stable
 * "now" snapshot and the org's timezone (UTC when the org stores none; that
 * default lives in `dueClockZone`). `ready` is false while the org's settings are
 * still loading: a caller then shows NOTHING for "overdue" rather than a guess in
 * the wrong zone.
 */
export function useTaskDueClock(): { now: number; timezone: string | undefined; ready: boolean } {
  const { timezone, isLoading } = useDocumentDatesConfig();
  return { now: useStableNow(), timezone, ready: !isLoading };
}
