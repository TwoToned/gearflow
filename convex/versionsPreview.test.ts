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
