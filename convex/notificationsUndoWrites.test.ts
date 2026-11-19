// @vitest-environment node
//
// The two additive reverse mutations behind the shell bell's Undo (UX unification
// 6a / D70): notificationsWrites.markUnreadManyNative (undo of Mark all read) and
// notificationDismissalsWrites.undismissManyNative (undo of a dismissal). Verifies
// the owner can reverse, idempotence, that another user / another org can never
// touch the rows (cross-tenant rejection), the bulk cap, field caps, and anon rejection.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { notifyMentions } from "./lib/notify";

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

async function seedNotification(t: ReturnType<typeof makeT>, commentId: string, organizationId = ORG, userId = USER) {
  await t.run((ctx) =>
    notifyMentions(ctx, {
      organizationId,
      mentionedUserIds: [userId],
      actorUserId: "someone_else",
      actorName: "Someone Else",
      entityType: "project",
      entityId: "proj_1",
      commentId,
      commentBody: "hi",
    }),
  );
  const rows = await t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_organizationId_userId_createdAt", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .collect(),
  );
  return rows.at(-1)!; // newest by createdAt
}

describe("notificationsWrites.markUnreadManyNative", () => {
  test("undoes Mark all read for exactly the ids given, and is idempotent", async () => {
    const t = makeT();
    const a = await seedNotification(t, "c1");
    const b = await seedNotification(t, "c2");
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markAllReadNative, {});
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);

    const res = await t.withIdentity(asUser).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [a.id, b.id] });
    expect(res).toEqual({ marked: 2 });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(2);
    // A second call finds them already unread: nothing to restore, no error.
    expect(await t.withIdentity(asUser).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [a.id] })).toEqual({ marked: 0 });
  });

  test("only the ids given are un-read (a row the user had read earlier stays read)", async () => {
    const t = makeT();
    const early = await seedNotification(t, "c1");
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markReadNative, { id: early.id });
    const late = await seedNotification(t, "c2");
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markAllReadNative, {});
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [late.id] });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(1);
  });

  test("rejects another user's row and a row in another org (cross-tenant), changing nothing", async () => {
    const t = makeT();
    const mine = await seedNotification(t, "c1");
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markAllReadNative, {});
    await expect(
      t.withIdentity({ subject: OTHER_USER, orgId: ORG }).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [mine.id] }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: USER, orgId: OTHER_ORG }).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [mine.id] }),
    ).rejects.toThrow();
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);
  });

  test("caps the batch and the id length, and rejects anon / org-less callers", async () => {
    const t = makeT();
    const tooMany = Array.from({ length: 501 }, (_, i) => `id${i}`);
    await expect(t.withIdentity(asUser).mutation(api.notificationsWrites.markUnreadManyNative, { ids: tooMany })).rejects.toThrow(/limit/i);
    await expect(
      t.withIdentity(asUser).mutation(api.notificationsWrites.markUnreadManyNative, { ids: ["x".repeat(129)] }),
    ).rejects.toThrow(/at most 128/);
    await expect(t.mutation(api.notificationsWrites.markUnreadManyNative, { ids: [] })).rejects.toThrow();
    await expect(t.withIdentity({ subject: USER }).mutation(api.notificationsWrites.markUnreadManyNative, { ids: [] })).rejects.toThrow();
  });
});

describe("notificationDismissalsWrites.undismissManyNative", () => {
  const items = (...keys: string[]) => keys.map((notificationKey, i) => ({ id: `d${i}`, notificationKey }));

  test("restores a dismissed key for the caller in the active org, idempotently", async () => {
    const t = makeT();
    await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("k1", "k2"), now: NOW });
    const res = await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: ["k1"] });
    expect(res).toEqual({ restored: 1 });
    expect(await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {})).toEqual(["k2"]);
    expect(
      await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: ["k1"] }),
    ).toEqual({ restored: 0 });
  });

  test("never touches another user's or another org's dismissal of the same key", async () => {
    const t = makeT();
    const other = { subject: OTHER_USER, orgId: ORG };
    const sameUserOtherOrg = { subject: USER, orgId: OTHER_ORG };
    for (const who of [asUser, other, sameUserOtherOrg]) {
      await t.withIdentity(who).mutation(api.notificationDismissalsWrites.dismissManyNative, { items: items("crew-pending-offers"), now: NOW });
    }
    await t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: ["crew-pending-offers"] });
    expect(await t.withIdentity(asUser).query(api.notificationDismissalsWrites.mine, {})).toEqual([]);
    expect(await t.withIdentity(other).query(api.notificationDismissalsWrites.mine, {})).toEqual(["crew-pending-offers"]);
    expect(await t.withIdentity(sameUserOtherOrg).query(api.notificationDismissalsWrites.mine, {})).toEqual(["crew-pending-offers"]);
  });

  test("caps the batch and key length, and rejects anon / org-less callers", async () => {
    const t = makeT();
    const tooMany = Array.from({ length: 501 }, (_, i) => `k${i}`);
    await expect(
      t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: tooMany }),
    ).rejects.toThrow(/limit/i);
    await expect(
      t.withIdentity(asUser).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: ["k".repeat(257)] }),
    ).rejects.toThrow(/at most 256/);
    await expect(t.mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: [] })).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: USER }).mutation(api.notificationDismissalsWrites.undismissManyNative, { notificationKeys: [] }),
    ).rejects.toThrow();
  });
});
