// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import { api } from "./_generated/api";

// Exercises enforceBrowserWriteLimit through the real browser-direct mutation
// (assetWrites.updateNotesNative), which calls it for user tokens. The rate-limiter
// component must be mounted via registerRateLimiter.

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string, subject = USER) => ({ subject, orgId });

// browserWrite bucket capacity (convex/lib/rateLimiter.ts). The (capacity+1)-th
// write in a burst is rejected.
const CAPACITY = 100;

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedAssetAndMember(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("assets", {
      id: "a1",
      organizationId: ORG,
      modelId: "m1",
      assetTag: "TAG-1",
      status: "AVAILABLE",
      condition: "GOOD",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("members", { id: "mem1", organizationId: ORG, userId: USER, role: "member" });
  });
}

const notesArgs = (i: number) => ({
  id: "a1",
  orgId: ORG,
  notes: `n${i}`,
  actor: { userId: USER, userName: "Alice" },
  auditId: `log_${i}`,
  now: NOW + i,
});

describe("enforceBrowserWriteLimit — per-user browser-direct budget", () => {
  test("a user token is rejected once its burst budget is exhausted", async () => {
    const t = makeT();
    await seedAssetAndMember(t);
    // The first `capacity` writes in a burst succeed…
    for (let i = 0; i < CAPACITY; i++) {
      const res = await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, notesArgs(i));
      expect(res.ok).toBe(true);
    }
    // …the next one is rate-limited (ConvexError, kind: RateLimited).
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, notesArgs(CAPACITY)),
    ).rejects.toThrow(/rate/i);
  });

  test("a service token is never rate-limited", async () => {
    const t = makeT();
    await seedAssetAndMember(t);
    // Well beyond the user bucket capacity — the trusted backend is exempt.
    for (let i = 0; i < CAPACITY + 25; i++) {
      const res = await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNotesNative, notesArgs(i));
      expect(res.ok).toBe(true);
    }
  });

  test("the budget is per-user — one user's burst does not limit another", async () => {
    const t = makeT();
    await seedAssetAndMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mem2", organizationId: ORG, userId: "user_2", role: "member" });
    });
    // Drain user_1's bucket.
    for (let i = 0; i < CAPACITY; i++) {
      await t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, notesArgs(i));
    }
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.assetWrites.updateNotesNative, notesArgs(CAPACITY)),
    ).rejects.toThrow(/rate/i);
    // user_2 still has a full bucket.
    const res = await t
      .withIdentity(asUser(ORG, "user_2"))
      .mutation(api.assetWrites.updateNotesNative, { ...notesArgs(999), actor: { userId: "user_2", userName: "Bob" } });
    expect(res.ok).toBe(true);
  });
});
