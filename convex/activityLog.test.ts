// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });

async function seedLog(
  t: ReturnType<typeof convexTest>,
  row: Partial<{ id: string; entityType: string; entityId: string; action: string; userId: string; projectId: string; summary: string; createdAt: number; organizationId: string }>,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("activityLogs", {
      id: row.id ?? "a1",
      organizationId: row.organizationId ?? ORG,
      action: row.action ?? "UPDATE",
      entityType: row.entityType ?? "asset",
      entityId: row.entityId ?? "e1",
      entityName: "Widget",
      userId: row.userId ?? USER,
      userName: "Alice",
      summary: row.summary ?? "did a thing",
      createdAt: row.createdAt ?? NOW,
      ...(row.projectId ? { projectId: row.projectId } : {}),
    });
  });
}

describe("activityLogWrites.record", () => {
  test("service inserts; duplicate id is idempotent", async () => {
    const t = convexTest(schema, modules);
    const entry = { id: "log1", organizationId: ORG, action: "CREATE", entityType: "asset", entityId: "e1", entityName: "W", userName: "Alice", summary: "s", createdAt: NOW };
    const first = await t.withIdentity(SERVICE).mutation(api.activityLogWrites.record, entry);
    const second = await t.withIdentity(SERVICE).mutation(api.activityLogWrites.record, entry);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const count = await t.run(async (ctx) => (await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).collect()).length);
    expect(count).toBe(1);
  });

  test("non-service (user) denied", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.activityLogWrites.record, { id: "log2", organizationId: ORG, action: "CREATE", entityType: "asset", entityId: "e1", entityName: "W", userName: "A", summary: "s", createdAt: NOW }),
    ).rejects.toThrow(/requires the GearFlow server/i);
  });
});

describe("activityLog.list", () => {
  test("org member reads own org; cross-org denied", async () => {
    const t = convexTest(schema, modules);
    await seedLog(t, { id: "a1" });
    const res = await t.withIdentity(asUser(ORG)).query(api.activityLog.list, { orgId: ORG });
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe("a1");
    await expect(t.withIdentity(asUser("org_other")).query(api.activityLog.list, { orgId: ORG })).rejects.toThrow(/organization mismatch/i);
  });

  test("filters (entityType, projectId, search, date) + pagination + newest-first", async () => {
    const t = convexTest(schema, modules);
    await seedLog(t, { id: "a1", entityType: "asset", createdAt: NOW });
    await seedLog(t, { id: "a2", entityType: "kit", projectId: "p9", summary: "kitchen prep", createdAt: NOW + 1000 });
    await seedLog(t, { id: "a3", entityType: "asset", createdAt: NOW + 2000 });

    // newest-first by default
    const all = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG });
    expect(all.items.map((i) => i.id)).toEqual(["a3", "a2", "a1"]);

    // entityType filter
    const assets = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, entityType: "asset" });
    expect(assets.total).toBe(2);
    expect(assets.items.every((i) => i.entityType === "asset")).toBe(true);

    // projectId filter
    const proj = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, projectId: "p9" });
    expect(proj.total).toBe(1);
    expect(proj.items[0].id).toBe("a2");

    // case-insensitive summary search
    const search = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, search: "KITCHEN" });
    expect(search.total).toBe(1);

    // date range (exclude a1 at NOW)
    const dated = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, startDateMs: NOW + 500 });
    expect(dated.total).toBe(2);

    // pagination
    const p1 = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, page: 1, pageSize: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(["a3", "a2"]);
    expect(p1.totalPages).toBe(2);
    const p2 = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG, page: 2, pageSize: 2 });
    expect(p2.items.map((i) => i.id)).toEqual(["a1"]);
  });

  test("joins the users mirror for {id,name,image}; createdAt is an ISO string", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { id: USER, name: "Alice A", email: "a@x.com", image: "http://img/a.png" });
    });
    await seedLog(t, { id: "a1", userId: USER });
    const res = await t.withIdentity(SERVICE).query(api.activityLog.list, { orgId: ORG });
    expect(res.items[0].user).toEqual({ id: USER, name: "Alice A", image: "http://img/a.png" });
    expect(res.items[0].createdAt).toBe(new Date(NOW).toISOString());
  });
});

describe("activityLog.listByEntity", () => {
  test("newest-first, limited, org-scoped", async () => {
    const t = convexTest(schema, modules);
    await seedLog(t, { id: "a1", entityType: "asset", entityId: "e1", createdAt: NOW });
    await seedLog(t, { id: "a2", entityType: "asset", entityId: "e1", createdAt: NOW + 1000 });
    await seedLog(t, { id: "a3", entityType: "asset", entityId: "OTHER", createdAt: NOW + 2000 });
    const res = await t.withIdentity(asUser(ORG)).query(api.activityLog.listByEntity, { orgId: ORG, entityType: "asset", entityId: "e1", limit: 5 });
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.id)).toEqual(["a2", "a1"]);
  });
});

describe("activityLog.exportRows", () => {
  test("returns filtered rows newest-first with ISO createdAt", async () => {
    const t = convexTest(schema, modules);
    await seedLog(t, { id: "a1", action: "CREATE", createdAt: NOW });
    await seedLog(t, { id: "a2", action: "DELETE", createdAt: NOW + 1000 });
    const rows = await t.withIdentity(SERVICE).query(api.activityLog.exportRows, { orgId: ORG, action: "DELETE" });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("a2");
    expect(rows[0].createdAt).toBe(new Date(NOW + 1000).toISOString());
  });
});
