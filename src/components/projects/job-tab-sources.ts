"use client";

import type * as React from "react";

import { useProjectTaskList } from "@/hooks/use-project-task-list";
import { useProjectVersion } from "@/components/projects/project-version-context";
import type { JobTabCounts, JobTabKey } from "@/lib/job-tabs";

/**
 * Where each job tab's label count and tab-row primary come from (UX Phase 7).
 * The tab OWNER feeds these, not the page, so Phase 8 (Packing + Versions)
 * fills its slots by editing this file alone.
 *
 * PHASE 8 CONTRACT
 * - `usePackingTabCount` returns `Packing n/m` (planned / total). It is a stub
 *   here; Phase 8 replaces its body with `packingCounts()` (and may add args;
 *   its one caller is `useJobTabCounts` below).
 * - `Versions n` is `versions.length` from the version context, already wired.
 * - `JOB_TAB_PRIMARY` maps a tab to its one primary (`+ Add case`, `Save as new
 *   version`), rendered at the right of the tab row on desktop. Agreed rule
 *   (Q7): outline style on desktop; the red sticky bar is phone-only. One red
 *   primary per screen, and the header's `Advance to …` is it.
 */

export interface JobTabPrimaryProps {
  projectId: string;
  orgId: string | undefined;
}

/** Phase 8 adds `packing` and `versions` entries. */
export const JOB_TAB_PRIMARY: Partial<Record<JobTabKey, React.ComponentType<JobTabPrimaryProps>>> = {};

/** `Packing n/m`. Phase 8 owns this derivation; `undefined` shows the bare word. */
export function usePackingTabCount(): JobTabCounts["packing"] {
  return undefined;
}

/** Every count the strip shows. Must render inside `ProjectVersionProvider`. */
export function useJobTabCounts(projectId: string, filesCount: number): JobTabCounts {
  const { tasks } = useProjectTaskList(projectId);
  const { versions } = useProjectVersion();
  const packing = usePackingTabCount();
  return {
    tasks: {
      done: tasks.filter((t) => t.status === "DONE").length,
      total: tasks.filter((t) => t.status !== "CANCELLED").length,
    },
    files: filesCount,
    packing,
    versions: versions.length,
  };
}
