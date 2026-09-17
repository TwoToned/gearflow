// @vitest-environment node
//
// convex/notifications.ts + convex/notificationsWrites.ts — browser-direct
// USER-scoped notification reads/writes (work-layer phase 0, #1241). Verifies:
// organizationId + userId derived from the VERIFIED token (never a client arg),
// a user in two orgs sees only the active org's rows, markReadNative /
// markAllReadNative / archiveNative are idempotent, unread count matches the
// unread rows, a caller can't touch another user's notification even by
// guessing its id, and anon/org-less callers get empty reads + rejected writes.
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

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

/** Seed one "mentioned" notification for USER in ORG via the real write path. */
async function seedNotification(
  t: ReturnType<typeof makeT>,
  opts: { organizationId?: string; userId?: string; commentId?: string } = {},
) {
  await t.run((ctx) =>
    notifyMentions(ctx, {
      organizationId: opts.organizationId ?? ORG,
      mentionedUserIds: [opts.userId ?? USER],
      actorUserId: "someone_else",
      actorName: "Someone Else",
      entityType: "project",
      entityId: "proj_1",
      commentId: opts.commentId ?? "comment_1",
      commentBody: "hi",
    }),
  );
  return (
    await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_organizationId_userId_createdAt", (q) =>
          q.eq("organizationId", opts.organizationId ?? ORG).eq("userId", opts.userId ?? USER),
        )
        .collect(),
    )
  ).at(-1)!;
}

const asUser = { subject: USER, orgId: ORG };

describe("notifications reads (convex/notifications.ts)", () => {
  test("listForMe + unreadCountForMe are org+user scoped — a user in two orgs sees only the active org's rows", async () => {
    const t = makeT();
    await seedNotification(t, { organizationId: ORG, commentId: "c1" });
    await seedNotification(t, { organizationId: OTHER_ORG, commentId: "c2" });

    const inOrg = await t.withIdentity({ subject: USER, orgId: ORG }).query(api.notifications.listForMe, {});
    expect(inOrg.length).toBe(1);
    expect(inOrg[0].organizationId).toBe(ORG);
    expect(await t.withIdentity({ subject: USER, orgId: ORG }).query(api.notifications.unreadCountForMe, {})).toBe(1);

    const inOtherOrg = await t.withIdentity({ subject: USER, orgId: OTHER_ORG }).query(api.notifications.listForMe, {});
    expect(inOtherOrg.length).toBe(1);
    expect(inOtherOrg[0].organizationId).toBe(OTHER_ORG);
  });

  test("listForMe is user scoped — a second user in the same org sees nothing of the first's", async () => {
    const t = makeT();
    await seedNotification(t, { userId: USER });
    const otherUsers = await t.withIdentity({ subject: OTHER_USER, orgId: ORG }).query(api.notifications.listForMe, {});
    expect(otherUsers).toEqual([]);
  });

  test("unreadCountForMe excludes archived rows", async () => {
    const t = makeT();
    const row = await seedNotification(t);
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(1);
    await t.withIdentity(asUser).mutation(api.notificationsWrites.archiveNative, { id: row.id });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);
    expect(await t.withIdentity(asUser).query(api.notifications.listForMe, {})).toEqual([]);
  });

  test("anon / org-less callers get empty reads, never a thrown error", async () => {
    const t = makeT();
    expect(await t.query(api.notifications.listForMe, {})).toEqual([]);
    expect(await t.query(api.notifications.unreadCountForMe, {})).toBe(0);
    expect(await t.withIdentity({ subject: USER }).query(api.notifications.listForMe, {})).toEqual([]);
  });
});

describe("notifications writes (convex/notificationsWrites.ts)", () => {
  test("markReadNative is idempotent and the unread count matches the unread rows", async () => {
    const t = makeT();
    const row = await seedNotification(t);
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(1);
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markReadNative, { id: row.id });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);
    // Marking an already-read row again is a no-op, not an error.
    await t.withIdentity(asUser).mutation(api.notificationsWrites.markReadNative, { id: row.id });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);
  });

  test("markAllReadNative marks every unread row for the caller and reports the count; a second call is a no-op", async () => {
    const t = makeT();
    await seedNotification(t, { commentId: "c1" });
    await seedNotification(t, { commentId: "c2" });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(2);
    const res = await t.withIdentity(asUser).mutation(api.notificationsWrites.markAllReadNative, {});
    expect(res).toEqual({ marked: 2 });
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(0);
    expect(await t.withIdentity(asUser).mutation(api.notificationsWrites.markAllReadNative, {})).toEqual({ marked: 0 });
  });

  test("a caller cannot mark or archive another user's notification, even knowing its id", async () => {
    const t = makeT();
    const row = await seedNotification(t, { userId: USER });
    await expect(
      t.withIdentity({ subject: OTHER_USER, orgId: ORG }).mutation(api.notificationsWrites.markReadNative, { id: row.id }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: OTHER_USER, orgId: ORG }).mutation(api.notificationsWrites.archiveNative, { id: row.id }),
    ).rejects.toThrow();
    // Untouched — still unread and unarchived for the real owner.
    expect(await t.withIdentity(asUser).query(api.notifications.unreadCountForMe, {})).toBe(1);
  });

  test("a caller in the WRONG org cannot mark or archive a row that belongs to their other org", async () => {
    const t = makeT();
    const row = await seedNotification(t, { organizationId: ORG });
    await expect(
      t.withIdentity({ subject: USER, orgId: OTHER_ORG }).mutation(api.notificationsWrites.markReadNative, { id: row.id }),
    ).rejects.toThrow();
  });

  test("anon / org-less callers are rejected on every write", async () => {
    const t = makeT();
    await expect(t.mutation(api.notificationsWrites.markAllReadNative, {})).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: USER }).mutation(api.notificationsWrites.markAllReadNative, {}),
    ).rejects.toThrow();
  });
});
