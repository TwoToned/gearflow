// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");
function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

const ORG = "org_1";
const OTHER = "org_other";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: T, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

async function seedProject(t: T, id = "p1", orgId = ORG, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED",
      defaultRentalPeriod: "DAILY", defaultRentalQuantity: 1, total: 0, ...extra,
    });
  });
}

async function seedSupplier(t: T, id = "sup1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("suppliers", { id, organizationId: orgId, name: "Acme Hire", isActive: true });
  });
}

async function seedModel(t: T, id = "mdl1", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("models", { id, organizationId: orgId, name: "SL2 Fixture" });
  });
}

async function seedSubHire(t: T, id = "sh1", orgId = ORG, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("subHires", {
      id, organizationId: orgId, supplierId: "sup1", createdById: USER, orderNumber: "SH-9999",
      status: "DRAFT", projectId: "p1", showOnDocs: false, createdAt: NOW, updatedAt: NOW, ...extra,
    });
  });
}

const shById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const itemById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const logById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const linesForSubHire = (t: T, subHireId: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect());

const itemInput = {
  description: "Rigging", quantity: 1, unitCost: 40, unitCharge: 100,
  pricingType: "FLAT" as const, duration: 1, discount: 0,
};

// ─── createSubHireNative ──────────────────────────────────────────────────────
describe("createSubHireNative", () => {
  test("reserves order number (SH-0001), stamps createdById=actor + status DRAFT + audit; NO recalc", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedSupplier(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
      id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.orderNumber).toBe("SH-0001");
    const sh = await shById(t, "sh1");
    expect(sh?.status).toBe("DRAFT");
    expect(sh?.createdById).toBe(USER);
    expect(sh?.orderNumber).toBe("SH-0001");
    const log = await logById(t, "log1");
    expect(log?.action).toBe("CREATE");
    expect(log?.summary).toBe("Created sub-hire SH-0001");
    expect(log?.entityName).toBe("SH-0001 (Acme Hire)");
    // Fresh DRAFT books nothing → project total untouched.
    expect((await projById(t, "p1"))?.total).toBe(0);
  });

  test("createdById is the VERIFIED token, not a spoofed actor.userId", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedSupplier(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
      id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW,
      actor: { userId: "SPOOFED", userName: "Mallory" }, auditId: "log1",
    });
    expect((await shById(t, "sh1"))?.createdById).toBe(USER);
    expect((await logById(t, "log1"))?.userId).toBe(USER);
  });

  test("dup-guard: retried create (same cuid, same org) is idempotent — no second audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedSupplier(t);
    const args = { id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "log1" };
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, args);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, { ...args, auditId: "log2" });
    const rows = await t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).collect());
    expect(rows).toHaveLength(1);
    expect(await logById(t, "log2")).toBeNull();
  });

  test("cross-org supplier rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedSupplier(t, "sup1", OTHER);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Supplier not found/i);
  });

  test("cross-org project rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", OTHER);
    await seedSupplier(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Project not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await seedSupplier(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateSubHireNative ──────────────────────────────────────────────────────
describe("updateSubHireNative", () => {
  test("patches supplierReference + audit; PRESERVES absent projectId (safe partial-merge)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    // Attach a project so we can prove the metadata edit does NOT clobber it.
    await t.run(async (ctx) => {
      const sh = await ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first();
      if (sh) await ctx.db.patch(sh._id, { projectId: "p1", notes: "keep me" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
      id: "sh1", orgId: ORG, supplierId: "sup1", supplierReference: "PO-42", showOnDocs: true, now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    const sh = await shById(t, "sh1");
    expect(sh?.supplierReference).toBe("PO-42");
    expect(sh?.showOnDocs).toBe(true);
    // projectId + notes absent from the payload → PRESERVED (not clobbered by the metadata edit).
    expect(sh?.projectId).toBe("p1");
    expect(sh?.notes).toBe("keep me");
    expect((await logById(t, "logu"))?.summary).toBe("Updated sub-hire SH-9999");
  });

  test("cross-org sub-hire rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", OTHER, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/Sub-hire not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── deleteSubHireNative ──────────────────────────────────────────────────────
describe("deleteSubHireNative", () => {
  test("cascade-deletes head + items + groups + linked project lines; recalc; audit", async () => {
    const t = makeT();
    await member(t, "admin");
    await seedProject(t, "p1", ORG, { total: 555 });
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { status: "CONFIRMED" });
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "X", quantity: 1, sortOrder: 0 });
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Grp", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li_parent", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "Grp", quantity: 1, lineTotal: 0, isKitChild: false, subHireId: "sh1", status: "QUOTED" });
      await ctx.db.insert("projectLineItems", { id: "li_child", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "X", quantity: 1, lineTotal: 100, isKitChild: true, parentLineItemId: "li_parent", subHireId: "sh1", status: "QUOTED" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.deleteSubHireNative, {
      id: "sh1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logd",
    });
    expect(await shById(t, "sh1")).toBeNull();
    expect(await itemById(t, "it1")).toBeNull();
    expect(await linesForSubHire(t, "sh1")).toHaveLength(0);
    expect((await projById(t, "p1"))?.total).toBe(0); // lines gone → 0 billable
    expect((await logById(t, "logd"))?.summary).toBe("Deleted sub-hire SH-9999");
  });

  test("rejects when a linked project line is CHECKED_OUT", async () => {
    const t = makeT();
    await member(t, "admin");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { status: "CONFIRMED" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "X", quantity: 1, lineTotal: 100, isKitChild: false, subHireId: "sh1", status: "CHECKED_OUT" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.deleteSubHireNative, { id: "sh1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logd" }),
    ).rejects.toThrow(/checked-out/i);
    expect(await shById(t, "sh1")).not.toBeNull(); // untouched
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.deleteSubHireNative, { id: "sh1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logd" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateSubHireStatusNative ────────────────────────────────────────────────
describe("updateSubHireStatusNative", () => {
  test("DRAFT→CONFIRMED regenerates project lines + recalc + audit (previous/new details)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t); // DRAFT + projectId p1
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 0, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireStatusNative, {
      id: "sh1", orgId: ORG, status: "CONFIRMED", now: NOW + 1, actor: ACTOR, auditId: "logs",
    });
    expect((await shById(t, "sh1"))?.status).toBe("CONFIRMED");
    // A standalone project line was generated for the item.
    const lines = await linesForSubHire(t, "sh1");
    expect(lines.some((l) => l.subHireItemId === "it1" && l.lineTotal === 100)).toBe(true);
    // Equipment revenue 100 → subtotal 100 + 10% tax = 110.
    expect((await projById(t, "p1"))?.total).toBe(110);
    const log = await logById(t, "logs");
    expect(log?.summary).toBe("Changed sub-hire SH-9999 status to CONFIRMED");
    expect(log?.details).toEqual({ previousStatus: "DRAFT", newStatus: "CONFIRMED" });
  });

  test("invalid transition (DRAFT→ON_HIRE) rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireStatusNative, { id: "sh1", orgId: ORG, status: "ON_HIRE", now: NOW, actor: ACTOR, auditId: "logs" }),
    ).rejects.toThrow(/Cannot transition from DRAFT to ON_HIRE/i);
  });

  test("confirm without a project rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireStatusNative, { id: "sh1", orgId: ORG, status: "CONFIRMED", now: NOW, actor: ACTOR, auditId: "logs" }),
    ).rejects.toThrow(/Assign a project before confirming/i);
  });
});

// ─── updateSubHirePaymentStatusNative ─────────────────────────────────────────
describe("updateSubHirePaymentStatusNative", () => {
  test("patches paymentStatus + audit; NO recalc", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, "p1", ORG, { total: 42 });
    await seedSupplier(t);
    await seedSubHire(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHirePaymentStatusNative, {
      id: "sh1", orgId: ORG, paymentStatus: "PARTIALLY_PAID", now: NOW + 1, actor: ACTOR, auditId: "logp",
    });
    expect((await shById(t, "sh1"))?.paymentStatus).toBe("PARTIALLY_PAID");
    expect((await projById(t, "p1"))?.total).toBe(42); // untouched (no recalc)
    expect((await logById(t, "logp"))?.summary).toBe("Updated payment status to partially paid on SH-9999");
  });
});

// ─── addSubHireItemNative (money cascade) ─────────────────────────────────────
describe("addSubHireItemNative", () => {
  test("inserts item → subHire.totalCharge updated + project line generated + project.total recalced + rate memory + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedModel(t);
    await seedSubHire(t); // DRAFT + projectId p1
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
      id: "it1", orgId: ORG, subHireId: "sh1", modelId: "mdl1", ...itemInput, now: NOW + 1, actor: ACTOR, auditId: "loga",
    });
    // sub-hire totals recomputed from the item (charge 100, cost 40).
    const sh = await shById(t, "sh1");
    expect(sh?.totalCharge).toBe(100);
    expect(sh?.totalCost).toBe(40);
    // project line generated (works for DRAFT), lineTotal 100.
    const lines = await linesForSubHire(t, "sh1");
    expect(lines.some((l) => l.subHireItemId === "it1" && l.lineTotal === 100)).toBe(true);
    // project total recalced 100 + 10% = 110.
    expect((await projById(t, "p1"))?.total).toBe(110);
    // supplier rate memory upserted.
    const rate = await t.run(async (ctx) =>
      ctx.db.query("supplierModelRates").withIndex("by_organizationId_supplierId_modelId", (q) => q.eq("organizationId", ORG).eq("supplierId", "sup1").eq("modelId", "mdl1")).first());
    expect(rate?.lastUnitCost).toBe(40);
    expect((await logById(t, "loga"))?.summary).toBe('Added item "Rigging" to SH-9999');
  });

  test("nextSort increments over existing items", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await t.run(async (ctx) => { await ctx.db.insert("subHireItems", { id: "it0", subHireId: "sh1", description: "old", sortOrder: 3 }); });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
      id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, now: NOW, actor: ACTOR, auditId: "loga",
    });
    expect((await itemById(t, "it1"))?.sortOrder).toBe(4);
  });

  test("cross-org model rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedModel(t, "mdl1", OTHER);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
        id: "it1", orgId: ORG, subHireId: "sh1", modelId: "mdl1", ...itemInput, now: NOW, actor: ACTOR, auditId: "loga",
      }),
    ).rejects.toThrow(/Model not found/i);
  });

  test("negative charge rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
        id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, unitCharge: -5, now: NOW, actor: ACTOR, auditId: "loga",
      }),
    ).rejects.toThrow(/Charge cannot be negative/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
        id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, now: NOW, actor: ACTOR, auditId: "loga",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateSubHireItemNative ──────────────────────────────────────────────────
describe("updateSubHireItemNative", () => {
  test("patches item → totals + project line recomputed", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
      id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, now: NOW, actor: ACTOR, auditId: "loga",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireItemNative, {
      itemId: "it1", orgId: ORG, ...itemInput, description: "Rigging", unitCharge: 250, now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    expect((await itemById(t, "it1"))?.unitCharge).toBe(250);
    expect((await shById(t, "sh1"))?.totalCharge).toBe(250);
    // regenerated line reflects the new charge; project total 250 + 10% = 275.
    expect((await projById(t, "p1"))?.total).toBe(275);
    expect((await logById(t, "logu"))?.summary).toBe('Updated item "Rigging" on SH-9999');
  });

  test("cross-org item rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", OTHER, { projectId: undefined });
    await t.run(async (ctx) => { await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "X", sortOrder: 0 }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireItemNative, {
        itemId: "it1", orgId: ORG, ...itemInput, now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/Sub-hire not found/i);
  });
});

// ─── removeSubHireItemNative ──────────────────────────────────────────────────
describe("removeSubHireItemNative", () => {
  test("deletes item + recalc; project line removed", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
      id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, now: NOW, actor: ACTOR, auditId: "loga",
    });
    expect((await projById(t, "p1"))?.total).toBe(110);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.removeSubHireItemNative, {
      itemId: "it1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logr",
    });
    expect(await itemById(t, "it1")).toBeNull();
    expect(await linesForSubHire(t, "sh1")).toHaveLength(0);
    expect((await shById(t, "sh1"))?.totalCharge).toBe(0);
    expect((await projById(t, "p1"))?.total).toBe(0);
    expect((await logById(t, "logr"))?.summary).toBe("Removed item from SH-9999");
  });

  test("rejects when the item's project line is CHECKED_OUT", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { status: "CONFIRMED" });
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "X", sortOrder: 0 });
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "X", quantity: 1, lineTotal: 100, isKitChild: false, subHireId: "sh1", subHireItemId: "it1", status: "CHECKED_OUT" });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.removeSubHireItemNative, { itemId: "it1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logr" }),
    ).rejects.toThrow(/checked-out/i);
    expect(await itemById(t, "it1")).not.toBeNull();
  });
});

// ─── reorderSubHireItemsNative ────────────────────────────────────────────────
describe("reorderSubHireItemsNative", () => {
  test("assigns sortOrder = index per id", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "a", subHireId: "sh1", description: "a", sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "b", subHireId: "sh1", description: "b", sortOrder: 1 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.reorderSubHireItemsNative, {
      orgId: ORG, subHireId: "sh1", itemIds: ["b", "a"], now: NOW, actor: ACTOR,
    });
    expect((await itemById(t, "b"))?.sortOrder).toBe(0);
    expect((await itemById(t, "a"))?.sortOrder).toBe(1);
  });

  test("empty itemIds is a no-op", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.reorderSubHireItemsNative, {
      orgId: ORG, subHireId: "sh1", itemIds: [], now: NOW, actor: ACTOR,
    });
    expect(res).toEqual({ ok: true });
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.reorderSubHireItemsNative, { orgId: ORG, subHireId: "sh1", itemIds: ["a"], now: NOW, actor: ACTOR }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
