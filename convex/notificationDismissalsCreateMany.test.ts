// @vitest-environment node
//
// notificationDismissals.createManyIfMissing — bulk single-call for the
// /notifications "Dismiss All" (the page was localStorage-only). Verifies: one
// array insert, idempotent per (userId, notificationKey), a mixed new/existing
// batch reports created/skipped correctly, and browser (non-service) callers are
// rejected.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);

const keysFor = (t: ReturnType<typeof makeT>, userId: string) =>
  t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notificationDismissals")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.notificationKey).sort();
  });

describe("notificationDismissals.createManyIfMissing", () => {
  test("inserts all keys in one call", async () => {
    const t = makeT();
    const res = await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [
        { id: "d1", notificationKey: "k1", dismissedAt: NOW },
        { id: "d2", notificationKey: "k2", dismissedAt: NOW },
        { id: "d3", notificationKey: "k3", dismissedAt: NOW },
      ],
    });
    expect(res).toEqual({ created: 3, skipped: 0 });
    expect(await keysFor(t, USER)).toEqual(["k1", "k2", "k3"]);
  });

  test("is idempotent per (userId, notificationKey) — a mixed batch skips existing", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [{ id: "d1", notificationKey: "k1", dismissedAt: NOW }],
    });
    // k1 already dismissed; k2/k3 are new.
    const res = await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [
        { id: "d1b", notificationKey: "k1", dismissedAt: NOW + 1 },
        { id: "d2", notificationKey: "k2", dismissedAt: NOW + 1 },
        { id: "d3", notificationKey: "k3", dismissedAt: NOW + 1 },
      ],
    });
    expect(res).toEqual({ created: 2, skipped: 1 });
    expect(await keysFor(t, USER)).toEqual(["k1", "k2", "k3"]); // no dup k1
  });

  test("dismissals are scoped per user — a second user does not see the first's keys", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [{ id: "d1", notificationKey: "k1", dismissedAt: NOW }],
    });
    // Same key, different user → not skipped (per-user dedup).
    const res = await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: "user_2",
      items: [{ id: "d2", notificationKey: "k1", dismissedAt: NOW }],
    });
    expect(res).toEqual({ created: 1, skipped: 0 });
    expect(await keysFor(t, USER)).toEqual(["k1"]);
    expect(await keysFor(t, "user_2")).toEqual(["k1"]);
  });

  test("dedup is PER-ORG — a multi-org user can dismiss the same constant key in each org", async () => {
    const t = makeT();
    // Same user, same constant key (e.g. "crew-pending-offers"), two orgs.
    await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [{ id: "d1", notificationKey: "crew-pending-offers", dismissedAt: NOW }],
    });
    // In OTHER org the key must NOT be deduped against the org_1 row → it inserts.
    const res = await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: OTHER,
      userId: USER,
      items: [{ id: "d2", notificationKey: "crew-pending-offers", dismissedAt: NOW }],
    });
    expect(res).toEqual({ created: 1, skipped: 0 });
    // Re-dismissing in ORG is still a no-op (same org).
    const again = await t.withIdentity(SERVICE).mutation(api.notificationDismissals.createManyIfMissing, {
      organizationId: ORG,
      userId: USER,
      items: [{ id: "d3", notificationKey: "crew-pending-offers", dismissedAt: NOW }],
    });
    expect(again).toEqual({ created: 0, skipped: 1 });
    // One row per org.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("notificationDismissals").withIndex("by_userId", (q) => q.eq("userId", USER)).collect(),
    );
    expect(rows.map((r) => r.organizationId).sort()).toEqual([ORG, OTHER].sort());
  });

  test("rejects a non-service (browser) caller", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG }).mutation(api.notificationDismissals.createManyIfMissing, {
        organizationId: ORG,
        userId: USER,
        items: [{ id: "d1", notificationKey: "k1", dismissedAt: NOW }],
      }),
    ).rejects.toThrow();
  });
});
