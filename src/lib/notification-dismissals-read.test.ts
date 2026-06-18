import { describe, it, expect } from "vitest";
import {
  mapNotificationDismissal,
  filterDismissalsByUser,
} from "@/lib/notification-dismissals-read";
import type { Doc } from "../../convex/_generated/dataModel";

type Raw = Doc<"notificationDismissals">;

function raw(p: Partial<Raw>): Raw {
  return {
    _id: "x" as Raw["_id"],
    _creationTime: 0,
    id: "d",
    organizationId: "org",
    userId: "u",
    notificationKey: "k",
    ...p,
  } as Raw;
}

describe("mapNotificationDismissal", () => {
  it("maps epoch-ms dismissedAt to Date and passes scalars", () => {
    const row = mapNotificationDismissal(
      raw({ id: "d1", userId: "u1", notificationKey: "maint-1", dismissedAt: 1000 }),
    );
    expect(row.id).toBe("d1");
    expect(row.notificationKey).toBe("maint-1");
    expect(row.dismissedAt).toEqual(new Date(1000));
  });

  it("maps absent dismissedAt to null", () => {
    expect(mapNotificationDismissal(raw({ dismissedAt: undefined })).dismissedAt).toBeNull();
  });
});

describe("filterDismissalsByUser", () => {
  it("returns only the rows for the given user", () => {
    const rows = [
      mapNotificationDismissal(raw({ id: "a", userId: "u1", notificationKey: "k1" })),
      mapNotificationDismissal(raw({ id: "b", userId: "u2", notificationKey: "k2" })),
      mapNotificationDismissal(raw({ id: "c", userId: "u1", notificationKey: "k3" })),
    ];
    const out = filterDismissalsByUser(rows, "u1");
    expect(out.map((r) => r.notificationKey)).toEqual(["k1", "k3"]);
  });

  it("returns empty for a user with no dismissals", () => {
    expect(filterDismissalsByUser([], "u1")).toEqual([]);
  });
});
