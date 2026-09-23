// @vitest-environment node
//
// Follow-up automation — the reconciler against a real seeded DB
// (docs/designs/follow-up-automation.md §8.2): creates exactly one row per
// quote loop, links it to the client + quote, assigns the sender, closes it on
// accept/decline/cancel, never duplicates on re-run, respects human edits
// (lockedFields), soft-deletes, advances on "no reply", parks, adopts a
// promoted signal, and the tick's per-org reconcile.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { reconcileFollowUps } from "./lib/followUpReconcile";
import { addBusinessDaysInTimezone } from "./lib/quoteDates";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const USER = "user_1";
const DAY = 86_400_000;
const TZ = "Australia/Sydney";
// Tue 2026-10-06 09:00 AEDT — after the default cut-over
const SENT = Date.UTC(2026, 9, 5, 22, 0, 0);
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG, role: "owner" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seed(t: T, opts: { projectStatus?: string; quoteStatus?: string; sentAt?: number; eventStart?: number; followUps?: object } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", { id: ORG, name: "Org", slug: "org" });
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner", createdAt: 1 });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("orgSettings", {
      organizationId: ORG,
      settings: JSON.stringify({ timezone: TZ, ...(opts.followUps ? { followUps: opts.followUps } : {}) }),
    });
    await ctx.db.insert("clients", { id: "C1", organizationId: ORG, name: "Client" } as never);
    await ctx.db.insert("projects", {
      id: "P1", organizationId: ORG, projectNumber: "260901", name: "Gig", clientId: "C1",
      status: (opts.projectStatus ?? "QUOTED") as never, isTemplate: false, total: 0,
      rentalStartDate: opts.eventStart ?? SENT + 60 * DAY, liveVersionId: "v1", createdAt: SENT, updatedAt: SENT,
    } as never);
    await ctx.db.insert("quotes", {
      id: "Q1", organizationId: ORG, projectId: "P1", version: 1, versionId: "v1", snapshot: null,
      status: (opts.quoteStatus ?? "SENT") as never, sentAt: opts.sentAt ?? SENT, sentById: USER,
      validUntil: (opts.sentAt ?? SENT) + 30 * DAY, createdAt: SENT, updatedAt: SENT,
    } as never);
  });
}

const followUps = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("projectTasks").withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", ORG).eq("projectId", "P1")).collect())
      .filter((r) => r.automation)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
  );
const reconcile = (t: T, now: number) => t.run((ctx) => reconcileFollowUps(ctx, { orgId: ORG, projectId: "P1", now }));
const setQuote = (t: T, patch: Record<string, unknown>) =>
  t.run(async (ctx) => {
    const q = await ctx.db.query("quotes").withIndex("by_cuid", (x) => x.eq("id", "Q1")).first();
    await ctx.db.patch(q!._id, patch as never);
  });

describe("reconcileFollowUps", () => {
  test("opens one follow-up for a sent quote: due send + 2 bd, owned by the sender, linked", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    await reconcile(t, SENT + 2000); // idempotent
    const rows = await followUps(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Follow up on quote 260901 v1", status: "TODO", kind: "follow_up", stage: "quote",
      assigneeUserId: USER, sourceKey: "quote:nonext:Q1", dueDate: addBusinessDaysInTimezone(SENT, 2, TZ),
    });
    const links = await t.run(async (ctx) => ctx.db.query("workItemLinks").withIndex("by_workItemId", (q) => q.eq("workItemId", rows[0].id)).collect());
    expect(links.map((l) => `${l.entityType}:${l.entityId}`).sort()).toEqual(["client:C1", "quote:Q1"]);
  });

  test("never touches a quote sent before the cut-over", async () => {
    const t = makeT(); await seed(t, { followUps: { cutoverAt: SENT + DAY } });
    await reconcile(t, SENT + 1000);
    expect(await followUps(t)).toHaveLength(0);
  });

  test("an org opt-out creates nothing", async () => {
    const t = makeT(); await seed(t, { followUps: { quotesEnabled: false } });
    await reconcile(t, SENT + 1000);
    expect(await followUps(t)).toHaveLength(0);
  });

  test.each([
    ["ACCEPTED", "DONE", "accepted"],
    ["DECLINED", "DONE", "declined"],
  ])("closes itself when the quote is %s", async (quoteStatus, status, resolution) => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    await setQuote(t, { status: quoteStatus });
    await reconcile(t, SENT + 2000);
    const [row] = await followUps(t);
    expect(row.status).toBe(status);
    expect(row.automation).toMatchObject({ resolution, resolvedBy: "system" });
  });

  test("closes when the project is cancelled", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "P1")).first();
      await ctx.db.patch(p!._id, { status: "CANCELLED" as never });
    });
    await reconcile(t, SENT + 2000);
    const [row] = await followUps(t);
    expect(row).toMatchObject({ status: "CANCELLED", automation: expect.objectContaining({ resolution: "cancelled" }) });
  });
});

describe("human edits go back through the engine", () => {
  test("ticking done means 'no reply': the next rung opens, 5 bd later", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    const [first] = await followUps(t);
    const doneAt = SENT + 2 * DAY;
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: first.id, orgId: ORG, status: "DONE", now: doneAt, actor, auditId: "a1",
    });
    const rows = await followUps(t);
    expect(rows).toHaveLength(2);
    expect(rows[0].automation).toMatchObject({ resolution: "no_reply", resolvedBy: USER });
    expect(rows[1]).toMatchObject({ status: "TODO", title: "Second follow-up on quote 260901 v1" });
    expect(rows[1].dueDate).toBe(addBusinessDaysInTimezone(doneAt, 5, TZ));
  });

  test("an edited due date is locked and never overwritten", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    const [row] = await followUps(t);
    const mine = SENT + 9 * DAY;
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.updateNative, {
      id: row.id, orgId: ORG, dueDate: mine, now: SENT + 2000, actor, auditId: "a1",
    });
    await reconcile(t, SENT + 3000);
    const [after] = await followUps(t);
    expect(after.dueDate).toBe(mine);
    expect(after.automation?.lockedFields).toContain("dueDate");
  });

  test("delete is a soft close that consumes the rung — it doesn't come back", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    const [row] = await followUps(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.deleteNative, { id: row.id, orgId: ORG, now: SENT + 2000, actor, auditId: "a1" });
    await reconcile(t, SENT + 3000);
    const rows = await followUps(t);
    expect(rows[0]).toMatchObject({ status: "CANCELLED", automation: expect.objectContaining({ resolution: "deleted" }) });
    expect(rows).toHaveLength(2);
    expect(rows[1].automation?.rung).toBe(2);
  });

  test("recordFollowUpOutcomeNative: parked moves and locks the due date", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    const [row] = await followUps(t);
    const until = SENT + 20 * DAY;
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.recordFollowUpOutcomeNative, {
      id: row.id, orgId: ORG, outcome: "parked", nextDate: until, now: SENT + 2000, actor, auditId: "a1",
    });
    await reconcile(t, SENT + 3000);
    const rows = await followUps(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("TODO");
    expect(rows[0].automation?.lockedFields).toContain("dueDate");
    expect(rows[0].snoozedUntil).toBe(until);
  });

  test("recordFollowUpOutcomeNative: no_reply with a chosen date sets the next rung's due", async () => {
    const t = makeT(); await seed(t);
    await reconcile(t, SENT + 1000);
    const [row] = await followUps(t);
    const next = SENT + 12 * DAY;
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.recordFollowUpOutcomeNative, {
      id: row.id, orgId: ORG, outcome: "no_reply", nextDate: next, note: "Left a voicemail", now: SENT + 2 * DAY, actor, auditId: "a1",
    });
    const rows = await followUps(t);
    expect(rows).toHaveLength(2);
    expect(rows[1].automation?.rung).toBe(2);
    const timeline = await t.run(async (ctx) => ctx.db.query("activityEvents").collect());
    expect(timeline.some((e) => e.action === "next_step_completed" && e.summary.includes("voicemail"))).toBe(true);
  });

  test("recordFollowUpOutcomeNative refuses a row the engine doesn't own", async () => {
    const t = makeT(); await seed(t);
    await t.withIdentity(asUser).mutation(api.projectTasksWrites.createNative, {
      id: "manual", projectId: "P1", orgId: ORG, title: "Manual", now: SENT, actor, auditId: "a0",
    });
    await expect(
      t.withIdentity(asUser).mutation(api.projectTasksWrites.recordFollowUpOutcomeNative, {
        id: "manual", orgId: ORG, outcome: "no_reply", now: SENT, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/automated/i);
  });
});

describe("adoption and the tick", () => {
  test("a hand-promoted quote:nonext signal is adopted, not duplicated", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectTasks", {
        id: "promoted", organizationId: ORG, title: "Chase it", status: "TODO", priority: "NORMAL",
        sourceKey: "quote:nonext:Q1", assigneeUserId: USER, sortOrder: 0, createdAt: SENT, updatedAt: SENT,
      });
      await ctx.db.insert("workSignalStates", {
        id: "s1", organizationId: ORG, userId: USER, sourceKey: "quote:nonext:Q1", state: "promoted",
        promotedWorkItemId: "promoted", createdAt: SENT, updatedAt: SENT,
      });
    });
    await reconcile(t, SENT + 1000);
    const rows = await followUps(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "promoted", projectId: "P1", kind: "follow_up" });
  });

  test("the tick is inert without its flag; reconcileOrg picks up sent quotes", async () => {
    const t = makeT(); await seed(t);
    const res = await t.mutation(internal.followUpTick.tick, {});
    expect(res).toEqual({ skipped: true, scheduled: 0 });
    const r = await t.mutation(internal.followUpTick.reconcileOrg, { orgId: ORG });
    expect(r.projects).toBe(1);
    expect(await followUps(t)).toHaveLength(1);
  });
});
