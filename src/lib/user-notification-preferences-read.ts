import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  type NotificationPreferenceValues,
} from "@/lib/validations/notification-preferences";

/**
 * Server-side read helpers for the user-notification-preference domain (bucket-2 of
 * the Convex domain-only decommission, Phase B). `userNotificationPreference` is now
 * Convex-only — written via api.userNotificationPreferences.* in
 * src/server/notification-preferences.ts and backfilled by
 * scripts/convex-backfill-user-notification-preferences.ts.
 *
 * The table is one row per user (Prisma `@@unique` on userId), keyed by `userId` in
 * Convex (api.userNotificationPreferences.list({ userId })). These helpers read that
 * copy and resolve it into the consumed `NotificationPreferenceValues` shape, applying
 * the Prisma column defaults for any absent boolean (Convex stores them as optionals).
 *
 * Note: the Convex doc also carries `lowStock` / `expiringCert` columns that the
 * current `NotificationPreferenceValues` shape does not consume — they are mapped
 * through on the raw row but intentionally dropped from the resolved values, matching
 * the old server-action behaviour. No Prisma fallback on a miss.
 */

type RawUserNotificationPreference = Doc<"userNotificationPreferences">;

/** Coerce a Convex optional boolean to the Prisma `@default` for that column. */
function coerce(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Resolve a raw Convex row (or absence) into the consumed preference values, applying
 * the conservative defaults when a row or a field is missing. This is the Convex-read
 * replacement for `resolvePreferences` in notification-email-sender.ts and the body of
 * `getNotificationPreferences`.
 */
export function resolvePreferenceValues(
  raw: RawUserNotificationPreference | null | undefined,
): NotificationPreferenceValues {
  if (!raw) return { ...NOTIFICATION_PREFERENCE_DEFAULTS };
  return {
    overdueMaintenance: coerce(raw.overdueMaintenance, NOTIFICATION_PREFERENCE_DEFAULTS.overdueMaintenance),
    overdueReturn: coerce(raw.overdueReturn, NOTIFICATION_PREFERENCE_DEFAULTS.overdueReturn),
    upcomingProject: coerce(raw.upcomingProject, NOTIFICATION_PREFERENCE_DEFAULTS.upcomingProject),
    pendingInvitation: coerce(raw.pendingInvitation, NOTIFICATION_PREFERENCE_DEFAULTS.pendingInvitation),
    pendingOffers: coerce(raw.pendingOffers, NOTIFICATION_PREFERENCE_DEFAULTS.pendingOffers),
    pendingTimesheets: coerce(raw.pendingTimesheets, NOTIFICATION_PREFERENCE_DEFAULTS.pendingTimesheets),
    flaggedAsset: coerce(raw.flaggedAsset, NOTIFICATION_PREFERENCE_DEFAULTS.flaggedAsset),
    incidentReport: coerce(raw.incidentReport, NOTIFICATION_PREFERENCE_DEFAULTS.incidentReport),
  };
}

/**
 * The raw Convex preference row for a user (or null). The single-row natural key
 * (userId) means `list` returns at most one row; we take the first. Used by the write
 * path to find-then-update or create (Convex has no unique index to upsert against).
 */
export async function getUserNotificationPreferenceRow(
  userId: string,
): Promise<RawUserNotificationPreference | null> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.userNotificationPreferences.list, { userId }),
  )) as RawUserNotificationPreference[];
  return rows[0] ?? null;
}

/**
 * The current user's resolved preference values — the Convex-read replacement for the
 * Prisma `findUnique({ where: { userId } })` in `getNotificationPreferences`.
 */
export async function getUserNotificationPreferences(
  userId: string,
): Promise<NotificationPreferenceValues> {
  return resolvePreferenceValues(await getUserNotificationPreferenceRow(userId));
}

/**
 * Resolved preference values for many users (the email-sender fan-out). Reads each
 * user's row from Convex (one row per user) and resolves with defaults for the absent
 * ones, returning a Map keyed by userId.
 */
export async function getUserNotificationPreferenceMap(
  userIds: string[],
): Promise<Map<string, NotificationPreferenceValues>> {
  const convex = await getConvexClient();
  const unique = Array.from(new Set(userIds));
  const entries = await Promise.all(
    unique.map(async (userId): Promise<[string, NotificationPreferenceValues]> => {
      const rows = (await withConvexReadRetry(async () =>
        convex.query(api.userNotificationPreferences.list, { userId }),
      )) as RawUserNotificationPreference[];
      return [userId, resolvePreferenceValues(rows[0] ?? null)];
    }),
  );
  return new Map(entries);
}
