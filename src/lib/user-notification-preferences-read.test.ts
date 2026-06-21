import { describe, it, expect } from "vitest";
import { resolvePreferenceValues } from "@/lib/user-notification-preferences-read";
import { NOTIFICATION_PREFERENCE_DEFAULTS } from "@/lib/validations/notification-preferences";
import type { Doc } from "../../convex/_generated/dataModel";

type Raw = Doc<"userNotificationPreferences">;

function raw(p: Partial<Raw>): Raw {
  return {
    _id: "x" as Raw["_id"],
    _creationTime: 0,
    id: "p",
    userId: "u",
    ...p,
  } as Raw;
}

describe("resolvePreferenceValues", () => {
  it("returns conservative defaults when no row exists", () => {
    expect(resolvePreferenceValues(null)).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
    expect(resolvePreferenceValues(undefined)).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
  });

  it("uses stored boolean values when present", () => {
    const out = resolvePreferenceValues(
      raw({
        overdueMaintenance: false,
        overdueReturn: false,
        upcomingProject: true,
        pendingInvitation: false,
        pendingOffers: true,
        pendingTimesheets: true,
        flaggedAsset: false,
      }),
    );
    expect(out).toEqual({
      overdueMaintenance: false,
      overdueReturn: false,
      upcomingProject: true,
      pendingInvitation: false,
      pendingOffers: true,
      pendingTimesheets: true,
      flaggedAsset: false,
    });
  });

  it("coerces absent optional booleans to the Prisma column defaults", () => {
    // Row exists but every flag is absent (Convex stores them as optionals) —
    // each field falls back to its conservative default, not to false-everywhere.
    const out = resolvePreferenceValues(raw({}));
    expect(out).toEqual(NOTIFICATION_PREFERENCE_DEFAULTS);
  });

  it("does not surface lowStock / expiringCert columns", () => {
    const out = resolvePreferenceValues(raw({ lowStock: false, expiringCert: false }));
    expect(out).not.toHaveProperty("lowStock");
    expect(out).not.toHaveProperty("expiringCert");
  });
});
