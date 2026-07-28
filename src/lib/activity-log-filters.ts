/**
 * Shared activity-log filter shape + date coercion. Plain module (not "use server")
 * so both the browser-direct read hook (`use-activity-log.ts`) and the server-only CSV
 * export (`src/server/activity-log.ts`) can import it.
 */

export interface ActivityLogFilters {
  page?: number;
  pageSize?: number;
  entityType?: string;
  action?: string;
  userId?: string;
  entityId?: string;
  projectId?: string;
  assetId?: string;
  search?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  sort?: string;
  order?: "asc" | "desc";
  /** Phase 4 (#1000): `true` shows only API-key-authored rows, `false` only
   *  human-authored, omitted shows both. See `convex/activityLog.ts` `isAgentAuthored`. */
  agentAuthored?: boolean;
}

/** Filter date → epoch ms. */
export function startMs(d?: string | Date): number | undefined {
  return d != null ? new Date(d).getTime() : undefined;
}

/** endDate is pushed to end-of-day (Prisma parity). */
export function endMs(d?: string | Date): number | undefined {
  if (d == null) return undefined;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}
