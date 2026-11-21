// @vitest-environment node
//
// The dashboard checklists' Dismiss gets an exact Undo (UX Phase 11, §6c.2):
// `undismissNative` on orgSetupDismissalsWrites and orgActivationDismissalsWrites
// removes only the row the caller's own Dismiss created, never another user's,
// never another org's, and is idempotent.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const me = { subject: "user_1", orgId: ORG };
const colleague = { subject: "user_2", orgId: ORG };
const elsewhere = { subject: "user_1", orgId: OTHER };
const NOW = Date.UTC(2026, 10, 21);

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMembers(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: "user_1", role: "member" });
    await ctx.db.insert("members", { id: "m2", organizationId: ORG, userId: "user_2", role: "member" });
    await ctx.db.insert("members", { id: "m3", organizationId: OTHER, userId: "user_1", role: "member" });
  });
}

const MODULES = [
  { name: "setup", w: api.orgSetupDismissalsWrites },
  { name: "activation", w: api.orgActivationDismissalsWrites },
] as const;

describe.each(MODULES)("$name checklist undismissNative", ({ w }) => {
  test("Undo removes exactly the row Dismiss created; the card is back", async () => {
    const t = makeT();
    await seedMembers(t);
    const mine = t.withIdentity(me);
    expect(await mine.mutation(w.dismissNative, { id: "d1", now: NOW })).toEqual({ created: true });
    expect(await mine.query(w.mine, {})).toBe(NOW);
    expect(await mine.mutation(w.undismissNative, { id: "d1" })).toEqual({ removed: true });
    expect(await mine.query(w.mine, {})).toBeNull();
    // Idempotent.
    expect(await mine.mutation(w.undismissNative, { id: "d1" })).toEqual({ removed: false });
  });

  test("never removes a colleague's dismissal, even given its id", async () => {
    const t = makeT();
    await seedMembers(t);
    await t.withIdentity(colleague).mutation(w.dismissNative, { id: "theirs", now: NOW });
    expect(await t.withIdentity(me).mutation(w.undismissNative, { id: "theirs" })).toEqual({ removed: false });
    expect(await t.withIdentity(colleague).query(w.mine, {})).toBe(NOW);
  });

  test("never removes the same user's dismissal in another org", async () => {
    const t = makeT();
    await seedMembers(t);
    await t.withIdentity(elsewhere).mutation(w.dismissNative, { id: "far", now: NOW });
    expect(await t.withIdentity(me).mutation(w.undismissNative, { id: "far" })).toEqual({ removed: false });
    expect(await t.withIdentity(elsewhere).query(w.mine, {})).toBe(NOW);
  });

  test("a signed-out caller is rejected", async () => {
    const t = makeT();
    await seedMembers(t);
    await expect(t.mutation(w.undismissNative, { id: "d1" })).rejects.toThrow();
  });
});
