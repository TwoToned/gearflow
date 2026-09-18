// @vitest-environment node
//
// convex/dashboardLayouts.ts — the customizable dashboard's per-user widget
// board. Modeled on savedTableViewsWrites.test.ts: verifies
// userId/orgId are derived from the VERIFIED token (never a client arg),
// upsert-not-duplicate on repeated saves, cross-user/cross-org isolation,
// geometry validation, and the widget-count cap.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const OTHER_USER = "user_2";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };
const asOtherUser = { subject: OTHER_USER, orgId: ORG };
const asOtherOrgUser = { subject: USER, orgId: OTHER_ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const WIDGET = { id: "onTheFloorNow", kind: "onTheFloorNow", x: 0, y: 0, w: 12, h: 4 };

describe("dashboardLayouts", () => {
  test("get returns null before any save", async () => {
    const t = makeT();
    expect(await t.withIdentity(asUser).query(api.dashboardLayouts.get, {})).toBeNull();
  });

  test("saveNative then get round-trips the caller's own widgets", async () => {
    const t = makeT();
    const res = await t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, {
      id: "row1",
      widgets: [WIDGET],
      now: NOW,
    });
    expect(res).toEqual({ ok: true });
    const got = await t.withIdentity(asUser).query(api.dashboardLayouts.get, {});
    expect(got?.widgets).toEqual([WIDGET]);
    expect(got?.updatedAt).toBe(NOW);
  });

  test("a second save UPSERTS in place — no duplicate row", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: [WIDGET], now: NOW });
    const second = { ...WIDGET, w: 6 };
    await t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: [second], now: NOW + 1 });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("dashboardLayouts").withIndex("by_organizationId_userId", (q) => q.eq("organizationId", ORG).eq("userId", USER)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].widgets).toEqual([second]);
    expect(rows[0].updatedAt).toBe(NOW + 1);
  });

  test("a different user in the same org has their own, independent row", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: [WIDGET], now: NOW });
    expect(await t.withIdentity(asOtherUser).query(api.dashboardLayouts.get, {})).toBeNull();

    await t.withIdentity(asOtherUser).mutation(api.dashboardLayouts.saveNative, {
      id: "row2",
      widgets: [{ ...WIDGET, id: "recentActivity", kind: "recentActivity" }],
      now: NOW,
    });
    const mine = await t.withIdentity(asUser).query(api.dashboardLayouts.get, {});
    expect(mine?.widgets).toEqual([WIDGET]);
  });

  test("the same user in a different org has their own, independent row (R-8.4.3)", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: [WIDGET], now: NOW });
    expect(await t.withIdentity(asOtherOrgUser).query(api.dashboardLayouts.get, {})).toBeNull();
  });

  test("rejects an anonymous caller", async () => {
    const t = makeT();
    await expect(t.mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: [WIDGET], now: NOW })).rejects.toThrow(
      /Unauthorized/i,
    );
    expect(await t.query(api.dashboardLayouts.get, {})).toBeNull();
  });

  test("rejects invalid widget geometry", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, {
        id: "row1",
        widgets: [{ ...WIDGET, w: 0 }],
        now: NOW,
      }),
    ).rejects.toThrow(/invalid widget size/i);
    await expect(
      t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, {
        id: "row1",
        widgets: [{ ...WIDGET, x: -1 }],
        now: NOW,
      }),
    ).rejects.toThrow(/invalid widget position/i);
  });

  test("rejects a duplicate widget id", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, {
        id: "row1",
        widgets: [WIDGET, WIDGET],
        now: NOW,
      }),
    ).rejects.toThrow(/duplicate widget id/i);
  });

  test("rejects more than the widget cap", async () => {
    const t = makeT();
    const many = Array.from({ length: 41 }, (_, i) => ({ ...WIDGET, id: `w${i}` }));
    await expect(
      t.withIdentity(asUser).mutation(api.dashboardLayouts.saveNative, { id: "row1", widgets: many, now: NOW }),
    ).rejects.toThrow(/at most 40/i);
  });
});
