// @vitest-environment node
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
// Counted project writes go through the sharded counter component (gate #3); mount it.
// enforceBrowserWriteLimit goes through the rate-limiter component; mount it too.
function makeT() {
  const tc = convexTest(schema, modules);
  registerRateLimiter(tc, "rateLimiter");
  registerShardedCounter(tc, "shardedCounter");
  return tc;
}
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function seedProject(t: ReturnType<typeof convexTest>, role?: string, isTemplate = false) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate, createdAt: NOW, updatedAt: NOW });
    if (role) await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
  });
}

describe("projectWrites.updateStatusNative", () => {
  const args = { id: "p1", orgId: ORG, status: "PREPPING" as const, actor: ACTOR, auditId: "log1", now: NOW };

  test("member changes status + STATUS_CHANGE audit (from/to)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("PREPPING");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("STATUS_CHANGE");
      expect(log?.details).toEqual({ changes: [{ field: "status", from: "CONFIRMED", to: "PREPPING" }] });
    });
  });

  test("an open BLOCKING comment blocks a forward move to PREPPING", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("commentThreads", { orgId: ORG, entityType: "project", entityId: "p1", projectId: "p1", status: "open", isBlocking: true, createdBy: USER, createdByName: "Alice", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow();
    // Status unchanged.
    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.status).toBe("CONFIRMED");
  });

  test("a RESOLVED blocking comment does NOT block; a non-forward status is ungated", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("commentThreads", { orgId: ORG, entityType: "project", entityId: "p1", projectId: "p1", status: "resolved", isBlocking: true, createdBy: USER, createdByName: "Alice", createdAt: NOW, updatedAt: NOW });
    });
    // resolved comment → forward move allowed
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args);
    expect((await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()))?.status).toBe("PREPPING");
  });

  test("an open blocking comment does NOT block a BACKWARD/neutral move (e.g. CANCELLED)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("commentThreads", { orgId: ORG, entityType: "project", entityId: "p1", projectId: "p1", status: "open", isBlocking: true, createdBy: USER, createdByName: "Alice", createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, { ...args, status: "CANCELLED" as const });
    expect((await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()))?.status).toBe("CANCELLED");
  });

  test("rejects a template (TEMPLATE_STATUS)", async () => {
    const t = makeT();
    await seedProject(t, undefined, true);
    await expect(
      t.withIdentity(SERVICE).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/template/i);
  });

  test("a viewer is denied (project:update)", async () => {
    const t = makeT();
    await seedProject(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

describe("projectWrites.updateNotesNative", () => {
  test("patches a whitelisted notes field + audit; clears on null", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNotesNative, { id: "p1", orgId: ORG, field: "crewNotes", notes: "load in 6am", actor: ACTOR, auditId: "log1", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.crewNotes).toBe("load in 6am");
    });
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNotesNative, { id: "p1", orgId: ORG, field: "crewNotes", notes: null, actor: ACTOR, auditId: "log2", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.crewNotes).toBeUndefined();
    });
  });
});

describe("projectWrites.archiveNative", () => {
  test("sets status CANCELLED + audit", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(SERVICE).mutation(api.projectWrites.archiveNative, { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.status).toBe("CANCELLED");
    });
  });
});

describe("projectWrites.updateNative", () => {
  const uargs = { id: "p1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW };
  test("member patches fields + UPDATE audit (label from doc)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { name: "Renamed Gig", taxRate: 10, updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.name).toBe("Renamed Gig");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("UPDATE");
      expect(log?.entityName).toBe("P1");
      expect(log?.summary).toContain("Renamed Gig");
    });
  });
  test("clear removes a field", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, clientNotes: "x", createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(SERVICE).mutation(api.projectWrites.updateNative, { ...uargs, set: { updatedAt: NOW }, clear: ["clientNotes"] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.clientNotes).toBeUndefined();
    });
  });
  test("viewer denied", async () => {
    const t = makeT();
    await seedProject(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { updatedAt: NOW }, clear: [] })).rejects.toThrow(/insufficient permissions/i);
  });
  test("strips forged money totals + isTemplate from a client set (injection guard)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, total: 500, margin: 100, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, {
      ...uargs,
      set: { name: "Edited", total: 0, margin: 999999999, equipmentRevenue: 1e9, isTemplate: true, updatedAt: NOW },
      clear: [],
    });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.name).toBe("Edited"); // legit field applied
      expect(p?.total).toBe(500); // recalc-owned totals untouched
      expect(p?.margin).toBe(100);
      expect(p?.equipmentRevenue).toBeUndefined();
      expect(p?.isTemplate).toBe(false); // no in-place template flip
    });
  });
});

describe("projectWrites.createNative", () => {
  const cargs = { id: "np1", organizationId: ORG, projectNumber: "P-100", name: "New Gig", isTemplate: false, createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1" };
  test("member creates a project + CREATE audit (created:true)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, cargs);
    expect(res).toEqual({ created: true, id: "np1" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first();
      expect(p?.projectNumber).toBe("P-100");
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
    });
  });
  test("returns created:false + no insert/audit on a number clash", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "existing", organizationId: ORG, projectNumber: "P-100", name: "Taken", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    const res = await t.withIdentity(SERVICE).mutation(api.projectWrites.createNative, cargs);
    expect(res).toEqual({ created: false, id: "existing" });
    await t.run(async (ctx) => {
      const np = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first();
      expect(np).toBeNull();
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log).toBeNull();
    });
  });
  test("a viewer is denied (project:create)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "viewer" }); });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, cargs)).rejects.toThrow(/insufficient permissions/i);
  });
  test("strips forged money totals from a create (recalc owns them)", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, total: 999999, margin: 888888, equipmentRevenue: 777777 } as typeof cargs);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first();
      expect(p?.total).toBeUndefined();
      expect(p?.margin).toBeUndefined();
      expect(p?.equipmentRevenue).toBeUndefined();
    });
  });
});

describe("projectWrites.deleteNative", () => {
  const dargs = { id: "p1", orgId: ORG, defaultLocationId: "loc1" as string | null, actor: ACTOR, auditId: "log1", now: NOW };

  // Seed a CANCELLED project loaded with every dependent row-type the cascade must
  // clear, plus a checked-out LOOSE asset + a checked-out KIT (with a serialized
  // member asset) that must be freed to AVAILABLE.
  async function seedFullCancelledProject(t: ReturnType<typeof convexTest>, role = "owner") {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CANCELLED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      // The org's default location (the delete mutation org-validates defaultLocationId).
      await ctx.db.insert("locations", { id: "loc1", organizationId: ORG, name: "Warehouse", createdAt: NOW, updatedAt: NOW });

      // A loose serialized asset, checked out on a line.
      await ctx.db.insert("assets", { id: "asset_loose", organizationId: ORG, modelId: "model1", assetTag: "A-1", status: "CHECKED_OUT", isActive: true, locationId: "old_loc", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "li_loose", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", assetId: "asset_loose", quantity: 1, status: "CHECKED_OUT", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "unit_loose", organizationId: ORG, lineItemId: "li_loose", assetId: "asset_loose", status: "CHECKED_OUT", ordinal: 0, createdAt: NOW, updatedAt: NOW });

      // A checked-out kit + its serialized member asset + the kit parent line.
      await ctx.db.insert("kits", { id: "kit1", organizationId: ORG, assetTag: "K-1", name: "Kit One", status: "CHECKED_OUT", locationId: "old_loc", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", { id: "asset_kit", organizationId: ORG, modelId: "model1", assetTag: "A-2", status: "CHECKED_OUT", isActive: true, locationId: "old_loc", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("kitSerializedItems", { id: "ksi1", organizationId: ORG, kitId: "kit1", assetId: "asset_kit", addedById: USER, addedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "li_kit", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", kitId: "kit1", quantity: 1, status: "CHECKED_OUT", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      // A kit-child line + unit (must be cascaded via the parent).
      await ctx.db.insert("projectLineItems", { id: "li_kit_child", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", assetId: "asset_kit", quantity: 1, status: "CHECKED_OUT", sortOrder: 2, isKitChild: true, parentLineItemId: "li_kit", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "unit_kit_child", organizationId: ORG, lineItemId: "li_kit_child", assetId: "asset_kit", status: "CHECKED_OUT", ordinal: 0, createdAt: NOW, updatedAt: NOW });

      // Crew assignment → shift → time entry.
      await ctx.db.insert("crewAssignments", { id: "ca1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("crewShifts", { id: "cs1", assignmentId: "ca1", date: NOW });
      await ctx.db.insert("crewTimeEntries", { id: "cte1", organizationId: ORG, assignmentId: "ca1", crewMemberId: "cm1", date: NOW, startTime: "09:00", endTime: "17:00" });

      // PM / task / service.
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER, addedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "task1", organizationId: ORG, projectId: "p1", title: "Load in", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectServices", { id: "svc1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Labour", createdAt: NOW, updatedAt: NOW });

      // Grouping: category + group + slots.
      await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "p1", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "grp1", organizationId: ORG, projectId: "p1", title: "Stage", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slot_cat", projectCategoryId: "cat1", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "slot_grp", projectCategoryId: "cat1", projectGroupId: "grp1", sortOrder: 0 });

      // The revenue rollup (the orphan the stub missed).
      await ctx.db.insert("projectModelRevenues", { id: "pmr1", organizationId: ORG, projectId: "p1", modelId: "model1", allocatedRevenue: 100, updatedAt: NOW });
    });
  }

  test("full cascade: project + every dependent row gone; assets/kit freed to AVAILABLE", async () => {
    const t = makeT();
    await seedFullCancelledProject(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs);
    // freedAssets = 2: the loose line's asset + the kit-CHILD line's asset (the raw
    // line loop counts kit-child lines too — exact parity with the old server loop).
    expect(res).toEqual({ id: "p1", freedAssets: 2, freedKits: 1 });

    await t.run(async (ctx) => {
      const gone = async (table: string, id: string) =>
        (await ctx.db.query(table as "projects").withIndex("by_cuid", (q) => q.eq("id", id)).first()) ?? null;
      // Project + all dependents cleared.
      expect(await gone("projects", "p1")).toBeNull();
      for (const [tbl, id] of [
        ["projectLineItems", "li_loose"], ["projectLineItems", "li_kit"], ["projectLineItems", "li_kit_child"],
        ["projectLineItemUnits", "unit_loose"], ["projectLineItemUnits", "unit_kit_child"],
        ["crewAssignments", "ca1"], ["crewShifts", "cs1"], ["crewTimeEntries", "cte1"],
        ["projectManagers", "pm1"], ["projectTasks", "task1"], ["projectServices", "svc1"],
        ["projectCategories", "cat1"], ["projectGroups", "grp1"],
        ["categorySlots", "slot_cat"], ["categorySlots", "slot_grp"],
        ["projectModelRevenues", "pmr1"],
      ] as const) {
        expect(await gone(tbl, id)).toBeNull();
      }
      // Loose asset + kit-serialized asset freed to AVAILABLE at the default location.
      const loose = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "asset_loose")).first();
      expect(loose?.status).toBe("AVAILABLE");
      expect(loose?.locationId).toBe("loc1");
      const kitAsset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "asset_kit")).first();
      expect(kitAsset?.status).toBe("AVAILABLE");
      expect(kitAsset?.locationId).toBe("loc1");
      // Kit itself freed to AVAILABLE (not archived).
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "kit1")).first();
      expect(kit?.status).toBe("AVAILABLE");
      expect(kit?.locationId).toBe("loc1");
      // DELETE audit with computed freed counts.
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("DELETE");
      expect((log?.details as { freedAssets: number; freedKits: number }).freedAssets).toBe(2);
      expect((log?.details as { freedAssets: number; freedKits: number }).freedKits).toBe(1);
    });
  });

  test("rejects a non-CANCELLED project (DELETE_GUARD)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs),
    ).rejects.toThrow(/cancelled/i);
  });

  test("rejects a template (must use deleteTemplateNative)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "T", status: "CANCELLED", isTemplate: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs),
    ).rejects.toThrow(/template/i);
  });

  test("a member (no project:delete) is denied", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CANCELLED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, dargs)).rejects.toThrow(/insufficient permissions/i);
  });

  test("frees assets with NO default location (clears locationId)", async () => {
    const t = makeT();
    await seedFullCancelledProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteNative, { ...dargs, defaultLocationId: null });
    await t.run(async (ctx) => {
      const loose = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "asset_loose")).first();
      expect(loose?.status).toBe("AVAILABLE");
      expect(loose?.locationId).toBeUndefined();
      // Kit keeps its old location (server never clears a kit's location).
      const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "kit1")).first();
      expect(kit?.status).toBe("AVAILABLE");
      expect(kit?.locationId).toBe("old_loc");
    });
  });
});

describe("projectWrites.deleteTemplateNative", () => {
  const targs = { id: "t1", orgId: ORG, actor: ACTOR, now: NOW };

  async function seedTemplate(t: ReturnType<typeof convexTest>, role = "owner", isTemplate = true) {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
      await ctx.db.insert("projects", { id: "t1", organizationId: ORG, projectNumber: "T1", name: "Template", isTemplate, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "tli1", organizationId: ORG, projectId: "t1", type: "EQUIPMENT", quantity: 1, status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectManagers", { id: "tpm1", organizationId: ORG, projectId: "t1", userId: USER, addedAt: NOW });
      await ctx.db.insert("projectCategories", { id: "tcat1", organizationId: ORG, projectId: "t1", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("categorySlots", { id: "tslot1", projectCategoryId: "tcat1", sortOrder: 0 });
      await ctx.db.insert("projectModelRevenues", { id: "tpmr1", organizationId: ORG, projectId: "t1", modelId: "model1", allocatedRevenue: 0, updatedAt: NOW });
    });
  }

  test("deletes a template + its lines/grouping/rollup (no audit)", async () => {
    const t = makeT();
    await seedTemplate(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteTemplateNative, targs);
    expect(res).toEqual({ success: true });
    await t.run(async (ctx) => {
      const gone = async (table: string, id: string) =>
        (await ctx.db.query(table as "projects").withIndex("by_cuid", (q) => q.eq("id", id)).first()) ?? null;
      expect(await gone("projects", "t1")).toBeNull();
      for (const [tbl, id] of [
        ["projectLineItems", "tli1"], ["projectManagers", "tpm1"],
        ["projectCategories", "tcat1"], ["categorySlots", "tslot1"],
        ["projectModelRevenues", "tpmr1"],
      ] as const) {
        expect(await gone(tbl, id)).toBeNull();
      }
      // No audit is written for a template delete.
      const logs = await ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect();
      expect(logs.length).toBe(0);
    });
  });

  test("rejects a non-template (NOT_A_TEMPLATE)", async () => {
    const t = makeT();
    await seedTemplate(t, "owner", false);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteTemplateNative, targs),
    ).rejects.toThrow(/not a template|project, not a template/i);
  });

  test("a member (no project:delete) is denied", async () => {
    const t = makeT();
    await seedTemplate(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.deleteTemplateNative, targs),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});
