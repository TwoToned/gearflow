import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the notification-dismissal domain (bucket-2 of the
 * Convex domain-only decommission, Phase B). `notificationDismissal` is now
 * Convex-only — written via api.notificationDismissals.* in src/server/notifications.ts
 * and backfilled by scripts/convex-backfill-notification-dismissals.ts.
 *
 * These helpers read the Convex copy and shape it back into the Prisma-row form the
 * notification server actions used (epoch-ms → Date). The only consumed columns are
 * `userId`, `notificationKey`, and `dismissedAt`.
 *
 * `api.notificationDismissals.list({ orgId })` returns every dismissal for an org;
 * the per-user filter the old Prisma `where: { userId }` query applied is reproduced
 * here in pure JS so it stays unit-testable with no Prisma fallback on a miss.
 */

type RawNotificationDismissal = Doc<"notificationDismissals">;

const toDate = (value: number | undefined): Date | null =>
  typeof value === "number" ? new Date(value) : null;

export interface NotificationDismissalRow {
  id: string;
  organizationId: string;
  userId: string;
  notificationKey: string;
  dismissedAt: Date | null;
}

export function mapNotificationDismissal(
  d: RawNotificationDismissal,
): NotificationDismissalRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    userId: d.userId,
    notificationKey: d.notificationKey,
    // Prisma column has @default(now()); Convex stores it as an optional.
    dismissedAt: toDate(d.dismissedAt),
  };
}

/** All dismissals for one user within an org (org already scoped by the Convex query). */
export function filterDismissalsByUser(
  rows: NotificationDismissalRow[],
  userId: string,
): NotificationDismissalRow[] {
  return rows.filter((r) => r.userId === userId);
}

/**
 * The notification keys the user has dismissed — the Convex-read replacement for the
 * Prisma `findMany({ where: { userId }, select: { notificationKey } })` in
 * `getDismissedKeys`.
 */
export async function getDismissedKeysForUser(
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.notificationDismissals.list, {
      orgId: organizationId,
    }),
  )) as RawNotificationDismissal[];
  return filterDismissalsByUser(rows.map(mapNotificationDismissal), userId).map(
    (r) => r.notificationKey,
  );
}

/**
 * The full dismissal rows for one user — used by the write paths (dismiss / prune)
 * to find existing rows by their natural key (userId, notificationKey), since Convex
 * has no unique index to upsert against.
 */
export async function getDismissalsForUser(
  organizationId: string,
  userId: string,
): Promise<NotificationDismissalRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.notificationDismissals.list, {
      orgId: organizationId,
    }),
  )) as RawNotificationDismissal[];
  return filterDismissalsByUser(rows.map(mapNotificationDismissal), userId);
}
