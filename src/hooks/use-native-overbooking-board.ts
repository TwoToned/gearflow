"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/** Preference default (spec decision, WS3 #942): 30-day horizon, URL params +
 *  localStorage own persistence — no org-settings storage. */
export const DEFAULT_OVERBOOKING_RANGE_DAYS = 30;
export const OVERBOOKING_RANGE_STORAGE_KEY = "overbookings.rangeDays";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

export interface OverbookingProjectRef {
  id: string;
  name: string;
  projectNumber: string;
}

export interface OverbookingGearRow {
  modelId: string;
  modelName: string;
  qty: number;
  spanStart: number;
  spanEnd: number;
  projects: OverbookingProjectRef[];
}

/** WS11 (#950) — `contributingSaleLines` supersedes the old per-bulk-asset-row
 *  `contributingBulkAssets` shape now that Model.saleStockQuantity is the real
 *  per-model sale-stock pool. */
export interface OverbookingSaleStockContributingLine {
  lineItemId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  quantity: number;
}

export interface OverbookingSaleStockRow {
  modelId: string;
  modelName: string;
  shortfallQty: number;
  contributingSaleLines: OverbookingSaleStockContributingLine[];
}

export interface OverbookingMissingCrewRow {
  serviceId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  title: string;
  date: number | null;
  crewCountRequired: number;
  assignedCount: number;
  shortfall: number;
}

export interface OverbookingUnconfirmedCrewRow {
  assignmentId: string;
  crewMemberId: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  startDate: number | null;
  status: string;
}

export interface OverbookingDoubleBookingRow {
  crewMemberId: string;
  severity: "hard" | "soft";
  label: string;
  a: { assignmentId: string; projectId: string; projectName: string; projectNumber: string; startDate: number | null; endDate: number | null };
  b: { assignmentId: string; projectId: string; projectName: string; projectNumber: string; startDate: number | null; endDate: number | null } | null;
}

export interface OverbookingBoardData {
  range: { start: number; end: number };
  gearHard: OverbookingGearRow[];
  gearPencilled: OverbookingGearRow[];
  saleStockToProcure: OverbookingSaleStockRow[];
  servicesMissingCrew: OverbookingMissingCrewRow[];
  unconfirmedCrew: OverbookingUnconfirmedCrewRow[];
  crewDoubleBookings: OverbookingDoubleBookingRow[];
}

/**
 * overbookingBoard.bundle — the full Overbookings & Gaps board, reactive.
 * `rangeDays` is minute-bucketed against "now" so the subscription key stays
 * stable within a minute (queries can't read the clock themselves, same
 * convention as `use-native-dashboard.ts`).
 */
export function useNativeOverbookingBoard(
  orgId: string | undefined,
  rangeDays: number,
): { data: OverbookingBoardData | undefined; isLoading: boolean } {
  const enabled = !!orgId;
  const nowBucket = enabled ? Math.floor(Date.now() / MINUTE) * MINUTE : 0;
  const rangeEnd = enabled ? nowBucket + rangeDays * DAY_MS : 0;
  const data = useAuthedQuery(
    api.overbookingBoard.bundle,
    enabled ? { orgId: orgId!, rangeStart: nowBucket, rangeEnd } : "skip",
  ) as OverbookingBoardData | undefined;
  return { data, isLoading: enabled && data === undefined };
}
