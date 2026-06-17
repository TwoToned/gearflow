"use server";

import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  notificationPreferenceSchema,
  type NotificationPreferenceValues,
} from "@/lib/validations/notification-preferences";
import {
  getUserNotificationPreferenceRow,
  getUserNotificationPreferences,
} from "@/lib/user-notification-preferences-read";

// userNotificationPreference is CONVEX-ONLY (bucket-2 Phase B write inversion):
// one row per user (Prisma @unique on userId). Reads come from the Convex copy via
// src/lib/user-notification-preferences-read.ts; writes go to
// api.userNotificationPreferences.* with no Prisma row + no mirror. The @unique guard
// is re-implemented in app code (find-by-userId then update, else create) since Convex
// has no unique index. The Prisma `user_notification_preference` table is left
// unwritten until Phase C drops it.

/**
 * Return the current user's notification email preferences. Lazily creates
 * a row at conservative defaults the first time it's read.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferenceValues> {
  const { userId } = await getOrgContext();

  // Convex-only read; resolves to conservative defaults when no row exists.
  return serialize(
    await getUserNotificationPreferences(userId),
  ) as NotificationPreferenceValues;
}

/**
 * Upsert the current user's preferences. Returns the saved values.
 */
export async function updateNotificationPreferences(
  input: NotificationPreferenceValues,
): Promise<NotificationPreferenceValues> {
  const parsed = notificationPreferenceSchema.parse(input);
  const { organizationId, userId, userName } = await getOrgContext();

  // Convex-only upsert by the natural key (userId): find the existing row, patch it
  // if present, else create. `overdueReturn` is part of `parsed`; `lowStock` /
  // `expiringCert` are not in the form schema, so we leave any existing values as-is
  // (create defaults them to absent → false on read, matching the old behaviour).
  const convex = await getConvexClient();
  const existing = await getUserNotificationPreferenceRow(userId);
  const now = Date.now();
  let savedId: string;

  if (existing) {
    savedId = existing.id;
    await convex.mutation(api.userNotificationPreferences.update, {
      id: existing.id,
      patch: { ...parsed, updatedAt: now },
    });
  } else {
    savedId = createId();
    await convex.mutation(api.userNotificationPreferences.create, {
      id: savedId,
      userId,
      ...parsed,
      updatedAt: now,
    });
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "UserNotificationPreference",
    entityId: savedId,
    entityName: "Notification preferences",
    summary: "Updated email notification preferences",
  });

  // Return the saved form values (the resolved consumed shape).
  return serialize({ ...parsed }) as NotificationPreferenceValues;
}
