/**
 * Convex-importable copy of the user-notification-preference resolve logic
 * (Phase 3 browser-direct read/write re-homing).
 *
 * The canonical source is `src/lib/validations/notification-preferences.ts` +
 * `src/lib/user-notification-preferences-read.ts`, but the Convex bundler can't
 * resolve the `@/` path alias, so the DEFAULTS + coercion are duplicated here
 * byte-for-byte and pinned to the source by `convex/notificationPreferences.test.ts`.
 *
 * One row per user (`userNotificationPreferences`, natural key `userId`). The Convex
 * columns are optionals; a missing row or field resolves to the conservative default,
 * matching the deleted `getNotificationPreferences` server action.
 */

/** The seven form-controlled email opt-in flags. Mirrors NotificationPreferenceValues. */
export interface NotificationPreferenceValues {
  overdueMaintenance: boolean;
  overdueReturn: boolean;
  upcomingProject: boolean;
  pendingInvitation: boolean;
  pendingOffers: boolean;
  pendingTimesheets: boolean;
  flaggedAsset: boolean;
}

/** The single source of truth for preference defaults — mirrors the Prisma model. */
export const NOTIFICATION_PREFERENCE_DEFAULTS: NotificationPreferenceValues = {
  overdueMaintenance: true,
  overdueReturn: true,
  upcomingProject: false,
  pendingInvitation: true,
  pendingOffers: false,
  pendingTimesheets: false,
  flaggedAsset: true,
};

/** A raw Convex row — the seven flags as optionals (plus other columns we ignore). */
export interface RawPreferenceRow {
  overdueMaintenance?: boolean;
  overdueReturn?: boolean;
  upcomingProject?: boolean;
  pendingInvitation?: boolean;
  pendingOffers?: boolean;
  pendingTimesheets?: boolean;
  flaggedAsset?: boolean;
}

/** Coerce a Convex optional boolean to the Prisma `@default` for that column. */
function coerce(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Resolve a raw Convex row (or absence) into the consumed preference values, applying
 * the conservative defaults when a row or a field is missing. Byte-for-byte mirror of
 * `resolvePreferenceValues` in src/lib/user-notification-preferences-read.ts.
 */
export function resolvePreferenceValues(
  raw: RawPreferenceRow | null | undefined,
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
  };
}
