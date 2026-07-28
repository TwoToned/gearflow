// @vitest-environment node
//
// PHASE 4 acceptance (#1000) — safety rails gating agent writes going wide:
// the unlock-session / emitSideEffects privileged-arg policies, `no_financials`
// field redaction (asserted across multiple distinct reads, not just one),
// `revertAgentWindow`, and a gate-parity spot-check (user token vs agent token
// produce the SAME rejection for the same scenario). The bulk-cap and
// justification/allowOverbook rows of the §6 table are covered in
// agentScopeRbac.test.ts / agentVertical.test.ts respectively — not repeated here.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const USER = "user_1";
const KEY = "key_1";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

async function seedKey(t: T, scopes: string[], opts: { noFinancials?: boolean } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("apiKeys", {
      id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
      noFinancials: opts.noFinancials,
    });
  });
}

async function seedMember(t: T, role: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// projectUnlockSessionsWrites.openNative — denied by default, scope-gated
// ────────────────────────────────────────────────────────────────────────────

describe("privileged capability — project:unlock_session (denied by default)", () => {
  async function seed(t: T, role = "owner") {
    await seedMember(t, role);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "COMPLETED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  const openArgs = {
    projectId: "p1", orgId: ORG, scope: "FULL" as const,
    justification: "Fixing a data-entry mistake after completion.",
    actor: ACTOR, auditId: "log1", now: NOW,
  };

  test("an agent key with no unlock_session scope is rejected, even holding project:update", async () => {
    const t = makeT();
    await seed(t);
    await seedKey(t, ["project:update"]);
    await expect(
      t.withIdentity(asAgent).mutation(api.projectUnlockSessionsWrites.openNative, openArgs),
    ).rejects.toThrow(/missing.*'project:unlock_session'/i);
  });

  test("an agent key WITH the explicit scope succeeds (the scope exists, it's just granted by no preset)", async () => {
    const t = makeT();
    await seed(t);
    await seedKey(t, ["project:update", "project:unlock_session"]);
    const res = await t.withIdentity(asAgent).mutation(api.projectUnlockSessionsWrites.openNative, openArgs);
    expect(res.sessionId).toBeTruthy();
  });

  test("a browser user (owner) is unaffected — the scope check is agent-only", async () => {
    const t = makeT();
    await seed(t);
    const res = await t.withIdentity(asUser).mutation(api.projectUnlockSessionsWrites.openNative, openArgs);
    expect(res.sessionId).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// emitSideEffects — dispatcher-forced true; Convex re-asserts for a direct call
// ────────────────────────────────────────────────────────────────────────────

describe("privileged arg — emitSideEffects (injected, never agent-controlled)", () => {
  async function seed(t: T) {
    await seedMember(t, "owner");
    await seedKey(t, ["*"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1,
        sortOrder: 0, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PENDING",
        isKitChild: false, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("an agent token sending emitSideEffects:false to Convex directly is rejected", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.removeNative, {
        id: "li1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW, emitSideEffects: false,
      }),
    ).rejects.toThrow(/may not suppress side effects/i);
  });

  test("a browser user sending emitSideEffects:false is unaffected (existing, intended behaviour)", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.removeNative, {
        id: "li1", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW, emitSideEffects: false,
      }),
    ).resolves.toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// no_financials — force-redacts cost/margin regardless of the acting user's role
// ────────────────────────────────────────────────────────────────────────────

describe("no_financials key flag — field-by-field, across multiple distinct reads", () => {
  async function seedCommon(t: T) {
    await seedMember(t, "owner"); // manager+ — would otherwise see everything
    await t.run(async (ctx) => {
      await ctx.db.insert("models", {
        id: "mdl1", organizationId: ORG, name: "PAR Can", createdAt: NOW, updatedAt: NOW,
        dailyRate: 25, replacementCost: 400, defaultPurchasePrice: 350,
      });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
        total: 1000, serviceCostTotal: 0, labourCostTotal: 0, subHireCostTotal: 0, saleCostTotal: 0, saleRevenue: 0,
      });
      await ctx.db.insert("crewMembers", {
        id: "cm1", organizationId: ORG, firstName: "Sam", lastName: "Crew",
        defaultDayRate: 300, defaultHourlyRate: 40,
      });
      await ctx.db.insert("crewRoles", { id: "role1", organizationId: ORG, name: "Rigger", defaultRate: 45 });
      await ctx.db.insert("crewAssignments", {
        id: "ca1", organizationId: ORG, projectId: "p1", crewMemberId: "cm1", crewRoleId: "role1",
        status: "CONFIRMED", estimatedCost: 360, rateOverride: 50,
      });
    });
  }

  test("models.list: sell rate visible, cost fields redacted for a noFinancials key", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true });
    const rows = await t.withIdentity(asAgent).query(api.models.list, { orgId: ORG });
    const m = rows.find((r) => r.id === "mdl1")!;
    expect(m.dailyRate).toBe(25); // sell price — an agent still needs this to operate
    expect(m.replacementCost).toBeUndefined();
    expect(m.defaultPurchasePrice).toBeUndefined();
  });

  test("models.list: a noFinancials:false (default) key on the SAME owner sees full cost", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"]); // no noFinancials flag at all
    const rows = await t.withIdentity(asAgent).query(api.models.list, { orgId: ORG });
    const m = rows.find((r) => r.id === "mdl1")!;
    expect(m.replacementCost).toBe(400);
    expect(m.defaultPurchasePrice).toBe(350);
  });

  test("models.getById and models.detail redact the same fields", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true });
    const byId = await t.withIdentity(asAgent).query(api.models.getById, { id: "mdl1" });
    expect(byId?.replacementCost).toBeUndefined();
    const detail = await t.withIdentity(asAgent).query(api.models.detail, { id: "mdl1" });
    expect(detail?.replacementCost).toBeUndefined();
    expect(detail?.defaultPurchasePrice).toBeUndefined();
  });

  test("crewAssignments.projectCrew redacts estimatedCost/rateOverride + nested rate fields", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true });
    const rows = await t.withIdentity(asAgent).query(api.crewAssignments.projectCrew, { projectId: "p1", orgId: ORG });
    const a = rows.find((r: { id: string }) => r.id === "ca1")! as unknown as Record<string, unknown>;
    expect(a.estimatedCost).toBeUndefined();
    expect(a.rateOverride).toBeUndefined();
    expect((a.crewMember as Record<string, unknown>).defaultDayRate).toBeUndefined();
    expect((a.crewRole as Record<string, unknown>).defaultRate).toBeUndefined();
  });

  test("crewAssignments.list / getById redact estimatedCost for a noFinancials key", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true });
    const rows = await t.withIdentity(asAgent).query(api.crewAssignments.list, { orgId: ORG });
    expect(rows.find((r) => r.id === "ca1")?.estimatedCost).toBeUndefined();
    const one = await t.withIdentity(asAgent).query(api.crewAssignments.getById, { id: "ca1" });
    expect(one?.estimatedCost).toBeUndefined();
  });

  test("projectCosts.operationalCosts is fully denied (no non-financial subset to redact)", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true });
    await expect(
      t.withIdentity(asAgent).query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/no_financials/i);
  });

  test("projectCosts.operationalCosts still works for the same key without the flag", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"]);
    await expect(
      t.withIdentity(asAgent).query(api.projectCosts.operationalCosts, { projectId: "p1", orgId: ORG }),
    ).resolves.toBeDefined();
  });

  test("a browser (non-key) user is entirely unaffected by another key's noFinancials flag", async () => {
    const t = makeT();
    await seedCommon(t);
    await seedKey(t, ["*"], { noFinancials: true }); // exists, but this call carries no akid
    const rows = await t.withIdentity(asUser).query(api.models.list, { orgId: ORG });
    expect(rows.find((r) => r.id === "mdl1")?.replacementCost).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// revertAgentWindow — denied by default; restores a deploy when granted
// ────────────────────────────────────────────────────────────────────────────

describe("revertAgentWindow", () => {
  async function seed(t: T) {
    await seedMember(t, "owner");
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW, total: 0,
      });
      await ctx.db.insert("models", { id: "mdl1", organizationId: ORG, name: "PAR", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("assets", {
        id: "a1", organizationId: ORG, modelId: "mdl1", assetTag: "A-1",
        status: "AVAILABLE", condition: "GOOD", isActive: true, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", modelId: "mdl1", assetId: "a1",
        quantity: 1, sortOrder: 0, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PENDING",
        isKitChild: false, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("an agent key without the scope is rejected, even holding warehouse:check_in", async () => {
    const t = makeT();
    await seed(t);
    await seedKey(t, ["warehouse:check_in"]);
    await expect(
      t.withIdentity(asAgent).mutation(api.agentRevert.revertAgentWindow, {
        orgId: ORG, apiKeyId: KEY, fromMs: NOW - 1000, toMs: NOW + 1000, actor: ACTOR, now: NOW,
      }),
    ).rejects.toThrow(/missing.*'warehouse:revert_agent_window'/i);
  });

  test("a browser operator (with warehouse:check_in RBAC) reverts an agent's deploy back to available", async () => {
    const t = makeT();
    await seed(t);
    await seedKey(t, ["warehouse:check_out"]); // the AGENT key whose run we're reverting — needs check_out to deploy

    // The agent deploys the asset.
    await t.withIdentity(asAgent).mutation(api.warehouseWrites.checkOutItems, {
      orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
      includeAccessories: false, auditIds: ["agentlog1"], now: NOW, actor: ACTOR,
    });
    expect((await t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique()))?.status).toBe("CHECKED_OUT");

    // An operator (browser user, owner role — plain RBAC, no scope needed) reverts the window.
    const res = await t.withIdentity(asUser).mutation(api.agentRevert.revertAgentWindow, {
      orgId: ORG, apiKeyId: KEY, fromMs: NOW - 1000, toMs: NOW + 1000, actor: ACTOR, now: NOW,
    });

    expect(res.skipped).toEqual([]);
    expect(res.reverted).toHaveLength(1);
    expect(res.reverted[0].reverseOperation).toBe("warehouseWrites.undeployItems");

    const asset = await t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique());
    expect(asset?.status).toBe("AVAILABLE");
  });

  test("a human-authored write in the same window is left alone (not agent-attributed)", async () => {
    const t = makeT();
    await seed(t);
    await seedKey(t, ["warehouse:check_in"]);

    // The HUMAN deploys — no akid, so writeActivityLog does not stamp apiKeyId.
    await t.withIdentity(asUser).mutation(api.warehouseWrites.checkOutItems, {
      orgId: ORG, projectId: "p1", items: [{ lineItemId: "li1", assetId: "a1" }],
      includeAccessories: false, auditIds: ["humanlog1"], now: NOW, actor: ACTOR,
    });

    const res = await t.withIdentity(asUser).mutation(api.agentRevert.revertAgentWindow, {
      orgId: ORG, apiKeyId: KEY, fromMs: NOW - 1000, toMs: NOW + 1000, actor: ACTOR, now: NOW,
    });
    expect(res.reverted).toHaveLength(0);
    expect(res.skipped).toHaveLength(0);

    const asset = await t.run((ctx) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "a1")).unique());
    expect(asset?.status).toBe("CHECKED_OUT"); // untouched
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Gate parity — the same scenario via a user token and an agent token must
// produce the SAME rejection. Any divergence is a bypass.
// ────────────────────────────────────────────────────────────────────────────

describe("gate parity — user token vs agent token", () => {
  async function seedConfirmed(t: T) {
    await seedMember(t, "owner");
    await seedKey(t, ["*"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW, total: 0,
      });
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", quantity: 1, unitPrice: 10,
        sortOrder: 0, status: "CONFIRMED", checkedOutQuantity: 0, prepStatus: "PENDING",
        isKitChild: false, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("FINANCIALS_LOCKED fires identically for both", async () => {
    const t = makeT();
    await seedConfirmed(t);
    const patch = {
      id: "li1", orgId: ORG, set: { unitPrice: 99 }, clear: [], entityName: "Line item",
      allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    };
    await expect(t.withIdentity(asAgent).mutation(api.lineItemWrites.patchNative, patch)).rejects.toThrow(/FINANCIALS_LOCKED/);
    await expect(t.withIdentity(asUser).mutation(api.lineItemWrites.patchNative, { ...patch, auditId: "log2" })).rejects.toThrow(/FINANCIALS_LOCKED/);
  });

  // The CAP is deliberately different by kind (agent 50 vs human 500 — the whole
  // point of decision 7) so the message differs; what must NOT differ is the
  // error CODE both paths surface once a caller is over ITS OWN cap.
  test("BULK_TOO_LARGE is the code both paths surface once over their own cap", async () => {
    const t = makeT();
    await seedConfirmed(t);
    const over500 = Array.from({ length: 501 }, (_, i) => `li${i}`);
    const over50 = Array.from({ length: 51 }, (_, i) => `li${i}`);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.removeManyNative, { ids: over50, orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW }),
    ).rejects.toThrow(/"code":"BULK_TOO_LARGE"/);
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.removeManyNative, { ids: over500, orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW }),
    ).rejects.toThrow(/"code":"BULK_TOO_LARGE"/);
  });

  test("cross-org organizationId fires identically for both", async () => {
    const t = makeT();
    await seedConfirmed(t);
    const args = {
      id: "new1", organizationId: "org_other", projectId: "p1",
      fields: { type: "EQUIPMENT" as const, description: "PAR", quantity: 1, unitPrice: 10 },
      includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
    };
    await expect(t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, args)).rejects.toThrow(/organization mismatch/i);
    await expect(t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, { ...args, auditId: "log2" })).rejects.toThrow(/organization mismatch/i);
  });
});
