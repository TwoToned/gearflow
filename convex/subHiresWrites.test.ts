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
      total: 0, ...extra,
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

async function seedProjectGroup(t: T, id: string, projectId: string, orgId = ORG, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectGroups", { id, organizationId: orgId, projectId, title: "PG", ...extra });
  });
}

const shById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("subHires").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const itemById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("subHireItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const groupById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("subHireGroups").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const logById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const linesForSubHire = (t: T, subHireId: string) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect());
const groupsForSubHire = (t: T, subHireId: string) =>
  t.run(async (ctx) => ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect());
const itemsForSubHire = (t: T, subHireId: string) =>
  t.run(async (ctx) => ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", subHireId)).collect());

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

  test("rejects out-of-bounds supplierReference/notes (R-8.6.2 server-side mirror of subHireSchema)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedSupplier(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, supplierReference: "x".repeat(201), now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Supplier reference/i);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", projectId: "p1", showOnDocs: false, notes: "x".repeat(2001), now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Notes/i);
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

  test("rejects out-of-bounds supplierReference/notes", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
        id: "sh1", orgId: ORG, supplierId: "sup1", showOnDocs: false, supplierReference: "x".repeat(201), now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/Supplier reference/i);
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

  test("rejects an out-of-bounds description (R-8.6.2 server-side mirror of subHireItemSchema)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.addSubHireItemNative, {
        id: "it1", orgId: ORG, subHireId: "sh1", ...itemInput, description: "x".repeat(501), now: NOW, actor: ACTOR, auditId: "loga",
      }),
    ).rejects.toThrow(/Description/i);
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

// ─── createSubHireGroupNative ─────────────────────────────────────────────────
describe("createSubHireGroupNative", () => {
  test("inserts group (nextSort) + regenerates project lines + recalc project + audit; NO subhire-totals recalc", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t); // DRAFT + projectId p1
    // An existing ungrouped item so the regenerate cascade produces a project line.
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 0, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
      await ctx.db.insert("subHireGroups", { id: "g0", subHireId: "sh1", title: "Existing", sortOrder: 2 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireGroupNative, {
      id: "g1", orgId: ORG, subHireId: "sh1", title: "Kit", now: NOW + 1, actor: ACTOR, auditId: "logg",
    });
    const g = await groupById(t, "g1");
    expect(g?.title).toBe("Kit");
    expect(g?.sortOrder).toBe(3); // nextSort over existing sortOrder 2
    // Regenerate ran → the ungrouped item's standalone line exists; project total 110.
    const lines = await linesForSubHire(t, "sh1");
    expect(lines.some((l) => l.subHireItemId === "it1" && l.lineTotal === 100)).toBe(true);
    expect((await projById(t, "p1"))?.total).toBe(110);
    expect((await logById(t, "logg"))?.summary).toBe('Created group "Kit" on SH-9999');
  });

  test("dup-guard: retried create (same cuid, same subHire) is idempotent — no second audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    const args = { id: "g1", orgId: ORG, subHireId: "sh1", title: "Kit", now: NOW, actor: ACTOR, auditId: "logg" };
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireGroupNative, args);
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireGroupNative, { ...args, auditId: "logg2" });
    expect(await groupsForSubHire(t, "sh1")).toHaveLength(1);
    expect(await logById(t, "logg2")).toBeNull();
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireGroupNative, { id: "g1", orgId: ORG, subHireId: "sh1", title: "Kit", now: NOW, actor: ACTOR, auditId: "logg" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects an out-of-bounds title (R-8.6.2 server-side mirror of subHireGroupSchema)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.createSubHireGroupNative, { id: "g1", orgId: ORG, subHireId: "sh1", title: "x".repeat(201), now: NOW, actor: ACTOR, auditId: "logg" }),
    ).rejects.toThrow(/Group title/i);
  });
});

// ─── updateSubHireGroupNative ─────────────────────────────────────────────────
describe("updateSubHireGroupNative", () => {
  test("patches group flat charge → recalc subhire totals + regen + recalc project + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t); // DRAFT + projectId p1
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Kit", quantity: 1, sortOrder: 0, showOnQuote: true });
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", groupId: "g1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 40, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
    });
    // Set a flat group charge of 300 → group total charge overrides item charges.
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireGroupNative, {
      groupId: "g1", orgId: ORG, title: "Kit", quantity: 1, charge: 300, cost: null, discount: 0, showOnQuote: true, showOnDocs: false, now: NOW + 1, actor: ACTOR, auditId: "logug",
    });
    expect((await groupById(t, "g1"))?.charge).toBe(300);
    // recalcSubHireTotals: group charge 300 (flat) → totalCharge 300; item cost 40 → totalCost 40.
    const sh = await shById(t, "sh1");
    expect(sh?.totalCharge).toBe(300);
    expect(sh?.totalCost).toBe(40);
    // Regenerated parent line uses KIT_PRICE with lineTotal 300; project total 300 + 10% = 330.
    expect((await projById(t, "p1"))?.total).toBe(330);
    expect((await logById(t, "logug"))?.summary).toBe('Updated group "Kit" on SH-9999');
  });

  test("cross-org group rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", OTHER, { projectId: undefined });
    await t.run(async (ctx) => { await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Kit", sortOrder: 0 }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireGroupNative, {
        groupId: "g1", orgId: ORG, title: "Kit", now: NOW, actor: ACTOR, auditId: "logug",
      }),
    ).rejects.toThrow(/Sub-hire not found/i);
  });
});

// ─── deleteSubHireGroupNative ─────────────────────────────────────────────────
describe("deleteSubHireGroupNative", () => {
  test("ungroups children (clears groupId) + deletes group + regenerates + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Kit", quantity: 1, sortOrder: 0, showOnQuote: true });
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", groupId: "g1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 0, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.deleteSubHireGroupNative, {
      groupId: "g1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logdg",
    });
    expect(await groupById(t, "g1")).toBeNull();
    // The child was ungrouped (groupId cleared), NOT deleted.
    expect((await itemById(t, "it1"))?.groupId).toBeUndefined();
    // Regenerate now emits the (ungrouped) item as a standalone line; project total 110.
    const lines = await linesForSubHire(t, "sh1");
    expect(lines.some((l) => l.subHireItemId === "it1" && l.lineTotal === 100)).toBe(true);
    expect((await projById(t, "p1"))?.total).toBe(110);
    expect((await logById(t, "logdg"))?.summary).toBe("Deleted group from SH-9999");
  });
});

// ─── setItemGroupNative ───────────────────────────────────────────────────────
describe("setItemGroupNative", () => {
  test("moves an item into a group in the SAME sub-hire", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Kit", sortOrder: 0, showOnQuote: true });
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 0, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.setItemGroupNative, {
      itemId: "it1", orgId: ORG, groupId: "g1", now: NOW, actor: ACTOR,
    });
    expect((await itemById(t, "it1"))?.groupId).toBe("g1");
  });

  test("cross-subHire group rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG);
    await seedSubHire(t, "sh2", ORG, { orderNumber: "SH-8888" });
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireGroups", { id: "g2", subHireId: "sh2", title: "Other", sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", sortOrder: 0 });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.setItemGroupNative, { itemId: "it1", orgId: ORG, groupId: "g2", now: NOW, actor: ACTOR }),
    ).rejects.toThrow(/Sub-hire group not found/i);
  });
});

// ─── updateSubHireOrderPricingNative ──────────────────────────────────────────
describe("updateSubHireOrderPricingNative", () => {
  test("ORDER_TOTAL mode: patches flat totals → recalc subhire totals + recalc project + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t); // DRAFT + projectId p1
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 40, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireOrderPricingNative, {
      subHireId: "sh1", orgId: ORG, pricingMode: "ORDER_TOTAL", orderTotalCost: 500, orderTotalCharge: 800, now: NOW + 1, actor: ACTOR, auditId: "logop",
    });
    const sh = await shById(t, "sh1");
    expect(sh?.pricingMode).toBe("ORDER_TOTAL");
    // ORDER_TOTAL: totalCost = orderTotalCost 500; totalCharge = orderTotalCharge 800.
    expect(sh?.totalCost).toBe(500);
    expect(sh?.totalCharge).toBe(800);
    expect((await logById(t, "logop"))?.summary).toBe("Changed pricing mode to ORDER_TOTAL on SH-9999");
  });
});

// ─── updateSubHirePlacementNative ─────────────────────────────────────────────
describe("updateSubHirePlacementNative", () => {
  test("order-level default placement patched onto the head + regenerate", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await seedProjectGroup(t, "pg1", "p1");
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHirePlacementNative, {
      entityType: "order", entityId: "sh1", orgId: ORG, targetGroupId: "pg1", targetCategoryId: null, now: NOW, actor: ACTOR,
    });
    expect((await shById(t, "sh1"))?.defaultTargetGroupId).toBe("pg1");
  });

  test("item-level placement patched onto the item", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedSubHire(t);
    await seedProjectGroup(t, "pg1", "p1");
    await t.run(async (ctx) => { await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", sortOrder: 0, showOnQuote: true }); });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHirePlacementNative, {
      entityType: "item", entityId: "it1", orgId: ORG, targetGroupId: "pg1", targetCategoryId: null, now: NOW, actor: ACTOR,
    });
    expect((await itemById(t, "it1"))?.targetGroupId).toBe("pg1");
  });

  test("cross-project target group rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, "p1");
    await seedProject(t, "p2");
    await seedSupplier(t);
    await seedSubHire(t); // projectId p1
    await seedProjectGroup(t, "pg2", "p2"); // belongs to a DIFFERENT project
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHirePlacementNative, {
        entityType: "order", entityId: "sh1", orgId: ORG, targetGroupId: "pg2", targetCategoryId: null, now: NOW, actor: ACTOR,
      }),
    ).rejects.toThrow(/Target group not found/i);
  });
});

// ─── changeSubHireProjectNative ───────────────────────────────────────────────
describe("changeSubHireProjectNative", () => {
  test("deletes OLD project lines + generates NEW project lines (CONFIRMED) + recalcs BOTH + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, "p1", ORG, { total: 110, projectNumber: "P-1" });
    await seedProject(t, "p2", ORG, { total: 0, projectNumber: "P-2" });
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { status: "CONFIRMED" }); // projectId p1
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCharge: 100, unitCost: 0, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, sortOrder: 0 });
      // An existing generated line on the OLD project.
      await ctx.db.insert("projectLineItems", { id: "li_old", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", description: "Rig", quantity: 1, unitPrice: 100, lineTotal: 100, isKitChild: false, subHireId: "sh1", subHireItemId: "it1", status: "QUOTED" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.changeSubHireProjectNative, {
      subHireId: "sh1", orgId: ORG, newProjectId: "p2", now: NOW + 1, actor: ACTOR, auditId: "logcp",
    });
    expect((await shById(t, "sh1"))?.projectId).toBe("p2");
    // Old line deleted, new line generated on p2.
    const lines = await linesForSubHire(t, "sh1");
    expect(lines).toHaveLength(1);
    expect(lines[0].projectId).toBe("p2");
    // BOTH projects recalced: p1 has no more billable lines (0), p2 = 100 + 10% = 110.
    expect((await projById(t, "p1"))?.total).toBe(0);
    expect((await projById(t, "p2"))?.total).toBe(110);
    expect((await logById(t, "logcp"))?.summary).toBe("Moved sub-hire SH-9999 to project P-2");
  });

  test("cross-org new project rejected", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t, "p1");
    await seedProject(t, "p2", OTHER);
    await seedSupplier(t);
    await seedSubHire(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.changeSubHireProjectNative, { subHireId: "sh1", orgId: ORG, newProjectId: "p2", now: NOW, actor: ACTOR, auditId: "logcp" }),
    ).rejects.toThrow(/Project not found/i);
  });
});

// ─── duplicateSubHireNative ───────────────────────────────────────────────────
describe("duplicateSubHireNative", () => {
  test("copies groups + items with fresh ids, fresh order number, NO project + audit", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, pricingMode: "ITEMIZED", notes: "src notes" });
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireGroups", { id: "g1", subHireId: "sh1", title: "Kit", quantity: 2, cost: 50, charge: 120, showOnQuote: true, showOnDocs: false, sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", groupId: "g1", modelId: "mdl1", description: "Rig", quantity: 1, unitCost: 40, unitCharge: 100, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, showOnDocs: false, sortOrder: 0 });
      await ctx.db.insert("subHireItems", { id: "it2", subHireId: "sh1", description: "Loose", quantity: 3, unitCost: 10, unitCharge: 25, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, showOnDocs: false, sortOrder: 1 });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.duplicateSubHireNative, {
      id: "sh2", orgId: ORG, sourceId: "sh1", now: NOW, actor: ACTOR, auditId: "logdup",
    });
    expect(res.orderNumber).toBe("SH-0001"); // fresh counter
    const dup = await shById(t, "sh2");
    expect(dup?.projectId).toBeUndefined(); // no project on the duplicate
    expect(dup?.notes).toBe("src notes");
    expect(dup?.createdById).toBe(USER);
    // Groups copied with FRESH ids (not "g1"); item re-points to the new group id.
    const dupGroups = await groupsForSubHire(t, "sh2");
    expect(dupGroups).toHaveLength(1);
    expect(dupGroups[0].id).not.toBe("g1");
    expect(dupGroups[0].title).toBe("Kit");
    const dupItems = await itemsForSubHire(t, "sh2");
    expect(dupItems).toHaveLength(2);
    const grouped = dupItems.find((i) => i.description === "Rig");
    expect(grouped?.groupId).toBe(dupGroups[0].id); // remapped, not "g1"
    expect(grouped?.id).not.toBe("it1"); // fresh cuid
    expect(dupItems.find((i) => i.description === "Loose")?.groupId).toBeUndefined();
    expect((await logById(t, "logdup"))?.summary).toBe("Duplicated sub-hire from SH-9999 to SH-0001");
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedSupplier(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.duplicateSubHireNative, { id: "sh2", orgId: ORG, sourceId: "sh1", now: NOW, actor: ACTOR, auditId: "logdup" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("does NOT copy supplierOrderId — the duplicate starts unlinked", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("supplierOrders", { id: "po1", organizationId: ORG, supplierId: "sup1", orderNumber: "PO-1", type: "SUBHIRE", createdAt: NOW });
    });
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, supplierOrderId: "po1" });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.duplicateSubHireNative, {
      id: "sh2", orgId: ORG, sourceId: "sh1", now: NOW, actor: ACTOR, auditId: "logdup2",
    });
    const dup = await shById(t, "sh2");
    expect(dup?.supplierOrderId).toBeUndefined();
  });
});

// ─── WS7 #946 — supplierOrderId FK: link/unlink, clear-on-supplier-change ─────
async function seedOrder(t: T, id = "po1", orgId = ORG, supplierId = "sup1", extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("supplierOrders", { id, organizationId: orgId, supplierId, orderNumber: `PO-${id}`, type: "SUBHIRE", createdAt: NOW, ...extra });
  });
}
describe("linkSubHireToSupplierOrderNative / unlinkSubHireFromSupplierOrderNative", () => {
  test("links a same-supplier order + audits", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedOrder(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
      id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
    });
    expect(res).toEqual({ id: "sh1" });
    const sh = await shById(t, "sh1");
    expect(sh?.supplierOrderId).toBe("po1");
    expect((await logById(t, "loglink"))?.summary).toBe("Linked sub-hire SH-9999 to purchase order PO-po1");
  });

  test("rejects a link to an order with a DIFFERENT supplier", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t, "sup1");
    await seedSupplier(t, "sup2");
    await seedOrder(t, "po1", ORG, "sup2"); // order belongs to a different supplier
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, supplierId: "sup1" });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
        id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
      }),
    ).rejects.toThrow(/supplier must match/i);
  });

  test("rejects a cross-org order (by_cuid is global)", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedOrder(t, "po1", OTHER, "sup1");
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
        id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
      }),
    ).rejects.toThrow(/Purchase order not found/i);
  });

  test("rejects a cross-org sub-hire", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedOrder(t);
    await seedSubHire(t, "sh1", OTHER, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
        id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
      }),
    ).rejects.toThrow(/Sub-hire not found/i);
  });

  test("stamps supplierOrderId onto regenerated project lines when linked", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedProject(t);
    await seedSupplier(t);
    await seedOrder(t);
    await seedSubHire(t, "sh1"); // DRAFT, projectId "p1" (seedSubHire's default)
    await t.run(async (ctx) => {
      await ctx.db.insert("subHireItems", { id: "it1", subHireId: "sh1", description: "Rig", quantity: 1, unitCost: 40, unitCharge: 100, pricingType: "FLAT", duration: 1, discount: 0, showOnQuote: true, showOnDocs: false, sortOrder: 0 });
    });
    // Confirm generates the line first (without a link yet).
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireStatusNative, {
      id: "sh1", orgId: ORG, status: "CONFIRMED", now: NOW, actor: ACTOR, auditId: "logstatus",
    });
    let lines = await linesForSubHire(t, "sh1");
    expect(lines[0]?.supplierOrderId).toBeUndefined();

    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
      id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
    });
    lines = await linesForSubHire(t, "sh1");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.supplierOrderId).toBe("po1");
  });

  test("unlink clears the FK + regenerates lines without it; idempotent when already unlinked", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t);
    await seedOrder(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, supplierOrderId: "po1" });
    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.unlinkSubHireFromSupplierOrderNative, {
      id: "sh1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logunlink",
    });
    expect((await shById(t, "sh1"))?.supplierOrderId).toBeUndefined();

    // Idempotent — no error, no-op.
    const res = await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.unlinkSubHireFromSupplierOrderNative, {
      id: "sh1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logunlink2",
    });
    expect(res).toEqual({ id: "sh1" });
  });

  test("viewer denied on link", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedSupplier(t);
    await seedOrder(t);
    await seedSubHire(t, "sh1", ORG, { projectId: undefined });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.linkSubHireToSupplierOrderNative, {
        id: "sh1", orgId: ORG, supplierOrderId: "po1", now: NOW, actor: ACTOR, auditId: "loglink",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("updateSubHireNative — clear-on-supplier-change (WS7 #946)", () => {
  test("changing the sub-hire's supplier clears an existing supplierOrderId link", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t, "sup1");
    await seedSupplier(t, "sup2");
    await seedOrder(t, "po1", ORG, "sup1");
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, supplierId: "sup1", supplierOrderId: "po1" });

    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
      id: "sh1", orgId: ORG, supplierId: "sup2", showOnDocs: false, now: NOW, actor: ACTOR, auditId: "logu",
    });
    const sh = await shById(t, "sh1");
    expect(sh?.supplierId).toBe("sup2");
    expect(sh?.supplierOrderId).toBeUndefined();
  });

  test("resubmitting the SAME supplier leaves the link untouched", async () => {
    const t = makeT();
    await member(t, "manager");
    await seedSupplier(t, "sup1");
    await seedOrder(t, "po1", ORG, "sup1");
    await seedSubHire(t, "sh1", ORG, { projectId: undefined, supplierId: "sup1", supplierOrderId: "po1" });

    await t.withIdentity(asUser(ORG)).mutation(api.subHiresWrites.updateSubHireNative, {
      id: "sh1", orgId: ORG, supplierId: "sup1", showOnDocs: false, supplierReference: "same-ref", now: NOW, actor: ACTOR, auditId: "logu",
    });
    expect((await shById(t, "sh1"))?.supplierOrderId).toBe("po1");
  });
});
