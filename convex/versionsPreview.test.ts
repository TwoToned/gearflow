// @vitest-environment node
// UX Phase 8 (§7b.4) — the counts-only Make-live preview, the Versions tab's
// row facts, the make-live Undo guard (`expectLiveVersionId`), and that a
// version copy carries a case's seal.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    for (const org of [ORG, OTHER]) {
      await ctx.db.insert("members", { id: `m_${org}`, organizationId: org, userId: USER, role: "owner" });
    }
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Gig", status: "QUOTING", isTemplate: false,
      liveVersionId: "v1", total: 0, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "li1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "li1",
      status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, description: "PA", quantity: 2, unitPrice: 100, lineTotal: 200, modelId: "mdl1",
    });
  });
}

const create = (t: T, auditId = "aCreate") =>
  t.withIdentity(asUser(ORG)).mutation(api.versions.createNative, { organizationId: ORG, projectId: "p1", actor, auditId, now: NOW });
const preview = (t: T, versionId: string, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).query(api.versionsPreview.makeLivePreview, { organizationId: orgId, projectId: "p1", versionId });

describe("versionsPreview.makeLivePreview", () => {
  test("counts what going live changes, and is null for the live version", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    // v2 drops nothing yet; raise a line's quantity on v2 and add a line.
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).first();
      if (li) await ctx.db.patch(li._id, { quantity: 3 });
      await ctx.db.insert("projectLineItems", {
        id: "li2", organizationId: ORG, projectId: "p1", versionId: v2.id, lineageId: "li2",
        status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, description: "Mic", quantity: 1, unitPrice: 50, lineTotal: 50, modelId: "mdl2",
      });
      // A physical unit on the live line, packed into a case.
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 1, containerId: "cX", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
      } as never);
    });

    expect(await preview(t, "v1")).toBeNull();
    const p = await preview(t, v2.id);
    expect(p).toMatchObject({
      incomingNumber: 2, outgoingNumber: 1,
      lines: { incoming: 2, outgoing: 1 },
      carriedLines: 1, packedUnits: 1, notOnIncoming: 0,
      modelsWithDemandChange: 2, // mdl1 2 -> 3, mdl2 0 -> 1
      truncated: false,
    });
    expect(typeof p?.total.before).toBe("number");
  });

  test("READ BUDGET BITES: a job with more units than the budget still returns, with truncated true and floor counts", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 430; i++) {
        await ctx.db.insert("projectLineItems", { id: `u${i}`, organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: `u${i}`, status: "CONFIRMED", type: "EQUIPMENT", quantity: 5 });
        for (let n = 1; n <= 5; n++) {
          await ctx.db.insert("projectLineItemUnits", { id: `u${i}-${n}`, organizationId: ORG, lineItemId: `u${i}`, ordinal: n, containerId: "cX", status: "CONFIRMED", createdAt: NOW, updatedAt: NOW } as never);
        }
      }
    });
    const p = await preview(t, v2.id);
    expect(p?.truncated).toBe(true);
    expect(p?.packedUnits).toBeLessThanOrEqual(2000);
    expect(p?.packedUnits).toBeGreaterThan(0);
  });

  test("a version of another job or org is NOT_FOUND; a foreign org cannot read at all", async () => {
    const t = makeT();
    await seed(t);
    await expect(preview(t, "nope")).rejects.toThrow(/not found/i);
    await expect(preview(t, "v1", OTHER)).rejects.toThrow();
  });
});

describe("versionsPreview.versionRowFacts", () => {
  test("line/planned counts, quote state and a derived diff vs the previous version", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "li2", organizationId: ORG, projectId: "p1", versionId: v2.id, lineageId: "li2", plannedContainerId: "c1",
        status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, description: "Mic", quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.versionsPreview.versionRowFacts, { organizationId: ORG, projectId: "p1" });
    expect(res.truncated).toBe(false);
    const r2 = res.rows.find((r) => r.versionId === v2.id);
    const r1 = res.rows.find((r) => r.versionId === "v1");
    expect(r2).toMatchObject({ lineCount: 2, plannedCount: 1, quoteStatus: null });
    expect(r2?.diff).toMatchObject({ vsNumber: 1, added: 1, removed: 0 });
    expect(r1?.diff).toBeNull();
  });

  test("with more versions than the cap it RETURNS facts for the newest few only and says truncated (never throws)", async () => {
    const t = makeT();
    await seed(t);
    const made = [] as { id: string; number: number }[];
    for (let i = 0; i < 6; i++) made.push(await create(t, `aCreate${i}`));
    const res = await t.withIdentity(asUser(ORG)).query(api.versionsPreview.versionRowFacts, { organizationId: ORG, projectId: "p1" });
    expect(res.truncated).toBe(true);
    expect(res.rows).toHaveLength(3);
    // The newest three, newest first: the older versions have no money facts at all.
    expect(res.rows.map((r) => r.versionId)).toEqual(made.slice(-3).reverse().map((m) => m.id));
    expect(res.rows.every((r) => typeof r.total === "number")).toBe(true);
  });

  test("READ BUDGETS BITE: more plannable lines than the cap leaves plannedCount null and truncated true (still returns)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 520; i++) {
        await ctx.db.insert("projectLineItems", { id: `b${i}`, organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: `b${i}`, status: "CONFIRMED", type: "EQUIPMENT", quantity: 1, lineTotal: 1 });
      }
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.versionsPreview.versionRowFacts, { organizationId: ORG, projectId: "p1" });
    expect(res.truncated).toBe(true);
    expect(res.rows[0]).toMatchObject({ versionId: "v1", lineCount: 521, plannedCount: null });
  });

  test("READ BUDGETS BITE: more units than the unit budget leaves plannedCount null and truncated true", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      // 430 lines x 5 loose units = 2150 units, past the 2000-unit budget; none is planned, so every line must read its units.
      for (let i = 0; i < 430; i++) {
        await ctx.db.insert("projectLineItems", { id: `u${i}`, organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: `u${i}`, status: "CONFIRMED", type: "EQUIPMENT", quantity: 5 });
        for (let n = 1; n <= 5; n++) {
          await ctx.db.insert("projectLineItemUnits", { id: `u${i}-${n}`, organizationId: ORG, lineItemId: `u${i}`, ordinal: n, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW } as never);
        }
      }
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.versionsPreview.versionRowFacts, { organizationId: ORG, projectId: "p1" });
    expect(res.truncated).toBe(true);
    expect(res.rows[0].plannedCount).toBeNull();
  });

  test("a foreign org sees nothing for another org's project", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser(OTHER)).query(api.versionsPreview.versionRowFacts, { organizationId: OTHER, projectId: "p1" });
    expect(res).toEqual({ rows: [], truncated: false });
  });
});

describe("makeLiveNative expectLiveVersionId (Undo guard)", () => {
  const makeLive = (t: T, versionId: string, expectLiveVersionId?: string) =>
    t.withIdentity(asUser(ORG)).mutation(api.versions.makeLiveNative, {
      organizationId: ORG, projectId: "p1", versionId, expectLiveVersionId, actor, auditId: `aLive-${versionId}-${expectLiveVersionId ?? "x"}`, now: NOW,
    });

  test("flips back only while the pointer is still where the caller expects; refuses once it moved", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    const v3 = await create(t, "aCreate3");
    await makeLive(t, v2.id);
    // Someone else makes v3 live; the Undo of the v2 make-live (flip back to v1) must refuse.
    await makeLive(t, v3.id);
    await expect(makeLive(t, "v1", v2.id)).rejects.toThrow(/live version changed/i);
    const project = await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(project?.liveVersionId).toBe(v3.id);
    // With the pointer where the caller expects, the Undo goes through.
    await expect(makeLive(t, "v1", v3.id)).resolves.toMatchObject({ liveVersionId: "v1", previousLiveVersionId: v3.id });
  });
});

describe("make-live Undo is guarded by the forward make-live's audit id (A→B→A gap)", () => {
  const ml = (t: T, versionId: string, auditId: string, undo?: { expect: string; of: string }) =>
    t.withIdentity(asUser(ORG)).mutation(api.versions.makeLiveNative, {
      organizationId: ORG, projectId: "p1", versionId, actor, auditId, now: NOW,
      expectLiveVersionId: undo?.expect, undoOfAuditId: undo?.of,
    });

  test("a stale Undo is refused even though the pointer is back where it expects; the NEWEST forward still undoes", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t);
    await ml(t, v2.id, "m1"); // v1 -> v2 (the make-live we will try to undo)
    await ml(t, "v1", "m2"); // someone flips back
    await ml(t, v2.id, "m3"); // and forward again: pointer is on v2 exactly as m1 left it
    await expect(ml(t, "v1", "u1", { expect: v2.id, of: "m1" })).rejects.toThrow(/live version changed/i);
    const live = async () => (await t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first()))?.liveVersionId;
    expect(await live()).toBe(v2.id);
    await expect(ml(t, "v1", "u2", { expect: v2.id, of: "m3" })).resolves.toMatchObject({ liveVersionId: "v1" });
    expect(await live()).toBe("v1");
  });
});

describe("versions.undoCreateNative (guarded Undo of Save as new version)", () => {
  const undo = (t: T, versionId: string, createAuditId: string, auditId = "aUndo") =>
    t.withIdentity(asUser(ORG)).mutation(api.versions.undoCreateNative, { organizationId: ORG, projectId: "p1", versionId, createAuditId, actor, auditId, now: NOW + 100 });
  const exists = (t: T, id: string) => t.run(async (ctx) => (await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", id)).first()) !== null);

  test("deletes an untouched copy and its rows", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t, "aC2");
    await undo(t, v2.id, "aC2");
    expect(await exists(t, v2.id)).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).collect());
    expect(rows).toHaveLength(0);
  });

  test("refuses (VERSION_CHANGED) once a row was edited or added; the copy is kept", async () => {
    const t = makeT();
    await seed(t);
    const edited = await create(t, "aC2");
    await t.run(async (ctx) => {
      const li = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", edited.id)).first();
      await ctx.db.patch(li!._id, { quantity: 9, updatedAt: NOW + 50 });
    });
    await expect(undo(t, edited.id, "aC2")).rejects.toThrow(/changed since it was saved/i);
    expect(await exists(t, edited.id)).toBe(true);

    const added = await create(t, "aC3");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "extra", organizationId: ORG, projectId: "p1", versionId: added.id, lineageId: "extra", status: "CONFIRMED", type: "EQUIPMENT", quantity: 1 });
    });
    await expect(undo(t, added.id, "aC3")).rejects.toThrow(/changed since/i);
  });

  test("refuses once the copy is live", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t, "aC2");
    await t.withIdentity(asUser(ORG)).mutation(api.versions.makeLiveNative, { organizationId: ORG, projectId: "p1", versionId: v2.id, actor, auditId: "mlx", now: NOW });
    await expect(undo(t, v2.id, "aC2")).rejects.toThrow(/live/i);
    expect(await exists(t, v2.id)).toBe(true);
  });

  test("another org, or an audit id that is not that create, is NOT_FOUND", async () => {
    const t = makeT();
    await seed(t);
    const v2 = await create(t, "aC2");
    await expect(undo(t, v2.id, "nope")).rejects.toThrow(/not found/i);
    await expect(
      t.withIdentity(asUser(OTHER)).mutation(api.versions.undoCreateNative, { organizationId: OTHER, projectId: "p1", versionId: v2.id, createAuditId: "aC2", actor, auditId: "x", now: NOW }),
    ).rejects.toThrow();
    expect(await exists(t, v2.id)).toBe(true);
  });
});

describe("version copy keeps a case's seal", () => {
  test("createNative clones sealedAt onto the new version's container", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectContainers", {
        id: "c1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "c1", kind: "CUSTOM", label: "Case 1",
        lineItemId: "cli1", sealedAt: NOW, createdAt: NOW, updatedAt: NOW,
      });
    });
    const v2 = await create(t);
    const copied = await t.run((ctx) => ctx.db.query("projectContainers").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).collect());
    expect(copied).toHaveLength(1);
    expect(copied[0].sealedAt).toBe(NOW);
  });
});
