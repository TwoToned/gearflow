// @vitest-environment node
//
// convex/userNotificationPreferences.ts — browser-direct USER-scoped read (mine) +
// write (upsertMine). Verifies: keyed on the VERIFIED token subject (not a client
// arg), defaults on a missing row, upsert preserves non-form columns, cross-user
// isolation, actor-spoof resistance, atomic audit, and defaults/resolve parity with
// the canonical src helpers.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS as CONVEX_DEFAULTS,
  resolvePreferenceValues as convexResolve,
} from "./lib/notificationPreferences";
import {
  NOTIFICATION_PREFERENCE_DEFAULTS as SRC_DEFAULTS,
} from "@/lib/validations/notification-preferences";
import { resolvePreferenceValues as srcResolve } from "@/lib/user-notification-preferences-read";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const OTHER_USER = "user_2";
const NOW = 1_700_000_000_000;

const ALL_ON = {
  overdueMaintenance: true,
  overdueReturn: true,
  upcomingProject: true,
  pendingInvitation: true,
  pendingOffers: true,
  pendingTimesheets: true,
  flaggedAsset: true,
};

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const asUser = (userId: string) => ({ subject: userId, orgId: ORG });

describe("userNotificationPreferences.mine / upsertMine", () => {
  test("mine returns conservative defaults when no row exists", async () => {
    const t = makeT();
    const got = await t.withIdentity(asUser(USER)).query(api.userNotificationPreferences.mine, {});
    expect(got).toEqual(SRC_DEFAULTS);
  });

  test("upsertMine creates a row keyed on the verified subject, mine reflects it", async () => {
    const t = makeT();
    await t.withIdentity(asUser(USER)).mutation(api.userNotificationPreferences.upsertMine, {
      id: "p1",
      prefs: ALL_ON,
      actor: { userId: USER, userName: "Alice" },
      auditId: "a1",
      now: NOW,
    });
    const row = await t.run(async (ctx) =>
      ctx.db.query("userNotificationPreferences").withIndex("by_userId", (q) => q.eq("userId", USER)).first(),
    );
    expect(row?.userId).toBe(USER);
    expect(row?.upcomingProject).toBe(true);
    const got = await t.withIdentity(asUser(USER)).query(api.userNotificationPreferences.mine, {});
    expect(got).toEqual(ALL_ON);
  });

  test("upsertMine patches the existing row and preserves non-form columns", async () => {
    const t = makeT();
    // Seed a row with lowStock/expiringCert set — columns the form never touches.
    await t.run(async (ctx) => {
      await ctx.db.insert("userNotificationPreferences", {
        id: "p1", userId: USER, lowStock: true, expiringCert: true, upcomingProject: false, updatedAt: 1,
      });
    });
    await t.withIdentity(asUser(USER)).mutation(api.userNotificationPreferences.upsertMine, {
      id: "p2-ignored",
      prefs: { ...ALL_ON, upcomingProject: true },
      actor: { userId: USER, userName: "Alice" },
      auditId: "a2",
      now: NOW,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("userNotificationPreferences").withIndex("by_userId", (q) => q.eq("userId", USER)).collect(),
    );
    expect(rows.length).toBe(1); // patched, not a second row
    expect(rows[0].id).toBe("p1"); // client-minted id ignored on the update branch
    expect(rows[0].upcomingProject).toBe(true);
    expect(rows[0].lowStock).toBe(true); // preserved
    expect(rows[0].expiringCert).toBe(true); // preserved
  });

  test("mine is keyed on the token subject, not a client arg (cross-user isolation)", async () => {
    const t = makeT();
    await t.withIdentity(asUser(USER)).mutation(api.userNotificationPreferences.upsertMine, {
      id: "p1", prefs: ALL_ON, actor: { userId: USER, userName: "Alice" }, auditId: "a1", now: NOW,
    });
    // A different user still sees defaults — cannot read USER's row.
    const other = await t.withIdentity(asUser(OTHER_USER)).query(api.userNotificationPreferences.mine, {});
    expect(other).toEqual(SRC_DEFAULTS);
  });

  test("upsertMine ignores a spoofed actor.userId — row keyed on the verified subject", async () => {
    const t = makeT();
    await t.withIdentity(asUser(USER)).mutation(api.userNotificationPreferences.upsertMine, {
      id: "p1",
      prefs: ALL_ON,
      actor: { userId: OTHER_USER, userName: "Impersonator" }, // spoofed
      auditId: "a1",
      now: NOW,
    });
    // The row + audit belong to the VERIFIED subject, not the spoofed userId.
    const victimRow = await t.run(async (ctx) =>
      ctx.db.query("userNotificationPreferences").withIndex("by_userId", (q) => q.eq("userId", OTHER_USER)).first(),
    );
    expect(victimRow).toBeNull();
    const audit = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first(),
    );
    expect(audit?.userId).toBe(USER);
  });

  test("writes an audit row", async () => {
    const t = makeT();
    await t.withIdentity(asUser(USER)).mutation(api.userNotificationPreferences.upsertMine, {
      id: "p1", prefs: ALL_ON, actor: { userId: USER, userName: "Alice" }, auditId: "a1", now: NOW,
    });
    const audit = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "a1")).first(),
    );
    expect(audit?.entityType).toBe("UserNotificationPreference");
    expect(audit?.action).toBe("updated");
  });

  test("mine rejects an anonymous caller", async () => {
    const t = makeT();
    await expect(t.query(api.userNotificationPreferences.mine, {})).rejects.toThrow(/Unauthorized/i);
  });

  test("upsertMine rejects a caller with no active organization", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: USER }).mutation(api.userNotificationPreferences.upsertMine, {
        id: "p1", prefs: ALL_ON, actor: { userId: USER, userName: "Alice" }, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/organization/i);
  });
});

describe("notificationPreferences parity (convex/lib mirrors src/lib)", () => {
  test("defaults match the canonical source", () => {
    expect(CONVEX_DEFAULTS).toEqual(SRC_DEFAULTS);
  });

  test("resolvePreferenceValues matches the source helper", () => {
    expect(convexResolve(null)).toEqual(srcResolve(null));
    expect(convexResolve({ overdueMaintenance: false, upcomingProject: true })).toEqual(
      srcResolve({ overdueMaintenance: false, upcomingProject: true } as never),
    );
    const full = { overdueMaintenance: false, overdueReturn: false, upcomingProject: true, pendingInvitation: false, pendingOffers: true, pendingTimesheets: true, flaggedAsset: false };
    expect(convexResolve(full)).toEqual(srcResolve(full as never));
  });
});
