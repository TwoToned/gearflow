// @vitest-environment node
//
// convex/workItemLinksWrites.ts (#1245) — link/unlink a work item to another
// entity. Verifies: linkNative is idempotent (re-linking the same triple
// returns the existing row, never a duplicate), org isolation on both the
// work item and the link itself, and unlinkNative's org-checked delete.
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
    await ctx.db.insert("projectTasks", { id: "t1", organizationId: ORG, title: "Follow up", kind: "follow_up", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectTasks", { id: "tOther", organizationId: OTHER_ORG, title: "Other org task", createdAt: NOW, updatedAt: NOW });
  });
}

describe("workItemLinksWrites.linkNative", () => {
  test("links a work item to a client", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
      orgId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", now: NOW,
    });
    const row = await t.run((ctx) => ctx.db.query("workItemLinks").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect(row?.workItemId).toBe("t1");
    expect(row?.entityType).toBe("client");
    expect(row?.entityId).toBe("c1");
    expect(row?.organizationId).toBe(ORG);
  });

  test("re-linking the same triple is idempotent (returns the same id, no duplicate)", async () => {
    const t = makeT();
    await seed(t);
    const first = await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
      orgId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", now: NOW,
    });
    const second = await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
      orgId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", now: NOW + 1,
    });
    expect(second.id).toBe(first.id);
    const all = await t.run((ctx) => ctx.db.query("workItemLinks").withIndex("by_workItemId", (q) => q.eq("workItemId", "t1")).collect());
    expect(all).toHaveLength(1);
  });

  test("rejects linking a work item that belongs to another org", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
        orgId: ORG, workItemId: "tOther", entityType: "client", entityId: "c1", now: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("workItemLinksWrites.unlinkNative", () => {
  test("removes a link without touching the work item", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
      orgId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.unlinkNative, { orgId: ORG, id });
    const row = await t.run((ctx) => ctx.db.query("workItemLinks").withIndex("by_cuid", (q) => q.eq("id", id)).first());
    expect(row).toBeNull();
    const task = await t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", "t1")).first());
    expect(task).not.toBeNull();
  });

  test("rejects unlinking a row from another org", async () => {
    const t = makeT();
    await seed(t);
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.workItemLinksWrites.linkNative, {
      orgId: ORG, workItemId: "t1", entityType: "client", entityId: "c1", now: NOW,
    });
    await expect(
      t.withIdentity(asUser(OTHER_ORG)).mutation(api.workItemLinksWrites.unlinkNative, { orgId: OTHER_ORG, id }),
    ).rejects.toThrow();
  });
});
