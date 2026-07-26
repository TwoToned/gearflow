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

async function seedProject(t: ReturnType<typeof convexTest>, role?: string, isTemplate = false, status = "CONFIRMED") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status, isTemplate, createdAt: NOW, updatedAt: NOW });
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

  // The `project.status_changed` webhook was folded from the server tail into the
  // mutation, gated behind the optional `emitSideEffects` signal (expand-contract).
  async function seedStatusWebhook(t: ReturnType<typeof makeT>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("webhooks", { id: "wh1", organizationId: ORG, description: "Zapier", url: "https://example.test/hook", events: JSON.stringify(["project.status_changed"]), secret: "s", isActive: true, createdById: USER, createdAt: NOW, updatedAt: NOW });
    });
  }
  const deliveries = (t: ReturnType<typeof makeT>) =>
    t.run(async (ctx) => ctx.db.query("webhookDeliveries").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect());

  test("webhook: project.status_changed enqueued to an active subscription on a real change (emitSideEffects:true)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await seedStatusWebhook(t);
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, { ...args, emitSideEffects: true });
    const rows = await deliveries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("project.status_changed");
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].nextAttemptAt).toBe(NOW);
    const payload = JSON.parse(rows[0].payload);
    expect(payload).toEqual({ projectId: "p1", projectNumber: "P1", name: "Gig", from: "CONFIRMED", to: "PREPPING" });
  });

  test("webhook: NOT enqueued when the status is unchanged (from === to)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await seedStatusWebhook(t);
    // Seed status is CONFIRMED — re-asserting it is a no-op change, so no webhook.
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, { ...args, status: "CONFIRMED" as const, emitSideEffects: true });
    expect(await deliveries(t)).toHaveLength(0);
  });

  test("webhook: NOT enqueued when emitSideEffects is omitted (old-image single-emit parity)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await seedStatusWebhook(t);
    // No emitSideEffects signal (the pre-fold app image): the mutation must NOT emit —
    // the old image's ungated server tail single-emits instead.
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateStatusNative, args);
    expect(await deliveries(t)).toHaveLength(0);
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

  // R-8.6.2 — projectSchema bounds crewNotes/internalNotes/clientNotes to 5000 chars;
  // a direct-mutation caller (bypassing projectSchema.parse() in the browser hook) must
  // still hit the same bound server-side.
  test("rejects a notes value over the 5000-char bound", async () => {
    const t = makeT();
    await seedProject(t);
    await expect(
      t.withIdentity(SERVICE).mutation(api.projectWrites.updateNotesNative, {
        id: "p1", orgId: ORG, field: "internalNotes", notes: "x".repeat(5001), actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/internalNotes/);
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
    // OPEN tier (#957) — this test is about the general patch + audit shape, not
    // the finance lock, so taxRate stays editable without an unlock session.
    await seedProject(t, "member", false, "QUOTED");
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
  test("rejects an out-of-bounds money field a browser caller bypassing Zod could forge", async () => {
    const t = makeT();
    // OPEN tier (#957) — this test is specifically about the money-field BOUNDS
    // check (assertProjectMoneyFields), not the finance lock; a locked project
    // would reject the write with FINANCIALS_LOCKED before ever reaching it.
    await seedProject(t, "member", false, "QUOTED");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { taxRate: 150, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/tax rate/i);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { discountPercent: Number.NaN, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/discount percent/i);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { depositPaid: -50, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/deposit paid/i);
  });
  test("rejects a cross-org clientId (IDOR guard — a forged clientId must not leak another org's client record)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "foreign-client", organizationId: "other_org", name: "Foreign Co", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { clientId: "foreign-client", updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/not found in your organization/i);
  });
  test("accepts a same-org clientId", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "own-client", organizationId: ORG, name: "Own Co", createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { clientId: "own-client", updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.clientId).toBe("own-client");
    });
  });
  test("rejects an out-of-bounds defaultRentalQuantity / non-finite rental dates (poisons auto-pricing / defeats double-booking)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { defaultRentalQuantity: Number.NaN, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/default rental quantity/i);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { rentalStartDate: Number.NaN, updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/rentalStartDate/);
  });

  // R-8.6.2 — projectSchema string-length/format bounds, mirrored server-side via
  // assertProjectFields for a direct-mutation caller that bypasses the client Zod parse.
  test("rejects a name over the 200-char bound", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { name: "x".repeat(201), updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/name/);
  });
  test("rejects an empty name (min 1)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { name: "", updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/name/);
  });
  test("rejects a projectNumber over the 50-char bound", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { projectNumber: "P-".padEnd(51, "9"), updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/projectNumber/);
  });
  test("rejects a description over the 2000-char bound", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { description: "x".repeat(2001), updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/description/);
  });
  test("rejects a malformed siteContactEmail", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { siteContactEmail: "not-an-email", updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/email/i);
  });
  test("accepts a well-formed siteContactEmail and an empty string (no-contact escape hatch)", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { siteContactEmail: "crew@example.com", updatedAt: NOW }, clear: [] });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      expect(p?.siteContactEmail).toBe("crew@example.com");
    });
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { siteContactEmail: "", updatedAt: NOW }, clear: [] });
  });
  test("rejects crewNotes/internalNotes/clientNotes over the 5000-char bound", async () => {
    const t = makeT();
    await seedProject(t, "member");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.updateNative, { ...uargs, set: { crewNotes: "x".repeat(5001), updatedAt: NOW }, clear: [] }),
    ).rejects.toThrow(/crewNotes/);
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
  test("rejects an out-of-bounds money field on create", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, invoicedTotal: -1 } as typeof cargs),
    ).rejects.toThrow(/invoiced total/i);
  });
  // R-8.6.2 — same string bounds as updateNative, enforced on create too.
  test("rejects a name over the 200-char bound on create", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, name: "x".repeat(201) }),
    ).rejects.toThrow(/name/);
  });
  test("rejects a projectNumber over the 50-char bound on create", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, projectNumber: "x".repeat(51) }),
    ).rejects.toThrow(/projectNumber/);
  });
  test("rejects a cross-org clientId on create (IDOR guard)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
      await ctx.db.insert("clients", { id: "foreign-client", organizationId: "other_org", name: "Foreign Co", createdAt: NOW, updatedAt: NOW });
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, clientId: "foreign-client" } as typeof cargs),
    ).rejects.toThrow(/not found in your organization/i);
  });

  // QW-4 (#953) — discount cascade: a new project with a client and no explicit
  // discountPercent snapshots the client's defaultDiscount at create time.
  describe("discount cascade (client.defaultDiscount)", () => {
    async function seedClient(t: ReturnType<typeof convexTest>, id: string, defaultDiscount?: number) {
      await t.run(async (ctx) => {
        await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
        await ctx.db.insert("clients", { id, organizationId: ORG, name: "Acme Co", defaultDiscount, createdAt: NOW, updatedAt: NOW });
      });
    }

    test("default applied: no discountPercent supplied → stamps the client's defaultDiscount", async () => {
      const t = makeT();
      await seedClient(t, "c1", 15);
      await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, clientId: "c1" } as typeof cargs);
      const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first());
      expect(p?.discountPercent).toBe(15);
    });

    test("explicit value wins: caller's discountPercent overrides the client default", async () => {
      const t = makeT();
      await seedClient(t, "c1", 15);
      await t.withIdentity(asUser(ORG)).mutation(
        api.projectWrites.createNative,
        { ...cargs, clientId: "c1", discountPercent: 5 } as typeof cargs,
      );
      const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first());
      expect(p?.discountPercent).toBe(5);
    });

    test("explicit 0 wins: an explicit 0% discount is NOT overwritten by the client default (no truthiness bug)", async () => {
      const t = makeT();
      await seedClient(t, "c1", 15);
      await t.withIdentity(asUser(ORG)).mutation(
        api.projectWrites.createNative,
        { ...cargs, clientId: "c1", discountPercent: 0 } as typeof cargs,
      );
      const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first());
      expect(p?.discountPercent).toBe(0);
    });

    test("no client → no default applied (discountPercent stays unset)", async () => {
      const t = makeT();
      await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
      await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, cargs);
      const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first());
      expect(p?.discountPercent).toBeUndefined();
    });

    test("client with no defaultDiscount set → discountPercent stays unset", async () => {
      const t = makeT();
      await seedClient(t, "c1", undefined);
      await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, { ...cargs, clientId: "c1" } as typeof cargs);
      const p = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "np1")).first());
      expect(p?.discountPercent).toBeUndefined();
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

describe("projectWrites.createNative auto-number", () => {
  // "%YY%MM%INC" + parts {2026-07-15} + padding 2 → "260701", "260702", … ;
  // MONTHLY reset → scopeKey "2026-07".
  const autoArgs = (id: string, auditId: string) => ({
    id,
    organizationId: ORG,
    name: "Auto Gig",
    isTemplate: false,
    createdAt: NOW,
    updatedAt: NOW,
    autoNumber: { format: "%YY%MM%INC", reset: "MONTHLY" as const, padding: 2, parts: { year: 2026, month: 7, day: 15 } },
    actor: ACTOR,
    auditId,
  });

  test("renders the format + increments the sequence across creates", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    expect(await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, autoArgs("a1", "log1"))).toEqual({ created: true, id: "a1" });
    expect(await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, autoArgs("a2", "log2"))).toEqual({ created: true, id: "a2" });
    await t.run(async (ctx) => {
      const p1 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      const p2 = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "a2")).first();
      expect(p1?.projectNumber).toBe("260701");
      expect(p2?.projectNumber).toBe("260702");
      const seq = await ctx.db
        .query("projectNumberSequences")
        .withIndex("by_organizationId_scopeKey", (q) => q.eq("organizationId", ORG).eq("scopeKey", "2026-07"))
        .unique();
      expect(seq?.value).toBe(2);
    });
  });

  test("skips a rendered code that's already taken (clash retry advances the counter)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" });
      // 260701 already exists (e.g. entered manually) — the auto loop must skip past it.
      await ctx.db.insert("projects", { id: "taken", organizationId: ORG, projectNumber: "260701", name: "Taken", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    expect(await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, autoArgs("a1", "log1"))).toEqual({ created: true, id: "a1" });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "a1")).first();
      expect(p?.projectNumber).toBe("260702"); // skipped the taken 260701
    });
  });

  test("throws when neither projectNumber nor autoNumber is supplied", async () => {
    const t = makeT();
    await t.run(async (ctx) => { await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "member" }); });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.createNative, {
        id: "a1", organizationId: ORG, name: "X", isTemplate: false, createdAt: NOW, updatedAt: NOW, actor: ACTOR, auditId: "log1",
      }),
    ).rejects.toThrow(/projectNumber or autoNumber/i);
  });
});

describe("projectWrites.duplicateNative", () => {
  const dupArgs = { sourceId: "src", newId: "dup1", newProjectNumber: "P-DUP", newName: "Copy", orgId: ORG, orgDefaultTaxRate: 10 as number | null, now: NOW, actor: ACTOR, auditId: "dlog1" };

  // Source project loaded with grouping + line items + PMs (must copy) PLUS
  // services/tasks/crew/slots (must NOT copy).
  async function seedSource(t: ReturnType<typeof convexTest>, role = "owner") {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
      await ctx.db.insert("projects", { id: "src", organizationId: ORG, projectNumber: "SRC-1", name: "Original", status: "CONFIRMED", type: "DRY_HIRE", isTemplate: false, taxRate: 5, discountPercent: 0, tags: ["a"], createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "src", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "grp1", organizationId: ORG, projectId: "src", categoryId: "cat1", title: "Stage", quantity: 1, price: 100, sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      // Grouped parent + kit child.
      await ctx.db.insert("projectLineItems", { id: "lp1", organizationId: ORG, projectId: "src", categoryId: "cat1", groupId: "grp1", type: "EQUIPMENT", quantity: 1, unitPrice: 50, lineTotal: 50, isKitChild: false, status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lc1", organizationId: ORG, projectId: "src", type: "EQUIPMENT", quantity: 1, isKitChild: true, parentLineItemId: "lp1", childKind: "KIT", status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      // Ungrouped standalone line (bills its own lineTotal).
      await ctx.db.insert("projectLineItems", { id: "lp2", organizationId: ORG, projectId: "src", type: "EQUIPMENT", quantity: 1, unitPrice: 30, lineTotal: 30, isKitChild: false, status: "CONFIRMED", sortOrder: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "src", userId: USER, addedAt: NOW });
      // NOT copied:
      await ctx.db.insert("projectServices", { id: "svc1", organizationId: ORG, projectId: "src", type: "LABOUR", title: "Labour", costTotal: 20, lineTotal: 40, showOnDocuments: true, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectTasks", { id: "task1", organizationId: ORG, projectId: "src", title: "Load in", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("crewAssignments", { id: "ca1", organizationId: ORG, projectId: "src", crewMemberId: "cm1", status: "CONFIRMED", estimatedCost: 200, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("categorySlots", { id: "slot1", projectCategoryId: "cat1", sortOrder: 0 });
    });
  }

  test("deep-copies categories/groups/lines (remapped ids, children under new parents) + PMs + recalc; NOT services/tasks/crew/slots", async () => {
    const t = makeT();
    await seedSource(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, dupArgs);
    expect(res).toEqual({ id: "dup1" });

    await t.run(async (ctx) => {
      const proj = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "dup1")).first();
      expect(proj?.status).toBe("ENQUIRY");
      expect(proj?.isTemplate).toBe(false);
      expect(proj?.projectNumber).toBe("P-DUP");
      expect(proj?.name).toBe("Copy");
      expect(proj?.taxRate).toBe(5); // scalar copied

      // Categories — new id, same name.
      const cats = (await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect());
      expect(cats.length).toBe(1);
      expect(cats[0].id).not.toBe("cat1");
      expect(cats[0].name).toBe("Audio");
      const newCatId = cats[0].id;

      // Groups — new id, categoryId remapped to the NEW category.
      const groups = (await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect());
      expect(groups.length).toBe(1);
      expect(groups[0].id).not.toBe("grp1");
      expect(groups[0].categoryId).toBe(newCatId);
      const newGroupId = groups[0].id;

      // Line items — parents + children, remapped, status QUOTED.
      const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect());
      expect(lines.length).toBe(3);
      const parents = lines.filter((l) => !l.isKitChild);
      const children = lines.filter((l) => l.isKitChild);
      expect(parents.length).toBe(2);
      expect(children.length).toBe(1);
      for (const l of lines) expect(l.status).toBe("QUOTED");
      // Grouped parent: remapped category/group.
      const gp = parents.find((l) => l.groupId != null)!;
      expect(gp.categoryId).toBe(newCatId);
      expect(gp.groupId).toBe(newGroupId);
      expect(gp.id).not.toBe("lp1");
      // Child hangs off the NEW parent + inherits its category/group.
      expect(children[0].parentLineItemId).toBe(gp.id);
      expect(children[0].categoryId).toBe(newCatId);
      expect(children[0].groupId).toBe(newGroupId);
      expect(children[0].childKind).toBe("KIT");

      // PMs copied (new id).
      const pms = (await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect());
      expect(pms.length).toBe(1);
      expect(pms[0].id).not.toBe("pm1");
      expect(pms[0].userId).toBe(USER);

      // NOT copied.
      expect((await ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect()).length).toBe(0);
      expect((await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect()).length).toBe(0);
      expect((await ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", "dup1")).collect()).length).toBe(0);

      // Recalc ran: equipmentRevenue = grouped bundle (100) + standalone (30) = 130.
      expect(proj?.equipmentRevenue).toBe(130);
      // Services NOT copied → no service revenue in the copy's totals.
      expect(proj?.serviceCostTotal).toBe(0);
    });
  });

  test("rejects a cross-org source (NOT_FOUND)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("projects", { id: "src", organizationId: "other_org", projectNumber: "SRC-1", name: "Foreign", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, dupArgs)).rejects.toThrow(/not found/i);
  });

  test("rejects a project-number clash (DUPLICATE_PROJECT_CODE)", async () => {
    const t = makeT();
    await seedSource(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "taken", organizationId: ORG, projectNumber: "P-DUP", name: "Taken", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, dupArgs)).rejects.toThrow(/already exists/i);
  });

  test("a viewer is denied (project:create)", async () => {
    const t = makeT();
    await seedSource(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, dupArgs)).rejects.toThrow(/insufficient permissions/i);
  });
  test("ignores a client-forged orgDefaultTaxRate — resolves from orgSettings in-mutation", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "owner" });
      // Source project has NO taxRate of its own, so the copy falls back to the org default.
      await ctx.db.insert("projects", { id: "src", organizationId: ORG, projectNumber: "SRC-1", name: "Original", status: "CONFIRMED", isTemplate: false, tags: [], createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lp1", organizationId: ORG, projectId: "src", type: "EQUIPMENT", quantity: 1, unitPrice: 100, lineTotal: 100, isKitChild: false, status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("orgSettings", { organizationId: ORG, defaultTaxRate: 7 });
    });
    // A malicious/stale client sends 99 — must be ignored in favor of the orgSettings row (7).
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, { ...dupArgs, orgDefaultTaxRate: 99 });
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "dup1")).first();
      expect(p?.taxRate).toBeUndefined(); // no scalar copied (source had none)
      expect(p?.taxAmount).toBe(7); // 100 * 7% — NOT 100 * 99%
    });
  });

  // R-8.6.2 — duplicate()'s hook (use-native-project-writes.ts) never runs
  // newName/newProjectNumber through projectSchema.parse() at all (unlike create()/
  // update()), so assertProjectFields is the ONLY bound check either ever gets.
  test("rejects an oversized newName", async () => {
    const t = makeT();
    await seedSource(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, { ...dupArgs, newName: "x".repeat(201) }),
    ).rejects.toThrow(/name/);
  });
  test("rejects an oversized newProjectNumber", async () => {
    const t = makeT();
    await seedSource(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.duplicateNative, { ...dupArgs, newProjectNumber: "x".repeat(51) }),
    ).rejects.toThrow(/projectNumber/);
  });
});

describe("projectWrites.saveAsTemplateNative", () => {
  const tplArgs = { sourceId: "src", newId: "tpl1", templateNumber: "TPL-0001", templateName: "My Template", orgId: ORG, orgDefaultTaxRate: 10 as number | null, now: NOW, actor: ACTOR };

  async function seedSource(t: ReturnType<typeof convexTest>, role = "owner") {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role });
      await ctx.db.insert("projects", { id: "src", organizationId: ORG, projectNumber: "SRC-1", name: "Original", status: "CONFIRMED", type: "DRY_HIRE", isTemplate: false, tags: [], createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "src", name: "Audio", sortOrder: 0 });
      await ctx.db.insert("projectGroups", { id: "grp1", organizationId: ORG, projectId: "src", categoryId: "cat1", title: "Stage", quantity: 1, price: 0, sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      // A grouped parent + child — the template must copy the LINES but drop category/group.
      await ctx.db.insert("projectLineItems", { id: "lp1", organizationId: ORG, projectId: "src", categoryId: "cat1", groupId: "grp1", type: "EQUIPMENT", quantity: 1, unitPrice: 40, lineTotal: 40, isKitChild: false, status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "lc1", organizationId: ORG, projectId: "src", type: "EQUIPMENT", quantity: 1, isKitChild: true, parentLineItemId: "lp1", status: "CONFIRMED", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "src", userId: USER, addedAt: NOW });
    });
  }

  test("creates a template + copies lines WITHOUT category/group; no categories/groups/PMs; recalc", async () => {
    const t = makeT();
    await seedSource(t);
    const res = await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, tplArgs);
    expect(res).toEqual({ id: "tpl1" });

    await t.run(async (ctx) => {
      const tpl = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "tpl1")).first();
      expect(tpl?.isTemplate).toBe(true);
      expect(tpl?.status).toBe("ENQUIRY");
      expect(tpl?.projectNumber).toBe("TPL-0001");

      // Lines copied — parent + child — but category/group OMITTED.
      const lines = (await ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "tpl1")).collect());
      expect(lines.length).toBe(2);
      for (const l of lines) {
        expect(l.status).toBe("QUOTED");
        expect(l.categoryId).toBeUndefined();
        expect(l.groupId).toBeUndefined();
      }
      const child = lines.find((l) => l.isKitChild)!;
      const parent = lines.find((l) => !l.isKitChild)!;
      expect(child.parentLineItemId).toBe(parent.id);

      // No categories / groups / PMs copied.
      expect((await ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", "tpl1")).collect()).length).toBe(0);
      expect((await ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", "tpl1")).collect()).length).toBe(0);
      expect((await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", "tpl1")).collect()).length).toBe(0);

      // Recalc ran: no groups on the copy → equipmentRevenue = the ungrouped parent's
      // lineTotal (40).
      expect(tpl?.equipmentRevenue).toBe(40);
    });
  });

  test("rejects a template-number clash", async () => {
    const t = makeT();
    await seedSource(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "taken", organizationId: ORG, projectNumber: "TPL-0001", name: "Taken", isTemplate: true, createdAt: NOW, updatedAt: NOW });
    });
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, tplArgs)).rejects.toThrow(/already exists/i);
  });

  test("ignores a client-forged orgDefaultTaxRate — resolves from orgSettings in-mutation", async () => {
    const t = makeT();
    await seedSource(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", { organizationId: ORG, defaultTaxRate: 7 });
    });
    // A malicious/stale client sends 99 — must be ignored in favor of the orgSettings row (7).
    await t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, { ...tplArgs, orgDefaultTaxRate: 99 });
    await t.run(async (ctx) => {
      const tpl = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "tpl1")).first();
      expect(tpl?.taxAmount).toBe(2.8); // 40 (equipmentRevenue) * 7% — NOT * 99%
    });
  });

  test("a viewer is denied (project:create)", async () => {
    const t = makeT();
    await seedSource(t, "viewer");
    await expect(t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, tplArgs)).rejects.toThrow(/insufficient permissions/i);
  });

  // R-8.6.2 — same "never Zod-parsed client-side" gap as duplicateNative.
  test("rejects an oversized templateName", async () => {
    const t = makeT();
    await seedSource(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, { ...tplArgs, templateName: "x".repeat(201) }),
    ).rejects.toThrow(/name/);
  });
  test("rejects an oversized templateNumber", async () => {
    const t = makeT();
    await seedSource(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.projectWrites.saveAsTemplateNative, { ...tplArgs, templateNumber: "x".repeat(51) }),
    ).rejects.toThrow(/projectNumber/);
  });
});
