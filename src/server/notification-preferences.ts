"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  notificationPreferenceSchema,
  type NotificationPreferenceValues,
} from "@/lib/validations/notification-preferences";

/**
 * Return the current user's notification email preferences. Lazily creates
 * a row at conservative defaults the first time it's read.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferenceValues> {
  const { userId } = await getOrgContext();

  const existing = await prisma.userNotificationPreference.findUnique({
    where: { userId },
  });

  if (existing) {
    return serialize({
      overdueMaintenance: existing.overdueMaintenance,
      overdueReturn: existing.overdueReturn,
      upcomingProject: existing.upcomingProject,
      lowStock: existing.lowStock,
      pendingInvitation: existing.pendingInvitation,
      pendingOffers: existing.pendingOffers,
      pendingTimesheets: existing.pendingTimesheets,
      flaggedAsset: existing.flaggedAsset,
    }) as NotificationPreferenceValues;
  }

  return serialize({ ...NOTIFICATION_PREFERENCE_DEFAULTS }) as NotificationPreferenceValues;
}

/**
 * Upsert the current user's preferences. Returns the saved values.
 */
export async function updateNotificationPreferences(
  input: NotificationPreferenceValues,
): Promise<NotificationPreferenceValues> {
  const parsed = notificationPreferenceSchema.parse(input);
  const { organizationId, userId, userName } = await getOrgContext();

  const saved = await prisma.userNotificationPreference.upsert({
    where: { userId },
    create: { userId, ...parsed },
    update: { ...parsed },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "UserNotificationPreference",
    entityId: saved.id,
    entityName: "Notification preferences",
    summary: "Updated email notification preferences",
  });

  return serialize({
    overdueMaintenance: saved.overdueMaintenance,
    overdueReturn: saved.overdueReturn,
    upcomingProject: saved.upcomingProject,
    lowStock: saved.lowStock,
    pendingInvitation: saved.pendingInvitation,
    pendingOffers: saved.pendingOffers,
    pendingTimesheets: saved.pendingTimesheets,
    flaggedAsset: saved.flaggedAsset,
  }) as NotificationPreferenceValues;
}
