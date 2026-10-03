// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { readCounter } from "./lib/shardedCounter";

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
const DAY = 86_400_000;
const asUser = (orgId: string) => ({ subject: USER, orgId });
const ACTOR = { userId: USER, userName: "Alice" };

async function member(t: T, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

/** #1228 — every project needs a live projectVersions row + liveVersionId
 *  (deterministic `v-${id}`), or every by_versionId-family read/write on it
 *  throws. */
async function seedProject(t: T, id = "p1", orgId = ORG, extra: Record<string, unknown> = {}) {
  const versionId = `v-${id}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id, organizationId: orgId, projectNumber: `P-${id}`, name: "Gig", status: "QUOTED",
      total: 999, taxRate: 10, liveVersionId: versionId, ...extra,
    });
    await ctx.db.insert("projectVersions", {
      id: versionId, organizationId: orgId, projectId: id, number: 1,
      contentState: "ready", createdAt: NOW, createdById: "u1",
    });
  });
}

async function seedCrew(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("crewMembers", { id: "cm1", organizationId: orgId, firstName: "Bob", lastName: "Roe", status: "ACTIVE" });
    await ctx.db.insert("crewMembers", { id: "cm2", organizationId: orgId, firstName: "Cara", lastName: "Doe", status: "ACTIVE" });
    await ctx.db.insert("crewRoles", { id: "cr1", organizationId: orgId, name: "Tech" });
  });
}

const svcById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const logById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const projById = (t: T, id: string) => t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const asgsForService = (t: T, serviceId: string) =>
  t.run(async (ctx) => ctx.db.query("crewAssignments").withIndex("by_serviceId", (q) => q.eq("serviceId", serviceId)).collect());
const pendingOffers = (t: T) => t.run(async (ctx) => readCounter(ctx, ORG, "pendingCrewOffers"));

const baseInput = { type: "MISC" as const, title: "Setup", showOnDocuments: true, quantity: 1, taxable: true };

// ─── createServiceNative ──────────────────────────────────────────────────────
describe("createServiceNative", () => {
  test("creates a service (lineTotal + sortOrder) + audit + recalc (billable revenue)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 100, now: NOW, actor: ACTOR, auditId: "log1",
    });
    expect(res.id).toBe("s1");
    const s = await svcById(t, "s1");
    expect(s?.title).toBe("Setup");
    expect(s?.lineTotal).toBe(100);
    expect(s?.sortOrder).toBe(0);
    const log = await logById(t, "log1");
    expect(log?.action).toBe("created");
    expect(log?.summary).toBe('Created Misc service "Setup"');
    expect(log?.entityId).toBe("s1");
    // showOnDocuments:true → serviceRevenue 100 → subtotal 100 + 10% tax = 110.
    expect((await projById(t, "p1"))?.total).toBe(110);
  });

  test("rejects non-finite money (NaN unitPrice would poison recalc → project.total NaN)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: Number.NaN, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/finite/i);
    // No row, no audit, project.total unchanged (rejected before any write).
    expect(await svcById(t, "s1")).toBeNull();
    expect((await projById(t, "p1"))?.total).toBe(999);
  });

  test("crew assignment inserted (PENDING, phase, role) + counter bump", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrew(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, crewRoleId: "cr1",
      crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW, actor: ACTOR, auditId: "log1",
    });
    const asgs = await asgsForService(t, "s1");
    expect(asgs).toHaveLength(1);
    expect(asgs[0].id).toBe("a1");
    expect(asgs[0].status).toBe("PENDING");
    expect(asgs[0].phase).toBe("FULL_DURATION");
    expect(asgs[0].crewRoleId).toBe("cr1");
    expect(await pendingOffers(t)).toBe(1); // PENDING counted
  });

  test("crew rate cascade runs on create — resolved rate lands in estimatedCost + rolls up into costTotal (#796)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE", defaultDayRate: 300 });
      await ctx.db.insert("crewMembers", { id: "cm2", organizationId: ORG, firstName: "Cara", lastName: "Doe", status: "ACTIVE", defaultDayRate: 300 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, costTotal: 999 /* manual value must be overridden */,
      crew: [
        { id: "a1", crewMemberId: "cm1" }, // no override → member's day rate, 300
        { id: "a2", crewMemberId: "cm2", rateOverride: 150, rateType: "FLAT" as const }, // overridden
      ],
      now: NOW, actor: ACTOR, auditId: "log1",
    });
    const asgs = await asgsForService(t, "s1");
    expect(asgs.find((a) => a.id === "a1")?.estimatedCost).toBe(300);
    expect(asgs.find((a) => a.id === "a2")?.estimatedCost).toBe(150);
    const s = await svcById(t, "s1");
    expect(s?.costTotal).toBe(450); // 300 + 150, NOT the manually-sent 999
  });

  test("dup-guard: a retried create (same cuid) is idempotent — no second audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    const args = { id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "log1" };
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, args);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, { ...args, auditId: "log2" });
    const rows = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", "s1")).collect());
    expect(rows).toHaveLength(1);
    expect(await logById(t, "log2")).toBeNull();
  });

  test("cross-org project rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "pX", OTHER);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "pX", ...baseInput, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Project not found/i);
  });

  // R-8.6.2 — a direct-mutation caller (bypassing projectServiceSchema.parse() in the
  // browser hook) must still hit the same business-constraint bound server-side.
  test("rejects a quantity below the 1 lower bound", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, quantity: 0, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/quantity/i);
    expect(await svcById(t, "s1")).toBeNull();
  });

  test("cross-org crew member rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewMembers", { id: "cmX", organizationId: OTHER, firstName: "X", lastName: "Y", status: "ACTIVE" }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, crew: [{ id: "a1", crewMemberId: "cmX" }], now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/Crew member not found/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateServiceNative (crew reconcile) ─────────────────────────────────────
describe("updateServiceNative", () => {
  async function seedService(t: T) {
    await member(t, "member");
    await seedProject(t);
    await seedCrew(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 100, crewRoleId: "cr1",
      crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW, actor: ACTOR, auditId: "logc",
    });
  }

  test("patches fields + audit + recalc; reconcile swaps crew (remove + add) with net counters", async () => {
    const t = makeT();
    await seedService(t);
    expect(await pendingOffers(t)).toBe(1);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput, title: "Renamed", unitPrice: 200, crewRoleId: "cr1",
      crew: [{ id: "a2", crewMemberId: "cm2" }], now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    const s = await svcById(t, "s1");
    expect(s?.title).toBe("Renamed");
    expect(s?.lineTotal).toBe(200);
    const asgs = await asgsForService(t, "s1");
    expect(asgs.map((a) => a.crewMemberId).sort()).toEqual(["cm2"]);
    expect(await pendingOffers(t)).toBe(1); // -1 (cm1 removed) +1 (cm2 added) = net 1
    const log = await logById(t, "logu");
    expect(log?.summary).toBe('Updated Misc service "Renamed"');
    expect((await projById(t, "p1"))?.total).toBe(220); // 200 + 10% tax
  });

  test("role-patch survivors when crewRoleId changes", async () => {
    const t = makeT();
    await seedService(t);
    await t.run(async (ctx) => { await ctx.db.insert("crewRoles", { id: "cr2", organizationId: ORG, name: "Lead" }); });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput, crewRoleId: "cr2",
      crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    const asgs = await asgsForService(t, "s1");
    expect(asgs).toHaveLength(1);
    expect(asgs[0].crewMemberId).toBe("cm1"); // survivor
    expect(asgs[0].crewRoleId).toBe("cr2");   // role patched
  });

  test("empty crew reconcile removes all", async () => {
    const t = makeT();
    await seedService(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput, crew: [], now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    expect(await asgsForService(t, "s1")).toHaveLength(0);
    expect(await pendingOffers(t)).toBe(0);
  });

  test("survivor rate-table edit recomputes estimatedCost + rolls up costTotal, without waiting on a role change (#796)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("crewMembers", { id: "cm1", organizationId: ORG, firstName: "Bob", lastName: "Roe", status: "ACTIVE", defaultDayRate: 300 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW, actor: ACTOR, auditId: "logc",
    });
    expect((await svcById(t, "s1"))?.costTotal).toBe(300);

    // Same crew (survivor), no role change — only the rate override moved.
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput,
      crew: [{ id: "a1", crewMemberId: "cm1", rateOverride: 175, rateType: "FLAT" as const }],
      now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    const asgs = await asgsForService(t, "s1");
    expect(asgs[0].estimatedCost).toBe(175);
    expect(asgs[0].rateOverride).toBe(175);
    expect((await svcById(t, "s1"))?.costTotal).toBe(175);
  });

  test("a crew-less service keeps its manually-entered costTotal untouched", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, costTotal: 60, now: NOW, actor: ACTOR, auditId: "logc",
    });
    expect((await svcById(t, "s1"))?.costTotal).toBe(60);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
      id: "s1", orgId: ORG, ...baseInput, costTotal: 80, now: NOW + 1, actor: ACTOR, auditId: "logu",
    });
    expect((await svcById(t, "s1"))?.costTotal).toBe(80); // manual value passes through untouched
  });

  test("cross-org service rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => { await ctx.db.insert("projectServices", { id: "s1", organizationId: OTHER, projectId: "pX", type: "MISC", title: "T", quantity: 1 }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
        id: "s1", orgId: ORG, ...baseInput, now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/Service not found/i);
  });

  // R-8.6.2 — same bound, enforced on the update path (not just createServiceNative).
  test("rejects a quantity patch below the 1 lower bound", async () => {
    const t = makeT();
    await seedService(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
        id: "s1", orgId: ORG, ...baseInput, quantity: -1, now: NOW + 1, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/quantity/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceNative, {
        id: "s1", orgId: ORG, ...baseInput, now: NOW, actor: ACTOR, auditId: "logu",
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── deleteServiceNative ──────────────────────────────────────────────────────
describe("deleteServiceNative", () => {
  test("cascade-deletes service + crew (counter -1) + recalc + audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await seedCrew(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 100, crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW, actor: ACTOR, auditId: "logc",
    });
    await t.run(async (ctx) => { await ctx.db.insert("crewShifts", { id: "sh1", assignmentId: "a1", date: NOW, status: "SCHEDULED" }); });
    expect(await pendingOffers(t)).toBe(1);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.deleteServiceNative, {
      id: "s1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logd",
    });
    expect(await svcById(t, "s1")).toBeNull();
    expect(await asgsForService(t, "s1")).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("crewShifts").withIndex("by_cuid", (q) => q.eq("id", "sh1")).first())).toBeNull();
    expect(await pendingOffers(t)).toBe(0); // crew removed
    expect((await logById(t, "logd"))?.summary).toBe('Deleted Misc service "Setup"');
    expect((await projById(t, "p1"))?.total).toBe(0); // service gone → 0 billable
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.deleteServiceNative, { id: "s1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logd" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── updateServiceStatusNative ────────────────────────────────────────────────
describe("updateServiceStatusNative", () => {
  test("patches status + audit (from→to) + recalc", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 100, now: NOW, actor: ACTOR, auditId: "logc",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceStatusNative, {
      id: "s1", orgId: ORG, status: "CANCELLED", now: NOW + 1, actor: ACTOR, auditId: "logs",
    });
    expect((await svcById(t, "s1"))?.status).toBe("CANCELLED");
    expect((await logById(t, "logs"))?.summary).toBe("Changed Setup status from PLANNED to CANCELLED");
    // CANCELLED service excluded from revenue → total 0.
    expect((await projById(t, "p1"))?.total).toBe(0);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceStatusNative, { id: "s1", orgId: ORG, status: "CONFIRMED", now: NOW, actor: ACTOR, auditId: "logs" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── bulk ─────────────────────────────────────────────────────────────────────
describe("bulk", () => {
  test("bulkDelete removes N, recalc, one audit; empty-guard returns 0/0 with no audit", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    for (const id of ["s1", "s2"]) {
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id, orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: `logc-${id}`,
      });
    }
    const empty = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkDeleteServicesNative, { ids: [], orgId: ORG, now: NOW, actor: ACTOR, auditId: "logempty" });
    expect(empty).toEqual({ deleted: 0, skipped: 0 });
    expect(await logById(t, "logempty")).toBeNull();
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkDeleteServicesNative, { ids: ["s1", "s2", "sMissing"], orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logbd" });
    expect(res).toEqual({ deleted: 2, skipped: 1 });
    expect(await svcById(t, "s1")).toBeNull();
    expect((await logById(t, "logbd"))?.summary).toBe("Deleted 2 services");
  });

  test("bulkUpdateStatus patches N + one audit; empty-guard no-op", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    for (const id of ["s1", "s2"]) {
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id, orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: `logc-${id}`,
      });
    }
    const empty = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkUpdateServiceStatusNative, { ids: [], orgId: ORG, status: "CONFIRMED", now: NOW, actor: ACTOR, auditId: "logempty" });
    expect(empty).toEqual({ updated: 0, skipped: 0 });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkUpdateServiceStatusNative, { ids: ["s1", "s2"], orgId: ORG, status: "CONFIRMED", now: NOW + 1, actor: ACTOR, auditId: "logbs" });
    expect(res).toEqual({ updated: 2, skipped: 0 });
    expect((await svcById(t, "s1"))?.status).toBe("CONFIRMED");
    expect((await logById(t, "logbs"))?.summary).toBe("Changed 2 services to CONFIRMED");
  });
});

// ─── generateServicesNative ───────────────────────────────────────────────────
describe("generateServicesNative", () => {
  // WS2 (#941): dates now derive from the PROJECT window (getProjectWindow), not
  // loadIn/loadOut/event*. DELIVERY/BUMP_IN sit at the window start, BUMP_OUT/
  // PICKUP at the window end, LABOUR spans the whole window (a 2-day window here
  // fans LABOUR out across both days).
  test("default-set generate is idempotent (dedup by type:date)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { projectStartDate: NOW, projectEndDate: NOW + DAY });
    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, { projectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logg" });
    expect(r1.created).toBe(6); // DELIVERY, BUMP_IN, BUMP_OUT, PICKUP, LABOUR(Show Day) x2 days
    const r2 = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, { projectId: "p1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logg2" });
    expect(r2.created).toBe(0); // dedup
    expect((await logById(t, "logg"))?.summary).toBe("Generated 6 services for P-p1");
  });

  test("falls back to the rental window when the project window is unset", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { rentalStartDate: NOW, rentalEndDate: NOW });
    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, { projectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logg" });
    expect(r1.created).toBe(5); // DELIVERY, BUMP_IN, BUMP_OUT, PICKUP, LABOUR(Show Day) — single day
  });

  test("no project or rental date → throws", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, { projectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logg" }),
    ).rejects.toThrow(/project or rental start date/i);
  });

  test("viewer denied", async () => {
    const t = makeT();
    await member(t, "viewer");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, { projectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logg" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });
});

// ─── cloneServicesNative ──────────────────────────────────────────────────────
describe("cloneServicesNative", () => {
  test("copies services + crew from source→target (status PLANNED)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { projectStartDate: NOW });
    await seedProject(t, "p2", ORG, { projectStartDate: NOW + DAY });
    await seedCrew(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 100, crew: [{ id: "a1", crewMemberId: "cm1" }], now: NOW, actor: ACTOR, auditId: "logc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, {
      targetProjectId: "p2", sourceProjectId: "p1", orgId: ORG, now: NOW + 5, actor: ACTOR, auditId: "logcl",
    });
    expect(res.cloned).toBe(1);
    const targetServices = await t.run(async (ctx) => (await ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p2")).collect()));
    expect(targetServices).toHaveLength(1);
    expect(targetServices[0].status).toBe("PLANNED");
    expect(targetServices[0].id).not.toBe("s1"); // fresh cuid
    // Crew cloned onto the new service.
    const clonedCrew = await asgsForService(t, targetServices[0].id);
    expect(clonedCrew).toHaveLength(1);
    expect(clonedCrew[0].crewMemberId).toBe("cm1");
    expect((await logById(t, "logcl"))?.summary).toBe("Cloned 1 services from P-p1 to P-p2");
  });

  // WS2 (#941) — the day-shift between source/target reads the PROJECT window
  // (getProjectWindow), not the deprecated loadInDate/eventStartDate fields.
  test("shifts cloned service dates by the source/target PROJECT window day-offset", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { projectStartDate: NOW });
    await seedProject(t, "p2", ORG, { projectStartDate: NOW + 3 * DAY });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, date: NOW, now: NOW, actor: ACTOR, auditId: "logc",
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, {
      targetProjectId: "p2", sourceProjectId: "p1", orgId: ORG, now: NOW + 5, actor: ACTOR, auditId: "logcl",
    });
    const targetServices = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p2")).collect());
    expect(targetServices).toHaveLength(1);
    expect(targetServices[0].date).toBe(NOW + 3 * DAY); // shifted by the 3-day window offset
  });

  test("cross-org source rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p2", ORG);
    await seedProject(t, "pSrc", OTHER);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, { targetProjectId: "p2", sourceProjectId: "pSrc", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcl" }),
    ).rejects.toThrow(/Project not found/i);
  });

  test("cross-org target rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG);
    await seedProject(t, "pT", OTHER);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, { targetProjectId: "pT", sourceProjectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcl" }),
    ).rejects.toThrow(/Project not found/i);
  });
});

// ─── convertLineItemToServiceNative ───────────────────────────────────────────
describe("convertLineItemToServiceNative", () => {
  test("inserts a linked service and does NOT recalc (parity)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t); // total: 999
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "SERVICE", description: "Rigging", quantity: 1, lineTotal: 50, isKitChild: false, status: "CONFIRMED" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.convertLineItemToServiceNative, {
      serviceId: "s1", lineItemId: "li1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcv",
    });
    expect(res.id).toBe("s1");
    const s = await svcById(t, "s1");
    expect(s?.lineItemId).toBe("li1");
    expect(s?.type).toBe("MISC"); // SERVICE → MISC
    expect(s?.title).toBe("Rigging");
    // ★ NO recalc — the stale seeded total is untouched (would be 55 if recalc ran).
    expect((await projById(t, "p1"))?.total).toBe(999);
    expect((await logById(t, "logcv"))?.summary).toBe('Converted line item "Rigging" to Misc service');
  });

  test("cross-org line item rejected", async () => {
    const t = makeT();
    await member(t, "member");
    await t.run(async (ctx) => { await ctx.db.insert("projectLineItems", { id: "li1", organizationId: OTHER, projectId: "pX", isKitChild: false }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.convertLineItemToServiceNative, { serviceId: "s1", lineItemId: "li1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcv" }),
    ).rejects.toThrow(/Line item not found/i);
  });
});

// ─── Service Template CRUD (orgSettings:update) ───────────────────────────────
describe("service template CRUD", () => {
  const tmpl = { type: "DELIVERY" as const, title: "Std Delivery", showOnDocuments: true, isAutoAdded: true, isActive: true };

  test("admin creates → replace → delete + audits (no projectId)", async () => {
    const t = makeT();
    await member(t, "admin");
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceTemplateNative, {
      id: "tp1", orgId: ORG, ...tmpl, defaultUnitPrice: 120, now: NOW, actor: ACTOR, auditId: "logtc",
    });
    let doc = await t.run(async (ctx) => ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", "tp1")).first());
    expect(doc?.defaultUnitPrice).toBe(120);
    expect(doc?.sortOrder).toBe(0);
    expect((await logById(t, "logtc"))?.summary).toBe('Created service template "Std Delivery"');
    expect((await logById(t, "logtc"))?.projectId).toBeUndefined();

    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceTemplateNative, {
      id: "tp1", orgId: ORG, ...tmpl, title: "Fast Delivery", now: NOW + 1, actor: ACTOR, auditId: "logtu",
    });
    doc = await t.run(async (ctx) => ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", "tp1")).first());
    expect(doc?.title).toBe("Fast Delivery");
    expect(doc?.defaultUnitPrice).toBeUndefined(); // replace cleared the optional field

    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.deleteServiceTemplateNative, { id: "tp1", orgId: ORG, now: NOW + 2, actor: ACTOR, auditId: "logtd" });
    expect(await t.run(async (ctx) => ctx.db.query("serviceTemplates").withIndex("by_cuid", (q) => q.eq("id", "tp1")).first())).toBeNull();
  });

  test("member (no orgSettings:update) denied", async () => {
    const t = makeT();
    await member(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceTemplateNative, { id: "tp1", orgId: ORG, ...tmpl, now: NOW, actor: ACTOR, auditId: "logtc" }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("cross-org template update rejected", async () => {
    const t = makeT();
    await member(t, "admin");
    await t.run(async (ctx) => { await ctx.db.insert("serviceTemplates", { id: "tp1", organizationId: OTHER, type: "DELIVERY", title: "Theirs", showOnDocuments: false, isAutoAdded: false, isActive: true, sortOrder: 0 }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.updateServiceTemplateNative, { id: "tp1", orgId: ORG, ...tmpl, now: NOW, actor: ACTOR, auditId: "logtu" }),
    ).rejects.toThrow(/Template not found/i);
  });
});

// ─── #988 (Phase C) — the previously-deferred bulk/generate/clone/convert gate
// sites (FEATUREDOCS/62 "Deliberately deferred") are structural (add/remove/
// convert services, not a money-field edit), so per #1230 they are never
// gated regardless of projects.pricingLocked. generateServicesNative /
// cloneServicesNative are the exception that still touches money on insert:
// per the truth table, a locked project still allows new structural adds,
// but a new/copied line defaults its price to $0 (pricedUnderLock). ────────
describe("#988 previously-deferred gate sites", () => {
  test("bulkDeleteServicesNative succeeds on ON_SITE — structural, never gated (#1230)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { status: "ON_SITE" });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "logc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkDeleteServicesNative, {
      ids: ["s1"], orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logbd",
    });
    expect(res.deleted).toBe(1);
  });

  test("bulkUpdateServiceStatusNative succeeds on ON_SITE — structural, never gated (#1230)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { status: "ON_SITE" });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "logc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.bulkUpdateServiceStatusNative, {
      ids: ["s1"], orgId: ORG, status: "CONFIRMED", now: NOW + 1, actor: ACTOR, auditId: "logbs",
    });
    expect(res.updated).toBe(1);
  });

  test("generateServicesNative succeeds on ON_SITE — structural, never gated (#1230)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { status: "ON_SITE", projectStartDate: NOW, projectEndDate: NOW });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, {
      projectId: "p1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logg",
    });
  });

  test("generateServicesNative $0-defaults new services when the project is pricingLocked", async () => {
    const t = makeT();
    await member(t, "admin"); // orgSettings:update (template create) + project:update
    await seedProject(t, "p1", ORG, { status: "CONFIRMED", projectStartDate: NOW, projectEndDate: NOW, pricingLocked: true });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceTemplateNative, {
      id: "tp1", orgId: ORG, type: "DELIVERY", title: "Std Delivery", showOnDocuments: true, isAutoAdded: true, isActive: true, defaultUnitPrice: 150, now: NOW, actor: ACTOR, auditId: "logtc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, {
      projectId: "p1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logg",
    });
    expect(res.created).toBe(1);
    const svcs = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p1")).collect());
    expect(svcs[0].unitPrice).toBeUndefined(); // template's defaultUnitPrice was zeroed, not copied
  });

  test("cloneServicesNative succeeds on an ON_SITE target — structural, never gated (#1230)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { projectStartDate: NOW });
    await seedProject(t, "p2", ORG, { status: "ON_SITE", projectStartDate: NOW });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "logc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, {
      targetProjectId: "p2", sourceProjectId: "p1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logcl",
    });
    expect(res.cloned).toBe(1);
  });

  test("cloneServicesNative $0-defaults copied pricing when the target is pricingLocked", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { projectStartDate: NOW });
    await seedProject(t, "p2", ORG, { status: "CONFIRMED", projectStartDate: NOW, pricingLocked: true });
    await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
      id: "s1", orgId: ORG, projectId: "p1", ...baseInput, unitPrice: 250, now: NOW, actor: ACTOR, auditId: "logc",
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.cloneServicesNative, {
      targetProjectId: "p2", sourceProjectId: "p1", orgId: ORG, now: NOW + 1, actor: ACTOR, auditId: "logcl",
    });
    expect(res.cloned).toBe(1);
    const targetServices = await t.run(async (ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p2")).collect());
    expect(targetServices[0].unitPrice).toBeUndefined();
  });

  test("convertLineItemToServiceNative succeeds on ON_SITE — structural, never gated (#1230)", async () => {
    const t = makeT();
    await member(t, "member");
    await seedProject(t, "p1", ORG, { status: "ON_SITE" });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "SERVICE", description: "Rigging", quantity: 1, lineTotal: 50, isKitChild: false, status: "CONFIRMED" });
    });
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.convertLineItemToServiceNative, {
      serviceId: "s1", lineItemId: "li1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcv",
    });
    expect(res.id).toBe("s1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #1221 follow-up (closes Phase 5's Equipment write-side gap, extended to
// Labour) — createServiceNative/generateServicesNative now take an optional
// `versionId`; convertLineItemToServiceNative always inherits the SOURCE
// line's own version (never re-derives "live") — see projectServicesWrites.ts.
// ─────────────────────────────────────────────────────────────────────────────
describe("projectServicesWrites — #1221 versionId follow-up", () => {
  async function seedSecondVersion(t: T, id = "p1", orgId = ORG) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: `v-${id}-b`, organizationId: orgId, projectId: id, number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
    });
  }

  describe("createServiceNative", () => {
    test("defaults to the live version when versionId is absent", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t);
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, now: NOW, actor: ACTOR, auditId: "log1",
      });
      const s = await svcById(t, "s1");
      expect(s?.versionId).toBe("v-p1");
    });

    test("targets the named non-live version, sortOrder scoped to it", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t);
      await seedSecondVersion(t);
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s1", orgId: ORG, projectId: "p1", ...baseInput, versionId: "v-p1-b", now: NOW, actor: ACTOR, auditId: "log1",
      });
      const s = await svcById(t, "s1");
      expect(s?.versionId).toBe("v-p1-b");
      expect(s?.sortOrder).toBe(0);
    });

    test("rejects a versionId belonging to another org (cross-tenant)", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t);
      await seedProject(t, "pX", OTHER);
      await expect(
        t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
          id: "s1", orgId: ORG, projectId: "p1", ...baseInput, versionId: "v-pX", now: NOW, actor: ACTOR, auditId: "log1",
        }),
      ).rejects.toThrow();
    });

    test("rejects a versionId belonging to a different project in the SAME org (cross-project)", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t);
      await seedProject(t, "p2", ORG);
      await expect(
        t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
          id: "s1", orgId: ORG, projectId: "p1", ...baseInput, versionId: "v-p2", now: NOW, actor: ACTOR, auditId: "log1",
        }),
      ).rejects.toThrow();
    });

    test("lock interaction: live + locked defaults costTotal to $0; non-live + locked keeps the real cost", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t, "p1", ORG, { pricingLocked: true });
      await seedSecondVersion(t);

      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s-live", orgId: ORG, projectId: "p1", ...baseInput, costTotal: 200, now: NOW, actor: ACTOR, auditId: "log1",
      });
      expect((await svcById(t, "s-live"))?.costTotal).toBe(0);

      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.createServiceNative, {
        id: "s-nonlive", orgId: ORG, projectId: "p1", ...baseInput, costTotal: 200, versionId: "v-p1-b", now: NOW, actor: ACTOR, auditId: "log2",
      });
      expect((await svcById(t, "s-nonlive"))?.costTotal).toBe(200);
    });
  });

  describe("generateServicesNative", () => {
    test("targets the named non-live version", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t, "p1", ORG, { projectStartDate: NOW, projectEndDate: NOW });
      await seedSecondVersion(t);
      const res = await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, {
        projectId: "p1", orgId: ORG, versionId: "v-p1-b", now: NOW, actor: ACTOR, auditId: "logg",
      });
      expect(res.created).toBeGreaterThan(0);
      const rows = await t.run((ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p1-b")).collect());
      expect(rows.length).toBe(res.created);
      const liveRows = await t.run((ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p1")).collect());
      expect(liveRows).toHaveLength(0);
    });

    test("lock interaction: non-live target is never gated even while live is locked", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t, "p1", ORG, { projectStartDate: NOW, projectEndDate: NOW, pricingLocked: true });
      await seedSecondVersion(t);
      // Seed a template with a real unit price so we can observe whether it's zeroed.
      await t.run(async (ctx) => {
        await ctx.db.insert("serviceTemplates", { id: "tpl1", organizationId: ORG, type: "MISC", title: "Rig", isActive: true, defaultUnitPrice: 75, showOnDocuments: true, isAutoAdded: true, sortOrder: 0 });
      });
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.generateServicesNative, {
        projectId: "p1", orgId: ORG, versionId: "v-p1-b", now: NOW, actor: ACTOR, auditId: "logg",
      });
      const rows = await t.run((ctx) => ctx.db.query("projectServices").withIndex("by_versionId", (q) => q.eq("versionId", "v-p1-b")).collect());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.unitPrice === 75)).toBe(true); // NOT zeroed
    });
  });

  describe("convertLineItemToServiceNative", () => {
    test("inherits the SOURCE line's own non-live version, never live", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t);
      await seedSecondVersion(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projectLineItems", {
          id: "li1", organizationId: ORG, projectId: "p1", versionId: "v-p1-b", lineageId: "li1",
          type: "SERVICE", description: "Rigging", quantity: 1, lineTotal: 50, isKitChild: false, status: "CONFIRMED",
        });
      });
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.convertLineItemToServiceNative, {
        serviceId: "s1", lineItemId: "li1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcv",
      });
      const s = await svcById(t, "s1");
      expect(s?.versionId).toBe("v-p1-b");
    });

    test("lock interaction: converting a line on a non-live version is never gated even while live is locked", async () => {
      const t = makeT();
      await member(t, "member");
      await seedProject(t, "p1", ORG, { pricingLocked: true });
      await seedSecondVersion(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("projectLineItems", {
          id: "li1", organizationId: ORG, projectId: "p1", versionId: "v-p1-b", lineageId: "li1",
          type: "SERVICE", description: "Rigging", quantity: 1, unitPrice: 50, lineTotal: 50, isKitChild: false, status: "CONFIRMED",
        });
      });
      await t.withIdentity(asUser(ORG)).mutation(api.projectServicesWrites.convertLineItemToServiceNative, {
        serviceId: "s1", lineItemId: "li1", orgId: ORG, now: NOW, actor: ACTOR, auditId: "logcv",
      });
      const s = await svcById(t, "s1");
      expect(s?.unitPrice).toBe(50); // kept — the source line lives on a non-live version
    });
  });
});
