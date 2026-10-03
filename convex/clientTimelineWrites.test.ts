// @vitest-environment node
//
// convex/clientTimelineWrites.ts (#1245) — logging a call/email/note, and
// setting/completing a client's next step. Verifies: each logged action
// creates one activityEvents row stamped with clientId (the read model's
// index key); setNextStepNative creates a follow_up task AND its client
// link atomically; completeNextStepNative marks the task DONE and records
// the outcome against the LINKED client (not just any client).
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
const asUser = (orgId: string) => ({ subject: USER, orgId });
const actor = { userId: USER, userName: "Alice" };
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme" });
    await ctx.db.insert("clients", { id: "cOther", organizationId: OTHER_ORG, name: "Other Org Client" });
  });
}

async function eventsForClient(t: T, clientId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("activityEvents")
      .withIndex("by_orgId_clientId_createdAt", (q) => q.eq("orgId", ORG).eq("clientId", clientId))
      .collect(),
  );
}

describe("clientTimelineWrites — logging", () => {
  test("logCallNative stamps a call_logged activityEvents row with clientId", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.logCallNative, {
      orgId: ORG, clientId: "c1", note: "Called Sarah about the quote.", now: NOW, actor,
    });
    const rows = await eventsForClient(t, "c1");
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("call_logged");
    expect(rows[0].summary).toBe("Called Sarah about the quote.");
    expect(rows[0].entityType).toBe("client");
    expect(rows[0].entityId).toBe("c1");
  });

  test("logEmailNative and addNoteNative each stamp their own action", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.logEmailNative, {
      orgId: ORG, clientId: "c1", note: "Sent revised quote.", now: NOW, actor,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.addNoteNative, {
      orgId: ORG, clientId: "c1", note: "Prefers Friday calls.", now: NOW + 1, actor,
    });
    const rows = await eventsForClient(t, "c1");
    expect(rows.map((r) => r.action).sort()).toEqual(["email_logged", "note_added"]);
  });

  test("rejects an empty note", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.addNoteNative, {
        orgId: ORG, clientId: "c1", note: "   ", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });

  test("rejects logging against a client in another org", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.addNoteNative, {
        orgId: ORG, clientId: "cOther", note: "Cross-tenant probe", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });
});

describe("clientTimelineWrites.setNextStepNative", () => {
  test("creates a follow_up task AND its client link atomically", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.setNextStepNative, {
      orgId: ORG, clientId: "c1", title: "Call to confirm budget", dueDate: NOW + 3 * DAY, now: NOW, actor, auditId: "aud1",
    });

    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect(task?.kind).toBe("follow_up");
    expect(task?.status).toBe("TODO");
    expect(task?.dueDate).toBe(NOW + 3 * DAY);

    const link = await t.run((ctx) =>
      ctx.db
        .query("workItemLinks")
        .withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", ORG).eq("entityType", "client").eq("entityId", "c1"))
        .first(),
    );
    expect(link?.workItemId).toBe(id);

    const events = await eventsForClient(t, "c1");
    expect(events.map((e) => e.action)).toContain("next_step_set");
  });
});

describe("clientTimelineWrites.completeNextStepNative", () => {
  test("marks the task DONE and records the outcome against the linked client", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.setNextStepNative, {
      orgId: ORG, clientId: "c1", title: "Call to confirm budget", dueDate: NOW + DAY, now: NOW, actor, auditId: "aud1",
    });

    await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.completeNextStepNative, {
      orgId: ORG, workItemId: id, outcome: "Confirmed — proceeding to invoice.", now: NOW + DAY, actor,
    });

    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect(task?.status).toBe("DONE");
    expect(task?.completedAt).toBe(NOW + DAY);

    const events = await eventsForClient(t, "c1");
    const outcome = events.find((e) => e.action === "next_step_completed");
    expect(outcome?.summary).toBe("Confirmed — proceeding to invoice.");
  });

  test("rejects an empty outcome", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.setNextStepNative, {
      orgId: ORG, clientId: "c1", title: "Call to confirm budget", dueDate: NOW + DAY, now: NOW, actor, auditId: "aud1",
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.clientTimelineWrites.completeNextStepNative, {
        orgId: ORG, workItemId: id, outcome: "", now: NOW, actor,
      }),
    ).rejects.toThrow();
  });
});
