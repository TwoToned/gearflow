// @vitest-environment node
//
// The write-replay ledger (#997, design §9).
//
// Two things are being proved, and they are separate:
//
//   1. The LEDGER dedupes cleanly — replay returns the stored result as a success,
//      a concurrent claim is told to wait, and a reused key with different args is
//      refused rather than silently running a divergent write.
//   2. The ledger is NOT what makes replay safe. Deterministic id derivation is.
//      The last test kills the ledger mid-flight (simulating a crash between "run"
//      and "complete") and shows the retry still cannot double-write, because the
//      target mutation's own duplicate guard rejects the re-derived id.
//
// (2) is the one that matters. Decision 8 accepted a non-atomic ledger precisely
// because determinism already provides the guarantee, and that reasoning is only
// sound if it is true — so it is tested rather than asserted.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { deriveWriteIds, hashArgs, canonicalJson } from "../src/lib/api/idempotency";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const USER = "user_1";
const KEY = "key_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}

const claimArgs = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, apiKeyId: KEY, key: "idem-1",
  operation: "line_item.add", argsHash: "hash-a", now: NOW,
  ...over,
});

describe("claim / complete / release", () => {
  test("a first claim is CLAIMED", async () => {
    const t = makeT();
    const result = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(result).toEqual({ status: "CLAIMED" });
  });

  test("a replay after completion returns the stored result, as a SUCCESS", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.complete, {
      organizationId: ORG, key: "idem-1", result: { id: "li_created" }, now: NOW + 1,
    });

    const replay = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(replay).toEqual({ status: "REPLAYED", result: { id: "li_created" } });
  });

  test("a claim while the first is still running is IN_PROGRESS (retryable)", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    const second = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(second).toEqual({ status: "IN_PROGRESS" });
  });

  test("concurrent same-key claims: exactly one CLAIMED, the rest IN_PROGRESS", async () => {
    const t = makeT();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs()),
      ),
    );
    expect(results.filter((r) => r.status === "CLAIMED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "IN_PROGRESS")).toHaveLength(4);
  });

  test("the same key with different args is IDEMPOTENCY_KEY_REUSED, never a divergent write", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await expect(
      t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs({ argsHash: "hash-B" })),
    ).rejects.toThrow(/already used for a different call/i);
  });

  test("the same key on a different operation is also refused", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await expect(
      t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs({ operation: "asset.delete" })),
    ).rejects.toThrow(/already used for a different call/i);
  });

  test("keys are scoped per-org — the same string in another org is a fresh claim", async () => {
    // Idempotency keys are agent-chosen strings, so they are only unique within an
    // org. A global index here would let one org replay another's stored result.
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    const other = await t.withIdentity(SERVICE).mutation(
      api.apiIdempotency.claim,
      claimArgs({ organizationId: "org_B" }),
    );
    expect(other).toEqual({ status: "CLAIMED" });
  });

  test("release frees a claim that never ran, so an honest retry isn't locked out", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.release, { organizationId: ORG, key: "idem-1" });

    const retry = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(retry).toEqual({ status: "CLAIMED" });
  });

  test("release NEVER discards a completed result", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.complete, {
      organizationId: ORG, key: "idem-1", result: { id: "li_created" }, now: NOW + 1,
    });
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.release, { organizationId: ORG, key: "idem-1" });

    const replay = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(replay).toEqual({ status: "REPLAYED", result: { id: "li_created" } });
  });

  test("completing twice keeps the FIRST result, so replays stay stable", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.complete, {
      organizationId: ORG, key: "idem-1", result: { attempt: 1 }, now: NOW + 1,
    });
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.complete, {
      organizationId: ORG, key: "idem-1", result: { attempt: 2 }, now: NOW + 2,
    });

    const replay = await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    expect(replay).toEqual({ status: "REPLAYED", result: { attempt: 1 } });
  });
});

describe("the ledger is dispatcher infrastructure, not an agent-addressable surface", () => {
  test("an agent token cannot claim", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(asAgent).mutation(api.apiIdempotency.claim, claimArgs()),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });

  test("an agent token cannot forge a stored result via complete", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await expect(
      t.withIdentity(asAgent).mutation(api.apiIdempotency.complete, {
        organizationId: ORG, key: "idem-1", result: { forged: true }, now: NOW,
      }),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });

  test("an agent token cannot read another key's ledger rows", async () => {
    const t = makeT();
    await expect(
      t.withIdentity(asAgent).query(api.apiIdempotency.getByKey, { organizationId: ORG, key: "idem-1" }),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The actual guarantee: deterministic ids
// ────────────────────────────────────────────────────────────────────────────

describe("deterministic id derivation is the real double-write defence", () => {
  test("ids are a pure function of (idempotencyKey, operation, slot)", () => {
    const a = deriveWriteIds("idem-1", "line_item.add");
    const b = deriveWriteIds("idem-1", "line_item.add");
    expect(a).toEqual(b);
    expect(a.id).not.toBe(a.auditId); // distinct slots never collide
    expect(deriveWriteIds("idem-2", "line_item.add").id).not.toBe(a.id);
    expect(deriveWriteIds("idem-1", "asset.create").id).not.toBe(a.id);
  });

  test("a derived id is cuid-shaped (24 chars, leading letter)", () => {
    const { id } = deriveWriteIds("idem-1", "line_item.add");
    expect(id).toHaveLength(24);
    expect(id).toMatch(/^[a-z][0-9a-f]{23}$/);
  });

  test("argsHash ignores key ORDER but not key VALUES", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(hashArgs({ a: 1, b: 2 })).not.toBe(hashArgs({ a: 1, b: 3 }));
    // Array order IS meaningful and must survive canonicalisation.
    expect(hashArgs({ ids: ["a", "b"] })).not.toBe(hashArgs({ ids: ["b", "a"] }));
    // undefined members don't survive JSON transport, so they must not affect the hash.
    expect(hashArgs({ a: 1, b: undefined })).toBe(hashArgs({ a: 1 }));
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  test("a replay after a CRASHED ledger still writes exactly one row", async () => {
    // The scenario decision 8 hinges on: the operation ran, then the process died
    // before `complete`. The ledger is stale (PENDING), so it offers no protection
    // at all — and the write still cannot happen twice, because the retry derives
    // the identical id and addNative's own by_cuid guard rejects it.
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role: "manager" });
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER,
      });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
        status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW,
      });
    });

    const ids = deriveWriteIds("idem-1", "line_item.add");
    const call = () =>
      t.withIdentity(asAgent).mutation(api.lineItemWrites.addNative, {
        id: ids.id, auditId: ids.auditId,
        organizationId: ORG, projectId: "p1",
        fields: { type: "EQUIPMENT" as const, description: "PAR Can", quantity: 1, unitPrice: 15 },
        includeAccessories: false, allowOverbook: false,
        actor: { userId: USER, userName: "Alice" }, now: NOW,
      });

    await t.withIdentity(SERVICE).mutation(api.apiIdempotency.claim, claimArgs());
    await call();
    // …crash here: no `complete` call, so the ledger still says PENDING.

    // The retry re-derives the same ids and is rejected by the mutation itself.
    await expect(call()).rejects.toThrow(/already exists/i);

    await t.run(async (ctx) => {
      const lines = await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", "p1"))
        .collect();
      expect(lines).toHaveLength(1);
      const logs = await ctx.db.query("activityLogs").collect();
      expect(logs).toHaveLength(1);
    });
  });
});
