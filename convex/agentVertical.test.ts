// @vitest-environment node
//
// PHASE 0 — the pattern-prover (#996).
//
// One vertical, end to end: API key -> AGENT token -> `api.lineItemWrites.addNative`
// on a real project, proving that an agent token inherits EVERY gate a browser user
// faces. This file is the evidence the whole re-implementation rests on. If the
// eight assertions below hold, every other operation is a template; if assertion 6
// fails, the architectural premise of #995 is wrong.
//
// Why this can be proved in-process
// ---------------------------------
// `convex-test`'s `withIdentity` sets the claims `getUserIdentity()` returns, which
// is exactly the seam `getAuthContext` reads. So an agent identity here is
// `{ subject, orgId, akid }` — indistinguishable, from every guard's point of view,
// from a real ES256 token minted by `src/lib/api/agent-token.ts`. The JWT signing
// itself is covered separately (`src/lib/api/agent-token.test.ts`), and the design's
// JWKS caveat — the shared dev deployment won't trust locally-minted keys — is
// therefore about the wire format, not about the authorization logic tested here.
//
// One genuine limit is called out inline on assertion 1.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const OTHER_ORG = "org_B";
const USER = "user_1";
const KEY = "key_1";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: USER, userName: "Alice" };

/** A USER token — the browser. No `akid`, so `getAuthContext` yields kind:"user". */
const asUser = { subject: USER, orgId: ORG };
/** An AGENT token — the API. Same subject and org; the `akid` claim is the only
 *  difference, and it is what routes the caller through requireAgentScope. */
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

/** Seed the acting user's member row (the RBAC half of the intersection). */
async function member(t: T, role = "manager", org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m-${org}`, organizationId: org, userId: USER, role });
  });
}

/** Seed the API key row (the scope half). `requireAgentScope` re-reads this on
 *  every guarded call, which is what makes revocation instant. */
async function apiKey(
  t: T,
  scopes: string[],
  overrides: Partial<{
    isActive: boolean;
    revokedAt: number;
    expiresAt: number;
    organizationId: string;
    actingUserId: string;
  }> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("apiKeys", {
      id: KEY,
      organizationId: ORG,
      name: "Test agent",
      prefix: "gf_live_aaaaaa",
      tokenHash: "hash",
      scopes: JSON.stringify(scopes),
      isActive: true,
      actingUserId: USER,
      createdById: USER,
      createdAt: NOW,
      ...overrides,
    });
  });
}

async function project(
  t: T,
  status: "QUOTED" | "CONFIRMED" | "ON_SITE" | "RETURNED" | "COMPLETED",
  id = "p1",
  org = ORG,
  extra: Record<string, unknown> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id,
      organizationId: org,
      projectNumber: id.toUpperCase(),
      name: "Gig",
      status,
      isTemplate: false,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    });
  });
}

const addArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "new1",
  organizationId: ORG,
  projectId: "p1",
  fields: { type: "EQUIPMENT" as const, description: "PAR Can", quantity: 1, unitPrice: 15 },
  includeAccessories: false,
  allowOverbook: false,
  actor: ACTOR,
  auditId: "log1",
  now: NOW,
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────
// 1. Overbooking is rejected under concurrency — exactly one add wins the last unit
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 1 — overbooking under concurrency", () => {
  /** One SERIALIZED model with exactly `n` available assets, on a dateless project
   *  (so only this project's bookings count against stock). */
  async function seedStock(t: T, n: number) {
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("assets", {
          id: `a${i}`, organizationId: ORG, modelId: "m1", assetTag: `A-${i}`,
          status: "AVAILABLE", isActive: true,
        });
      }
    });
  }

  test("N concurrent agent adds for the LAST free unit — exactly one succeeds", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["project:manage_line_items"]);
    await project(t, "CONFIRMED");
    await seedStock(t, 1); // one unit of stock, in total

    const CONTENDERS = 5;
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, (_, i) =>
        t.withIdentity(asAgent).mutation(
          api.lineItemWrites.addNative,
          addArgs({ id: `c${i}`, auditId: `log${i}`, fields: { type: "EQUIPMENT" as const, modelId: "m1", quantity: 1 } }),
        ),
      ),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(CONTENDERS - 1);
    for (const failure of lost) {
      expect(String((failure as PromiseRejectedResult).reason)).toMatch(/free|stock/i);
    }

    // And the ledger agrees: exactly one line consumed the unit.
    await t.run(async (ctx) => {
      const lines = await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", "p1"))
        .collect();
      expect(lines).toHaveLength(1);
    });
  });

  // NOTE (design §15.9): this proves the check is INSIDE the mutation transaction
  // rather than a check-then-write across two calls — which is the property the old
  // design's preview->commit tokens existed to fake, and the reason decision 11
  // could drop them. What an in-process harness cannot prove is that the real
  // backend's OCC retries behave identically under true parallelism; that needs a
  // preview deployment, and is tracked as the Phase-3 calibration run.
});

// ────────────────────────────────────────────────────────────────────────────
// 2. `allowOverbook: true` needs its own scope
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 2 — allowOverbook is separately scoped", () => {
  async function seedExhausted(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "PAR", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "a0", organizationId: ORG, modelId: "m1", assetTag: "A-0", status: "AVAILABLE", isActive: true });
      await ctx.db.insert("projectLineItems", {
        id: "lx", organizationId: ORG, projectId: "p1", modelId: "m1",
        type: "EQUIPMENT", quantity: 1, status: "CONFIRMED", isKitChild: false,
      });
    });
  }
  const overbookArgs = addArgs({
    fields: { type: "EQUIPMENT" as const, modelId: "m1", quantity: 1 },
    allowOverbook: true,
  });

  test("rejected with MISSING_SCOPE when the key lacks project:allow_overbook", async () => {
    const t = makeT();
    await member(t); // the ACTING USER is a manager and may overbook via the UI…
    await apiKey(t, ["project:manage_line_items"]); // …but the KEY was not granted it
    await project(t, "CONFIRMED");
    await seedExhausted(t);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, overbookArgs),
    ).rejects.toThrow(/allow_overbook/);
  });

  test("permitted when the key holds the scope", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["project:manage_line_items", "project:allow_overbook"]);
    await project(t, "CONFIRMED");
    await seedExhausted(t);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, overbookArgs),
    ).resolves.toBeTruthy();
  });

  test("a browser user with project:manage_line_items is UNAFFECTED", async () => {
    // The new gate must not narrow the existing UI behaviour — a human deliberately
    // overbooking is an intended judgement call.
    const t = makeT();
    await member(t);
    await project(t, "CONFIRMED");
    await seedExhausted(t);

    await expect(
      t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, overbookArgs),
    ).resolves.toBeTruthy();
  });

  test("a wildcard key DOES grant it — `*` means `*`", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "CONFIRMED");
    await seedExhausted(t);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, overbookArgs),
    ).resolves.toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Money field on a CONFIRMED project ⇒ FINANCIALS_LOCKED
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 3 — financial lock tier", () => {
  test("patching unitPrice on a CONFIRMED project fails FINANCIALS_LOCKED", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "CONFIRMED");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "li1", organizationId: ORG, projectId: "p1", description: "Light",
        status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false,
      });
    });

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.patchNative, {
        id: "li1", orgId: ORG, entityName: "Light", allowOverbook: false,
        actor: ACTOR, auditId: "log1", now: NOW,
        set: { unitPrice: 99, updatedAt: NOW }, clear: [],
      }),
    ).rejects.toThrow(/financials are locked/i);
  });

  test("an ADD on a CONFIRMED project is forced to $0 rather than rejected", async () => {
    // The lock's documented behaviour for a NEW line (#791): adding is structural at
    // this tier, and the money defaults to zero server-side. An agent gets exactly
    // the same treatment — no special case, which is the point.
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "CONFIRMED");

    await t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs());
    await t.run(async (ctx) => {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "new1")).first();
      expect(line?.unitPrice).toBe(0);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Structural write on ON_SITE ⇒ JUSTIFICATION_REQUIRED
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 4 — justify tier", () => {
  test("an add on an ON_SITE project fails without a justification", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "ON_SITE");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/describe why this change is needed/i);
  });

  test("the same add succeeds WITH a justification (decision 1 — allowed, not denied)", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "ON_SITE");

    await expect(
      t.withIdentity(asAgent).mutation(
        api.lineItemWrites.addNative,
        addArgs({ justification: "Client added a second PAR can on site." }),
      ),
    ).resolves.toBeTruthy();
  });

  test("a too-short justification is still rejected (the bound is not agent-relaxed)", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "ON_SITE");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs({ justification: "why" })),
    ).rejects.toThrow(/at least 10 characters/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. The in-mutation audit row carries apiKeyId + actorType
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 5 — audit attribution", () => {
  test("an agent write stamps apiKeyId + actorType into the activity-log metadata", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "QUOTED");

    await t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs());

    await t.run(async (ctx) => {
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      expect(log?.action).toBe("CREATE");
      const metadata = log?.metadata as Record<string, unknown> | undefined;
      expect(metadata?.apiKeyId).toBe(KEY);
      expect(metadata?.actorType).toBe("apiKey");
      // Attribution is still pinned to the human the key acts as — an agent write is
      // not anonymous, it is "Alice, via key_1".
      expect(log?.userId).toBe(USER);
    });
  });

  test("the justification survives ALONGSIDE the agent stamp (metadata is merged, not replaced)", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "ON_SITE");

    await t.withIdentity(asAgent).mutation(
      api.lineItemWrites.addNative,
      addArgs({ justification: "Client added a second PAR can on site." }),
    );

    await t.run(async (ctx) => {
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      const metadata = log?.metadata as Record<string, unknown> | undefined;
      expect(metadata?.justification).toBe("Client added a second PAR can on site.");
      expect(metadata?.apiKeyId).toBe(KEY);
    });
  });

  test("a browser write is NOT stamped (no false agent attribution)", async () => {
    const t = makeT();
    await member(t);
    await project(t, "QUOTED");

    await t.withIdentity(asUser).mutation(api.lineItemWrites.addNative, addArgs());

    await t.run(async (ctx) => {
      const log = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", "log1")).first();
      const metadata = log?.metadata as Record<string, unknown> | undefined;
      expect(metadata?.apiKeyId).toBeUndefined();
      expect(metadata?.actorType).toBeUndefined();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. THE LOAD-BEARING ONE — generated CRUD is unreachable
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 6 — requireService is unreachable by an agent token", () => {
  // This is the invariant that makes "the API cannot reach raw CRUD" STRUCTURAL
  // rather than a rule someone has to remember. The removed 2026-07 build relied on
  // a developer never wiring a generated-CRUD mutation into the registry; here the
  // auth layer refuses, so the failure mode does not exist.
  //
  // The parameterised version across every service-gated function in the tree is
  // `convex/agentServiceUnreachable.test.ts`.

  test("api.projectLineItems.create is REJECTED for an agent token", async () => {
    const t = makeT();
    await member(t, "owner"); // the acting user is an OWNER — maximum RBAC…
    await apiKey(t, ["*"]); // …and the key holds every scope
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.projectLineItems.create, {
        id: "raw1", organizationId: ORG, projectId: "p1", isKitChild: false,
      }),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });

  test("…and rejected for a plain user token too (the guard is not agent-specific)", async () => {
    const t = makeT();
    await member(t, "owner");
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asUser).mutation(api.projectLineItems.create, {
        id: "raw1", organizationId: ORG, projectId: "p1", isKitChild: false,
      }),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });

  test("an agent token bearing `svc` is rejected outright, not upgraded", async () => {
    // Strict service detection must survive the new kind: a forged token carrying
    // BOTH akid and svc must not resolve to anything at all.
    const t = makeT();
    await member(t, "owner");
    await apiKey(t, ["*"]);
    await project(t, "QUOTED");

    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, akid: KEY, svc: true }).mutation(
        api.lineItemWrites.addNative,
        addArgs(),
      ),
    ).rejects.toThrow();
  });

  test("the reserved service subject cannot be claimed by an agent token", async () => {
    const t = makeT();
    await apiKey(t, ["*"]);
    await project(t, "QUOTED");

    await expect(
      t.withIdentity({ subject: "gearflow-service", orgId: ORG, akid: KEY }).mutation(
        api.projectLineItems.create,
        { id: "raw1", organizationId: ORG, projectId: "p1", isKitChild: false },
      ),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Cross-org args are rejected even with a valid token
// ────────────────────────────────────────────────────────────────────────────

describe("assertion 7 — org isolation", () => {
  test("an organizationId naming another org is rejected", async () => {
    const t = makeT();
    await member(t);
    await member(t, "owner", OTHER_ORG); // the user is even a member of the other org…
    await apiKey(t, ["*"]);
    await project(t, "QUOTED", "p1", OTHER_ORG);

    // …but the KEY is bound to ORG, and the token's orgId claim comes from the key.
    await expect(
      t.withIdentity(asAgent).mutation(
        api.lineItemWrites.addNative,
        addArgs({ organizationId: OTHER_ORG }),
      ),
    ).rejects.toThrow(/organization mismatch/i);
  });

  test("a projectId in another org is rejected even when organizationId is correct", async () => {
    // The subtler half: `requireOrgPermission` only proves the CALLER's org, and
    // `by_cuid` is a global index. The target row must be org-checked separately.
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"]);
    await project(t, "QUOTED", "pOther", OTHER_ORG);

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs({ projectId: "pOther" })),
    ).rejects.toThrow(/another organization/i);
  });

  test("a key whose org no longer matches the token is rejected", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"], { organizationId: OTHER_ORG });
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/organization mismatch/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. (Convex half) the key document is authoritative on every call
// ────────────────────────────────────────────────────────────────────────────
//
// The minter-side half of assertion 8 — "refuses any sub not equal to
// actingUserId" — is `src/lib/api/agent-token.test.ts`, since minting is Node-side.
// What belongs here is the second line of defence: even a validly-minted token is
// re-checked against the live key row inside the transaction, so a key that is
// revoked, expired, or re-pointed at a different user stops working immediately
// regardless of the token's remaining TTL.

describe("assertion 8 — the live key row is re-checked in-transaction", () => {
  test("a revoked key is rejected mid-TTL", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"], { revokedAt: NOW });
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/revoked/i);
  });

  test("a deactivated key is rejected", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"], { isActive: false });
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/revoked/i);
  });

  test("an expired key is rejected", async () => {
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"], { expiresAt: 1 });
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/expired/i);
  });

  test("a token whose subject is no longer the key's acting user is rejected", async () => {
    // The impersonation guard's second line: even if a token naming an arbitrary
    // subject were somehow minted, the key row disagrees and the call dies.
    const t = makeT();
    await member(t);
    await apiKey(t, ["*"], { actingUserId: "someone_else" });
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/does not act as the token's subject/i);
  });

  test("an akid naming no key at all is rejected", async () => {
    const t = makeT();
    await member(t);
    await project(t, "QUOTED");

    await expect(
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, addArgs()),
    ).rejects.toThrow(/revoked/i);
  });
});
