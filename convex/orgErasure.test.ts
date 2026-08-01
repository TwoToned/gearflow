// @vitest-environment node
//
// convex/orgErasure.ts — the right-to-erasure hard-delete mutations (#1077,
// A7, M5). Covers each of the three table shapes (DIRECT/FILTER/PARENT_JOIN)
// plus storage blob deletion, and — the load-bearing property — that erasing
// one org never touches another org's rows.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SERVICE = { subject: "gearflow-service", svc: true };
const ORG = "org_1";
const ORG_2 = "org_2";

function makeT() {
  return convexTest(schema, modules);
}

describe("deleteTablePage — DIRECT table", () => {
  test("deletes only the target org's rows", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("locations", { id: "l1", organizationId: ORG, name: "Warehouse A" });
      await ctx.db.insert("locations", { id: "l2", organizationId: ORG_2, name: "Warehouse B" });
    });

    const res = await t.withIdentity(SERVICE).mutation(api.orgErasure.deleteTablePage, {
      table: "locations",
      orgId: ORG,
      numItems: 500,
    });
    expect(res).toEqual({ deleted: 1, isDone: true });

    const remaining = await t.run((ctx) => ctx.db.query("locations").collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].organizationId).toBe(ORG_2);
  });

  test("isDone is false when a full page is deleted (more may remain)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("locations", { id: `l${i}`, organizationId: ORG, name: `Loc ${i}` });
      }
    });
    const res = await t.withIdentity(SERVICE).mutation(api.orgErasure.deleteTablePage, {
      table: "locations",
      orgId: ORG,
      numItems: 2,
    });
    expect(res).toEqual({ deleted: 2, isDone: false });
  });
});

describe("deleteFilteredPage — FILTER table (storedFiles)", () => {
  test("deletes only the target org's rows", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("storedFiles", { storageId: "s1", organizationId: ORG });
      await ctx.db.insert("storedFiles", { storageId: "s2", organizationId: ORG_2 });
    });

    const res = await t.withIdentity(SERVICE).mutation(api.orgErasure.deleteFilteredPage, {
      table: "storedFiles",
      orgId: ORG,
      orgField: "organizationId",
      numItems: 500,
    });
    expect(res).toEqual({ deleted: 1, isDone: true });

    const remaining = await t.run((ctx) => ctx.db.query("storedFiles").collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].organizationId).toBe(ORG_2);
  });
});

describe("deleteChildRowsByParentIds — PARENT_JOIN table", () => {
  test("deletes children of the given parents only", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", {
        id: "so1", organizationId: ORG, supplierId: "sup1", orderNumber: "SO-1", type: "PURCHASE",
      });
      await ctx.db.insert("supplierOrders", {
        id: "so2", organizationId: ORG_2, supplierId: "sup2", orderNumber: "SO-2", type: "PURCHASE",
      });
      await ctx.db.insert("supplierOrderItems", { id: "soi1", orderId: "so1", description: "Item 1", modelId: "m1" });
      await ctx.db.insert("supplierOrderItems", { id: "soi2", orderId: "so2", description: "Item 2", modelId: "m2" });
    });

    const res = await t.withIdentity(SERVICE).mutation(api.orgErasure.deleteChildRowsByParentIds, {
      table: "supplierOrderItems",
      indexName: "by_orderId",
      parentField: "orderId",
      parentIds: ["so1"],
    });
    expect(res).toEqual({ deleted: 1 });

    const remaining = await t.run((ctx) => ctx.db.query("supplierOrderItems").collect());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].orderId).toBe("so2");
  });
});

describe("deleteStorageBlobs", () => {
  test("removes the underlying bytes and is idempotent on an already-gone id", async () => {
    const t = makeT();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["hello"])));

    const res = await t.withIdentity(SERVICE).mutation(api.orgErasure.deleteStorageBlobs, {
      storageIds: [storageId, "nonexistent-id"],
    });
    // Only the real id counts as deleted — the bogus one is silently skipped.
    expect(res.deleted).toBe(1);

    const url = await t.run((ctx) => ctx.storage.getUrl(storageId));
    expect(url).toBeNull();
  });
});

describe("rejects a non-service caller", () => {
  test("deleteTablePage", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.orgErasure.deleteTablePage, {
        table: "locations",
        orgId: ORG,
        numItems: 500,
      }),
    ).rejects.toThrow();
  });
});
