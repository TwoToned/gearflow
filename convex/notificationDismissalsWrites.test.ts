// @vitest-environment node
//
// convex/notificationDismissalsWrites.ts — browser-direct USER-scoped dismissal
// read + writes. Verifies: userId + orgId derived from the VERIFIED token (never a
// client arg), mine() is org+user scoped, dismissManyNative is idempotent per-org
// (constant crew keys re-dismissable per org), incoming-dup dedup, pruneStaleNative
// removes only the caller's stale rows, cross-user/cross-org isolation, and
// anon/org-less rejection.
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

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const items = (...keys: string[]) => keys.map((notificationKey, i) => ({ id: `d${i}`, notificationKey }));

describe("notificationDismissalsWrites", () => {
  test("dismissManyNative derives org+user from the token and mine() reads them back", async () => {
    const t = makeT();
    const res = await t
      .withIdentity(asUser)
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1", "k2"), now: NOW });
    expect(res).toEqual({ created: 2, skipped: 0 });
    const keys = await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {});
    expect(keys.sort()).toEqual(["k1", "k2"]);
    // The row is stamped with the VERIFIED org+user, not any client-supplied value.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("notificationDismissals").withIndex("by_userId", (q) => q.eq("userId", USER)).collect(),
    );
    expect(rows.every((r) => r.organizationId === ORG && r.userId === USER)).toBe(true);
  });

  test("is idempotent per-org; a mixed batch reports created/skipped and never dups", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1"), now: NOW });
    const res = await t
      .withIdentity(asUser)
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1", "k2", "k3"), now: NOW });
    expect(res).toEqual({ created: 2, skipped: 1 });
    const keys = await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {});
    expect(keys.sort()).toEqual(["k1", "k2", "k3"]);
  });

  test("dedups incoming duplicate keys in a single call", async () => {
    const t = makeT();
    const res = await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.dismissManyNative, {
      items: [
        { id: "a", notificationKey: "k1" },
        { id: "b", notificationKey: "k1" },
        { id: "c", notificationKey: "k2" },
      ],
      now: NOW,
    });
    expect(res).toEqual({ created: 2, skipped: 0 });
  });

  test("dedup is PER-ORG — the same constant crew key dismisses independently in each org", async () => {
    const t = makeT();
    await t
      .withIdentity({ subject: USER, orgId: ORG })
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("crew-pending-offers"), now: NOW });
    // Same user, OTHER org → not deduped against the org_1 row → inserts.
    const res = await t
      .withIdentity({ subject: USER, orgId: OTHER_ORG })
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("crew-pending-offers"), now: NOW });
    expect(res).toEqual({ created: 1, skipped: 0 });
    // mine() is org-scoped: each org sees exactly its own row.
    expect(await t.withIdentity({ subject: USER, orgId: ORG }).query(api.notificationDismissalsWrites.mine, {})).toEqual([
      "crew-pending-offers",
    ]);
    expect(await t.withIdentity({ subject: USER, orgId: OTHER_ORG }).query(api.notificationDismissalsWrites.mine, {})).toEqual([
      "crew-pending-offers",
    ]);
  });

  test("mine() is user-scoped — a second user does not see the first's dismissals", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1"), now: NOW });
    const otherKeys = await t
      .withIdentity({ subject: OTHER_USER, orgId: ORG })
      .query(api.notificationDismissalsWrites.mine, {});
    expect(otherKeys).toEqual([]);
  });

  test("pruneStaleNative removes only the caller's keys not in the active set", async () => {
    const t = makeT();
    await t
      .withIdentity(asUser)
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1", "k2", "k3"), now: NOW });
    // Another user's row must be untouched by this caller's prune.
    await t
      .withIdentity({ subject: OTHER_USER, orgId: ORG })
      .mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1"), now: NOW });
    const res = await t
      .withIdentity(asUser)
      .mutation(api.notificationDismissalsWrites.pruneStaleNative, { activeKeys: ["k2"] });
    expect(res).toEqual({ removed: 2 }); // k1 + k3 pruned, k2 kept
    expect(await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {})).toEqual(["k2"]);
    // OTHER_USER's k1 survives.
    expect(await t.withIdentity({ subject: OTHER_USER, orgId: ORG }).query(api.notificationDismissalsWrites.mine, {})).toEqual([
      "k1",
    ]);
  });

  test("empty activeKeys prunes everything for the caller", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1", "k2"), now: NOW });
    const res = await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.pruneStaleNative, { activeKeys: [] });
    expect(res).toEqual({ removed: 2 });
    expect(await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {})).toEqual([]);
  });

  test("anon / org-less callers: mine() returns [], writes reject", async () => {
    const t = makeT();
    // Anonymous.
    expect(await t.query(api.notificationDismissalsWrites.mine, {})).toEqual([]);
    await expect(
      t.mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1"), now: NOW }),
    ).rejects.toThrow();
    // Signed in but no active org.
    expect(await t.withIdentity({ subject: USER }).query(api.notificationDismissalsWrites.mine, {})).toEqual([]);
    await expect(
      t.withIdentity({ subject: USER }).mutation(api.notificationDismissalsWrites.pruneStaleNative, { activeKeys: [] }),
    ).rejects.toThrow();
  });
});
