// @vitest-environment node
//
// convex/savedTableViewsWrites.ts — browser-direct saved-table-view writes. Verifies:
// userId + orgId derived from the VERIFIED token (personal ownership), single-default
// invariant on create/setDefault, cross-user + cross-org ownership re-check (a member
// can't touch another user's/org's view), name validation, and atomic audit.
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
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const getView = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const create = (t: ReturnType<typeof makeT>, over: Record<string, unknown> = {}) =>
  t.withIdentity(asUser).mutation(api.savedTableViewsWrites.createNative, {
    id: "v1", tableId: "assets", name: "Overdue", config: { filters: {} },
    isDefault: false, now: NOW, actor, auditId: "a1", ...over,
  });

describe("savedTableViewsWrites", () => {
  test("create → update → delete, with audit + returns", async () => {
    const t = makeT();
    const res = await create(t);
    expect(res).toEqual({ id: "v1", name: "Overdue" });
    const created = await getView(t, "v1");
    expect(created?.userId).toBe(USER);
    expect(created?.organizationId).toBe(ORG);

    await t.withIdentity(asUser).mutation(api.savedTableViewsWrites.updateNative, {
      id: "v1", name: "Renamed", config: { pageSize: 50 }, now: NOW + 1, actor, auditId: "a2",
    });
    const updated = await getView(t, "v1");
    expect(updated?.name).toBe("Renamed");
    expect(updated?.config).toEqual({ pageSize: 50 });

    await t.withIdentity(asUser).mutation(api.savedTableViewsWrites.removeNative, {
      id: "v1", now: NOW + 2, actor, auditId: "a3",
    });
    expect(await getView(t, "v1")).toBeNull();

    const logs = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    expect(logs.map((l) => l.action).sort()).toEqual(["CREATE", "DELETE", "UPDATE"]);
  });

  test("creating a second default clears the first (single-default invariant)", async () => {
    const t = makeT();
    await create(t, { id: "a", name: "A", isDefault: true });
    await create(t, { id: "b", name: "B", isDefault: true });
    expect((await getView(t, "a"))?.isDefault).toBe(false);
    expect((await getView(t, "b"))?.isDefault).toBe(true);
  });

  test("setDefault sets one and clears with null", async () => {
    const t = makeT();
    await create(t, { id: "a", name: "A" });
    await t.withIdentity(asUser).mutation(api.savedTableViewsWrites.setDefaultNative, {
      tableId: "assets", targetId: "a", now: NOW, actor, auditId: "s1",
    });
    expect((await getView(t, "a"))?.isDefault).toBe(true);
    await t.withIdentity(asUser).mutation(api.savedTableViewsWrites.setDefaultNative, {
      tableId: "assets", targetId: null, now: NOW + 1, actor, auditId: "s2",
    });
    expect((await getView(t, "a"))?.isDefault).toBe(false);
  });

  test("a member cannot update/delete/set-default another user's view", async () => {
    const t = makeT();
    // A view owned by OTHER_USER in the same org.
    await t.run(async (ctx) => {
      await ctx.db.insert("savedTableViews", {
        id: "vX", organizationId: ORG, userId: OTHER_USER, tableId: "assets", name: "Theirs",
        config: {}, isDefault: false, createdAt: NOW, updatedAt: NOW,
      });
    });
    const otherActor = { userId: OTHER_USER, userName: "Bob" };
    await expect(
      t.withIdentity(asUser).mutation(api.savedTableViewsWrites.updateNative, {
        id: "vX", name: "hijack", now: NOW, actor: otherActor, auditId: "a9",
      }),
    ).rejects.toThrow(/not found/i);
    await expect(
      t.withIdentity(asUser).mutation(api.savedTableViewsWrites.removeNative, {
        id: "vX", now: NOW, actor: otherActor, auditId: "a9",
      }),
    ).rejects.toThrow(/not found/i);
    await expect(
      t.withIdentity(asUser).mutation(api.savedTableViewsWrites.setDefaultNative, {
        tableId: "assets", targetId: "vX", now: NOW, actor: otherActor, auditId: "a9",
      }),
    ).rejects.toThrow(/not found/i);
    expect((await getView(t, "vX"))?.name).toBe("Theirs");
  });

  test("a member cannot touch a view in another org", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("savedTableViews", {
        id: "vO", organizationId: OTHER_ORG, userId: USER, tableId: "assets", name: "Elsewhere",
        config: {}, isDefault: false, createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.savedTableViewsWrites.removeNative, {
        id: "vO", now: NOW, actor, auditId: "a9",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("create + update reject a blank or over-long name", async () => {
    const t = makeT();
    await expect(create(t, { name: "   " })).rejects.toThrow(/required/i);
    await expect(create(t, { name: "x".repeat(61) })).rejects.toThrow(/60 characters/i);
    await create(t, { id: "v1", name: "OK" });
    await expect(
      t.withIdentity(asUser).mutation(api.savedTableViewsWrites.updateNative, {
        id: "v1", name: "   ", now: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/required/i);
  });

  test("rejects an anonymous caller", async () => {
    const t = makeT();
    await expect(
      t.mutation(api.savedTableViewsWrites.createNative, {
        id: "v1", tableId: "assets", name: "X", config: {}, isDefault: false, now: NOW, actor, auditId: "a1",
      }),
    ).rejects.toThrow(/Unauthorized/i);
  });
});
