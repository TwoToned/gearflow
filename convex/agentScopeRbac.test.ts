// @vitest-environment node
//
// PHASE 1 acceptance (#997) — the intersection, the limits, and the fail-closed reads.
//
// Effective permission for an agent is `live member-row RBAC ∩ key scopes`,
// re-evaluated every call. The failure mode worth testing is not "does a valid
// call work" but the two ways an intersection can be got wrong:
//
//   • widening — a `*` key making its acting user more powerful than they are;
//   • narrowing the wrong thing — treating a too-narrow key as a role problem, so
//     the operator is sent to fix something that isn't broken.
//
// `permissionsCore` is used as the parity oracle throughout: the browser and the
// agent go through the SAME `decideOrgPermission`, so any divergence between the
// two paths is a bypass, not a difference of opinion.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { hasPermission } from "./lib/permissionsCore";
import { MAX_BULK_ITEMS, MAX_BULK_ITEMS_AGENT } from "./lib/rateLimiter";
import { requireOrgReadDoc } from "./lib/auth";

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

async function seed(t: T, role: string, scopes: string[], keyId = KEY) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("apiKeys", {
      id: keyId, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
      scopes: JSON.stringify(scopes), isActive: true, actingUserId: USER, createdById: USER,
    });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const addArgs = (over: Record<string, unknown> = {}) => ({
  id: "new1", organizationId: ORG, projectId: "p1",
  fields: { type: "EQUIPMENT" as const, description: "PAR Can", quantity: 1, unitPrice: 15 },
  includeAccessories: false, allowOverbook: false, actor: ACTOR, auditId: "log1", now: NOW,
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────
// Scope ∩ RBAC
// ────────────────────────────────────────────────────────────────────────────

describe("scope ∩ RBAC — neither half can be widened by the other", () => {
  test("a read-only key on an OWNER acting user is still read-only", () => {
    // The oracle says owner may manage line items…
    expect(hasPermission("owner", "project", "manage_line_items")).toBe(true);
  });

  test("…but the write is refused, with MISSING_SCOPE rather than FORBIDDEN", async () => {
    const t = makeT();
    await seed(t, "owner", ["project:read", "asset:read"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/missing the 'project:manage_line_items' scope/i);
  });

  test("a `*` key on a VIEWER acting user is still viewer-limited", async () => {
    // The scope half is wide open; the ROLE is what stops it. The error must say
    // so — telling the operator to widen the key would be a dead end.
    expect(hasPermission("viewer", "project", "manage_line_items")).toBe(false);

    const t = makeT();
    await seed(t, "viewer", ["*"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("a `*` key on a WAREHOUSE acting user is still warehouse-limited", async () => {
    expect(hasPermission("warehouse", "project", "manage_line_items")).toBe(false);

    const t = makeT();
    await seed(t, "warehouse", ["*"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("both halves granted ⇒ the write goes through", async () => {
    const t = makeT();
    await seed(t, "manager", ["project:manage_line_items"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).resolves.toBeTruthy();
  });

  test("a `resource:*` scope grants every action on that resource, and nothing else", async () => {
    const t = makeT();
    await seed(t, "manager", ["project:*"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).resolves.toBeTruthy();

    // …but it does NOT reach the asset resource.
    await expect(
      t.withIdentity(asAgent).mutation(api.assetWrites.deleteNative, {
        id: "a1", orgId: ORG, actor: ACTOR, auditId: "log2", now: NOW,
      }),
    ).rejects.toThrow(/missing the 'asset:delete' scope/i);
  });

  test("an agent is never a member of an org it has no member row in", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER,
      });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/not a member/i);
  });

  test("the browser path is unchanged by any of this", async () => {
    // Regression guard: an agent-shaped identity has an extra claim, so nothing
    // about the user path should have moved. A manager with no API key at all
    // still writes exactly as before.
    const t = makeT();
    await seed(t, "manager", []);

    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, addArgs()),
    ).resolves.toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Fail-closed reads (decision 2)
// ────────────────────────────────────────────────────────────────────────────

describe("resource-less read guards fail closed for agents", () => {
  test("a query still on requireOrgRead is INVISIBLE to an agent, even with `*`", async () => {
    // `globalSearch.search` is (as of the Phase 5 sweep, #1001) the one
    // remaining read on the resource-less guard — a deliberate denial
    // (14-entity blend search has no single resource to scope against; see
    // docs/api-coverage.md's "Deliberately denied" table), not an oversight.
    // `locations.list`, this test's previous target, was migrated to
    // `requireOrgReadFor` in the same sweep. A `*` key on an OWNER is the
    // widest possible agent, and it still can't see this one.
    const t = makeT();
    await seed(t, "owner", ["*"]);

    await expect(
      t.withIdentity(asAgent).query(api.globalSearch.search, { orgId: ORG, query: "gig" }),
    ).rejects.toThrow(/not available to API keys/i);
  });

  test("the same query still works for the browser", async () => {
    // The fail-closed branch must be agent-only — it must not narrow the UI.
    const t = makeT();
    await seed(t, "owner", ["*"]);

    await expect(
      t.withIdentity(asUser).query(api.globalSearch.search, { orgId: ORG, query: "gig" }),
    ).resolves.toBeTruthy();
  });

  test("a doc-checked read guard fails closed too", async () => {
    // Phase 5 (#1001) migrated every real application call site off the bare
    // `requireOrgReadDoc` — there is no longer a production query left to
    // exercise this through, which is the intended end state, not a gap.
    // `requireOrgReadDoc` itself remains available for future thin-CRUD
    // modules, so its fail-closed branch stays covered directly via an
    // inline query function (convex-test's `query`/`mutation` accept one)
    // rather than a real registry operation.
    const t = makeT();
    await seed(t, "owner", ["*"]);

    await expect(
      t.withIdentity(asAgent).query(async (ctx) => {
        await requireOrgReadDoc(ctx, { organizationId: ORG });
      }),
    ).rejects.toThrow(/not available to API keys/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Personal scopes
// ────────────────────────────────────────────────────────────────────────────

describe("self:read / self:write", () => {
  const prefs = {
    id: "np1",
    prefs: {
      overdueMaintenance: true, overdueReturn: true, upcomingProject: true,
      pendingInvitation: true, pendingOffers: true, pendingTimesheets: true,
      flaggedAsset: true, incidentReport: true,
    },
    actor: ACTOR,
    auditId: "log1",
    now: NOW,
  };

  test("a key without self:read cannot read the acting user's preferences", async () => {
    const t = makeT();
    await seed(t, "owner", ["project:read"]);

    await expect(
      t.withIdentity(asAgent).query(api.userNotificationPreferences.mine, {}),
    ).rejects.toThrow(/missing the 'self:read' scope/i);
  });

  test("a key WITH self:read can", async () => {
    const t = makeT();
    await seed(t, "owner", ["self:read"]);

    await expect(
      t.withIdentity(asAgent).query(api.userNotificationPreferences.mine, {}),
    ).resolves.toBeTruthy();
  });

  test("self:read does not imply self:write", async () => {
    const t = makeT();
    await seed(t, "owner", ["self:read"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.userNotificationPreferences.upsertMine, prefs),
    ).rejects.toThrow(/missing the 'self:write' scope/i);
  });

  test("a resource scope never grants the personal surface", async () => {
    // The whole reason self:* exists: a project:read key has no business reading
    // someone's notification preferences.
    const t = makeT();
    await seed(t, "owner", ["project:*", "asset:*", "orgSettings:*"]);

    await expect(
      t.withIdentity(asAgent).query(api.userNotificationPreferences.mine, {}),
    ).rejects.toThrow(/missing the 'self:read' scope/i);
  });

  test("the browser reaches the personal surface with no scope at all", async () => {
    const t = makeT();
    await seed(t, "owner", []);

    await expect(
      t.withIdentity(asUser).query(api.userNotificationPreferences.mine, {}),
    ).resolves.toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Limits
// ────────────────────────────────────────────────────────────────────────────

describe("agent limits", () => {
  test("the agent bulk cap is an order of magnitude below the human one", () => {
    expect(MAX_BULK_ITEMS).toBe(500);
    expect(MAX_BULK_ITEMS_AGENT).toBe(50);
  });

  test("a bulk array over 50 is rejected for an agent…", async () => {
    const t = makeT();
    await seed(t, "manager", ["*"]);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.removeManyNative, {
        ids: Array.from({ length: 51 }, (_, i) => `li${i}`),
        orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/exceeds the 50-item limit/i);
  });

  // #1000 acceptance criteria: "Agent bulk call of 51 items rejected; 50 accepted".
  test("…exactly 50 is accepted for an agent", async () => {
    const t = makeT();
    await seed(t, "manager", ["*"]);

    // 50 non-existent ids is a no-op write — the point is it clears the cap,
    // not that any row actually existed to delete.
    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.removeManyNative, {
        ids: Array.from({ length: 50 }, (_, i) => `li${i}`),
        orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).resolves.toBeDefined();
  });

  test("…and accepted for the browser at the same size", async () => {
    const t = makeT();
    await seed(t, "manager", ["*"]);

    // 51 non-existent ids is a no-op write, which is exactly what we want to
    // assert: it got PAST the cap rather than being rejected by it.
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.removeManyNative, {
        ids: Array.from({ length: 51 }, (_, i) => `li${i}`),
        orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).resolves.toBeDefined();
  });

  test("the browser cap still bites at 501", async () => {
    const t = makeT();
    await seed(t, "manager", ["*"]);

    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.removeManyNative, {
        ids: Array.from({ length: 501 }, (_, i) => `li${i}`),
        orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW,
      }),
    ).rejects.toThrow(/exceeds the 500-item limit/i);
  });

  test("an agent's writes do NOT consume the acting user's browserWrite budget", async () => {
    // The bug this prevents: an agent token's subject IS a real human, so a bucket
    // keyed on the subject would let a looping agent lock that person out of their
    // own UI. Drain the agent bucket to empty, then prove the human is unaffected.
    const t = makeT();
    await seed(t, "manager", ["*"]);

    // agentWrite capacity is 20; spend well past it.
    const attempts = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs({ id: `ag${i}`, auditId: `agl${i}` })),
      ),
    );
    const throttled = attempts.filter(
      (r) => r.status === "rejected" && /rate/i.test(String(r.reason)),
    );
    expect(throttled.length).toBeGreaterThan(0); // the agent bucket really did run dry

    // The human, same subject, still writes.
    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, addArgs({ id: "human1", auditId: "humanlog" })),
    ).resolves.toBeTruthy();
  });
});
