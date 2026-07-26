"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * WS6 #945 — `/maintenance/due` worklist read (convex/maintenanceScheduleWorklist.ts).
 */

export interface WorklistUnit {
  assetId: string;
  assetTag: string;
  customName: string | null;
  checkedOff: boolean;
}

export interface WorklistSection {
  scheduleId: string;
  scheduleName: string;
  modelId: string;
  modelName: string;
  recordId: string;
  dueDate: string;
  status: string;
  poolQuantitySnapshot: number;
  progress: number;
  isBulk: boolean;
  units?: WorklistUnit[];
  bulkAssetId?: string | null;
  bulkAssetTag?: string | null;
}

export interface DueWorklist {
  stats: { overdue: number; dueSoon: number; inProgress: number };
  sections: WorklistSection[];
}

/** Minute-bucketed `now` so the subscription arg is stable within a minute. */
const MINUTE = 60_000;

export function useMaintenanceWorklist(orgId: string | undefined): DueWorklist | undefined {
  const nowBucket = Math.floor(Date.now() / MINUTE) * MINUTE;
  return useAuthedQuery(
    api.maintenanceScheduleWorklist.dueWorklist,
    orgId ? { orgId, nowMs: nowBucket } : "skip",
  ) as DueWorklist | undefined;
}
