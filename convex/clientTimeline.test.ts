// @vitest-environment node
//
// convex/clientTimeline.ts (#1245) — the unified client timeline read model.
// Verifies: quote sent/accepted/expired rows are derived off the `quotes`
// table (via effectiveQuoteStatus, never the raw status column); invoices
// read via the direct `by_clientId` index; comments/logged touches read via
// activityEvents' clientId index; cross-tenant isolation on every source;
// and `nextStep`'s "soonest open follow_up" + "requiresNextStep" rule.
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
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedBase(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager" });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.com" });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme" });
    await ctx.db.insert("clients", { id: "cOther", organizationId: OTHER_ORG, name: "Other Org Client" });
  });
}

describe("clientTimeline.forClient", () => {
  test("unions quote sent/accepted, invoice issued, and a cross-tenant client is rejected", async () => {
    const t = makeT();
    await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gala", clientId: "c1", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "ACCEPTED", snapshot: null,
        sentAt: NOW - 2 * DAY, acceptedAt: NOW - DAY,
      });
      await ctx.db.insert("invoices", {
        id: "inv1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED",
        invoiceNumber: "INV-0001", issuedAt: NOW, subtotal: 100, taxAmount: 10, total: 110,
      });
    });

    const res = await t.withIdentity(asUser(ORG)).query(api.clientTimeline.forClient, { orgId: ORG, clientId: "c1", now: NOW });
    const actions = res.rows.map((r) => r.action).sort();
    expect(actions).toEqual(["invoice_issued", "quote_accepted", "quote_sent"]);
    // Newest first.
    expect(res.rows[0].action).toBe("invoice_issued");

    await expect(
      t.withIdentity(asUser(ORG)).query(api.clientTimeline.forClient, { orgId: ORG, clientId: "cOther", now: NOW }),
    ).rejects.toThrow();
  });

  test("a SENT quote past validUntil reads as quote_expired, not quote_sent-only", async () => {
    const t = makeT();
    await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gala", clientId: "c1", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "SENT", snapshot: null,
        sentAt: NOW - 40 * DAY, validUntil: NOW - 10 * DAY,
      });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.clientTimeline.forClient, { orgId: ORG, clientId: "c1", now: NOW });
    expect(res.rows.map((r) => r.action).sort()).toEqual(["quote_expired", "quote_sent"]);
  });

  test("comments/mentions and human-logged touches read via the activityEvents clientId index", async () => {
    const t = makeT();
    await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("activityEvents", {
        orgId: ORG, actorUserId: USER, actorName: "Alice", actorColor: "#000", entityType: "client", entityId: "c1",
        action: "comment_created", summary: "started a discussion", clientId: "c1", createdAt: NOW,
      });
      // An event on a DIFFERENT client must not leak in.
      await ctx.db.insert("activityEvents", {
        orgId: ORG, actorUserId: USER, actorName: "Alice", actorColor: "#000", entityType: "client", entityId: "c2",
        action: "comment_created", summary: "unrelated", clientId: "c2", createdAt: NOW,
      });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.clientTimeline.forClient, { orgId: ORG, clientId: "c1", now: NOW });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].category).toBe("comment");
  });
});

describe("clientTimeline.nextStep", () => {
  test("returns the soonest OPEN follow_up, and requiresNextStep tracks a SENT quote", async () => {
    const t = makeT();
    await seedBase(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gala", clientId: "c1", isTemplate: false, createdAt: NOW });
      await ctx.db.insert("quotes", { id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "SENT", snapshot: null, sentAt: NOW - DAY, validUntil: NOW + 10 * DAY });
      await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, title: "Later step", kind: "follow_up", status: "TODO", dueDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "t2", organizationId: ORG, title: "Sooner step", kind: "follow_up", status: "TODO", dueDate: NOW + DAY, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "tDone", organizationId: ORG, title: "Done step", kind: "follow_up", status: "DONE", dueDate: NOW - DAY, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("workItemLinks", { id: "l1", organizationId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", createdAt: NOW });
      await ctx.db.insert("workItemLinks", { id: "l2", organizationId: ORG, workItemId: "t2", entityType: "client", entityId: "c1", createdAt: NOW });
      await ctx.db.insert("workItemLinks", { id: "l3", organizationId: ORG, workItemId: "tDone", entityType: "client", entityId: "c1", createdAt: NOW });
    });

    const res = await t.withIdentity(asUser(ORG)).query(api.clientTimeline.nextStep, { orgId: ORG, clientId: "c1", now: NOW });
    expect(res.nextStep?.id).toBe("t2");
    expect(res.requiresNextStep).toBe(true);
  });

  test("requiresNextStep is false with no SENT quote, and nextStep is null with no open follow_up", async () => {
    const t = makeT();
    await seedBase(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.clientTimeline.nextStep, { orgId: ORG, clientId: "c1", now: NOW });
    expect(res.nextStep).toBeNull();
    expect(res.requiresNextStep).toBe(false);
  });
});
