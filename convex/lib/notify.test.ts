// @vitest-environment node
//
// convex/lib/notify.ts — the mentions-inbox write (work-layer phase 0, #1241).
// Verifies: one row per mentioned user, the actor is never notified of their own
// mention, and the (organizationId, dedupeKey) pair is dedupe-safe against a
// repeated call (a mutation retry, or the same user mentioned twice in one body).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { notifyMentions } from "./notify";

const modules = import.meta.glob("../**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";

function makeT() {
  return convexTest(schema, modules);
}

describe("notifyMentions", () => {
  test("writes one row per mentioned user, deduping the input and excluding the actor", async () => {
    const t = makeT();
    await t.run((ctx) =>
      notifyMentions(ctx, {
        organizationId: ORG,
        mentionedUserIds: ["user_bob", "user_bob", "user_carol", "user_alice"],
        actorUserId: "user_alice",
        actorName: "Alice",
        entityType: "project",
        entityId: "proj_1",
        commentId: "comment_1",
        commentBody: "hey @bob @carol check this out",
      }),
    );
    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.map((r) => r.userId).sort()).toEqual(["user_bob", "user_carol"]);
    expect(rows.every((r) => r.type === "mentioned" && r.organizationId === ORG)).toBe(true);
    expect(rows.every((r) => r.dedupeKey === `mention:comment_1:${r.userId}`)).toBe(true);
    expect(rows.every((r) => r.href === "/projects/proj_1")).toBe(true);
  });

  test("is dedupe-safe: the same (org, commentId, user) pair never creates a second row", async () => {
    const t = makeT();
    const args = {
      organizationId: ORG,
      mentionedUserIds: ["user_bob"],
      actorUserId: "user_alice",
      actorName: "Alice",
      entityType: "project",
      entityId: "proj_1",
      commentId: "comment_1",
      commentBody: "hey @bob",
    };
    await t.run((ctx) => notifyMentions(ctx, args));
    await t.run((ctx) => notifyMentions(ctx, args)); // simulated retry / duplicate call
    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.length).toBe(1);
  });

  test("the same dedupe key in a DIFFERENT org is not deduped against it", async () => {
    const t = makeT();
    const base = {
      mentionedUserIds: ["user_bob"],
      actorUserId: "user_alice",
      actorName: "Alice",
      entityType: "project",
      entityId: "proj_1",
      commentId: "comment_1",
      commentBody: "hey @bob",
    };
    await t.run((ctx) => notifyMentions(ctx, { ...base, organizationId: ORG }));
    await t.run((ctx) => notifyMentions(ctx, { ...base, organizationId: OTHER_ORG }));
    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.organizationId).sort()).toEqual([ORG, OTHER_ORG]);
  });

  test("a mention that only names the author (no other recipient) writes nothing", async () => {
    const t = makeT();
    await t.run((ctx) =>
      notifyMentions(ctx, {
        organizationId: ORG,
        mentionedUserIds: ["user_alice"],
        actorUserId: "user_alice",
        actorName: "Alice",
        entityType: "project",
        entityId: "proj_1",
        commentId: "comment_1",
        commentBody: "note to self",
      }),
    );
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([]);
  });

  test("an unrecognised entityType falls back to a safe href rather than guessing a route", async () => {
    const t = makeT();
    await t.run((ctx) =>
      notifyMentions(ctx, {
        organizationId: ORG,
        mentionedUserIds: ["user_bob"],
        actorUserId: "user_alice",
        actorName: "Alice",
        entityType: "somethingNew",
        entityId: "x1",
        commentId: "comment_1",
        commentBody: "hi",
      }),
    );
    const [row] = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(row.href).toBe("/");
  });
});
