"use client";

import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useStableNow } from "@/hooks/use-stable-now";

/**
 * The two inputs of the ONE overdue rule (`convex/lib/taskDue.ts`): a stable
 * "now" snapshot and the org's timezone (UTC when the org stores none).
 */
export function useTaskDueClock(): { now: number; timezone: string | undefined } {
  const { timezone } = useDocumentDatesConfig();
  return { now: useStableNow(), timezone };
}
