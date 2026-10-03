// @vitest-environment node
//
// convex/pushSubscriptionsWrites.ts + pushSubscriptions.ts (#1244, design
// §13). Verifies: subscribe upserts by endpoint (never duplicates), a
// caller only ever unsubscribes their OWN (org, user) row, cross-org/
// cross-user isolation via the global by_endpoint index, and field bounds.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const OTHER_USER = "user_2";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };
const asOtherUser = { subject: OTHER_USER, orgId: OTHER_ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager", createdAt: 1 });
    await ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: OTHER_USER, role: "manager", createdAt: 1 });
  });
}

const rowByEndpoint = (t: T, endpoint: string) =>
  t.run((ctx) => ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).first());

describe("pushSubscriptionsWrites", () => {
  test("subscribeNative creates a row scoped to the caller's own org/user", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "p256dh-key", auth: "auth-secret", now: NOW,
    });
    const row = await rowByEndpoint(t, "https://fcm.googleapis.com/fcm/send/abc");
    expect(row?.organizationId).toBe(ORG);
    expect(row?.userId).toBe(USER);
  });

  test("rejects an endpoint that isn't a known push service — the server POSTs to it later", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
        endpoint: "https://169.254.169.254/latest/meta-data", p256dh: "k", auth: "a", now: NOW,
      }),
    ).rejects.toThrow(/supported push service/);
  });

  test("re-subscribing the SAME endpoint upserts, never duplicates", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "key1", auth: "auth1", now: NOW,
    });
    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "key2", auth: "auth2", now: NOW + 1,
    });
    const rows = await t.run((ctx) => ctx.db.query("pushSubscriptions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("key2");
  });

  test("unsubscribeNative removes only the caller's own row for that endpoint", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "key", auth: "auth", now: NOW,
    });
    // A different user/org calling unsubscribe on someone else's endpoint is a no-op.
    await t.withIdentity(asOtherUser).mutation(api.pushSubscriptionsWrites.unsubscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    expect(await rowByEndpoint(t, "https://fcm.googleapis.com/fcm/send/abc")).not.toBeNull();

    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.unsubscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    expect(await rowByEndpoint(t, "https://fcm.googleapis.com/fcm/send/abc")).toBeNull();
  });

  test("subscribeNative rejects an oversized field", async () => {
    const t = makeT(); await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "x".repeat(600), auth: "auth", now: NOW,
      }),
    ).rejects.toThrow(/at most/i);
  });

  test("isSubscribed reflects the caller's own org/user only", async () => {
    const t = makeT(); await seed(t);
    expect(await t.withIdentity(asUser).query(api.pushSubscriptions.isSubscribed, { orgId: ORG })).toBe(false);
    await t.withIdentity(asUser).mutation(api.pushSubscriptionsWrites.subscribeNative, {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "key", auth: "auth", now: NOW,
    });
    expect(await t.withIdentity(asUser).query(api.pushSubscriptions.isSubscribed, { orgId: ORG })).toBe(true);
    expect(await t.withIdentity(asOtherUser).query(api.pushSubscriptions.isSubscribed, { orgId: OTHER_ORG })).toBe(false);
  });
});
