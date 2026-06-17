import { z } from "zod";

/**
 * Per-user opt-in flags for email delivery of in-app notifications.
 *
 * Schema lives outside any "use server" file so it can be imported on both
 * the client (form resolver) and the server (action input parsing).
 */
export const notificationPreferenceSchema = z.object({
  overdueMaintenance: z.boolean(),
  overdueReturn: z.boolean(),
  upcomingProject: z.boolean(),
  pendingInvitation: z.boolean(),
  pendingOffers: z.boolean(),
  pendingTimesheets: z.boolean(),
  flaggedAsset: z.boolean(),
});

export type NotificationPreferenceInput = z.input<typeof notificationPreferenceSchema>;
export type NotificationPreferenceValues = z.infer<typeof notificationPreferenceSchema>;

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

/** Maps an AppNotification.type to the preference field that controls it. */
export const NOTIFICATION_TYPE_TO_PREFERENCE: Record<string, keyof NotificationPreferenceValues> = {
  overdue_maintenance: "overdueMaintenance",
  overdue_return: "overdueReturn",
  upcoming_project: "upcomingProject",
  pending_invitation: "pendingInvitation",
  pending_offers: "pendingOffers",
  pending_timesheets: "pendingTimesheets",
  flagged_asset: "flaggedAsset",
};

/** Human-readable labels for the preferences UI. */
export const NOTIFICATION_PREFERENCE_LABELS: Record<keyof NotificationPreferenceValues, { label: string; description: string }> = {
  overdueMaintenance: {
    label: "Overdue maintenance",
    description: "Email me when scheduled maintenance becomes overdue.",
  },
  overdueReturn: {
    label: "Overdue returns",
    description: "Email me when a project's rental end date passes with items still deployed.",
  },
  upcomingProject: {
    label: "Upcoming projects",
    description: "Email me when a project is starting within 3 days.",
  },
  pendingInvitation: {
    label: "Invitations",
    description: "Email me when I have a pending organization invitation.",
  },
  pendingOffers: {
    label: "Crew offers awaiting response",
    description: "Email me when there are crew offers waiting on a response.",
  },
  pendingTimesheets: {
    label: "Timesheets awaiting approval",
    description: "Email me when crew timesheets are submitted for approval.",
  },
  flaggedAsset: {
    label: "Flagged assets",
    description: "Email me when an asset is flagged as faulty or T&T overdue.",
  },
};
