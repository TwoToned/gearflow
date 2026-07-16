// @vitest-environment node
//
// convex/collaboration.ts — the browser-direct presence + edit-lock mutations.
// Verifies: presence userId / lock ownerUserId are PINNED to the verified token (a
// client can't broadcast presence or hold/release a lock AS another user), the
// membership-aware guard, and that the SERVICE path (deployed image) still trusts
// the supplied owner id (backward-compat).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const ALICE = "user_alice";
const BOB = "user_bob";
const ENTITY = { entityType: "project", entityId: "proj_1" };
const TARGET = { targetType: "lineItem", targetId: "li_1" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { id: ALICE, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("users", { id: BOB, name: "Bob", email: "b@x.co" });
    await ctx.db.insert("members", { id: "m_a", organizationId: ORG, userId: ALICE, role: "member" });
    await ctx.db.insert("members", { id: "m_b", organizationId: ORG, userId: BOB, role: "member" });
  });
}

const asAlice = { subject: ALICE, orgId: ORG, role: "member" };
const asBob = { subject: BOB, orgId: ORG, role: "member" };
const SERVICE = { subject: "gearflow-service", svc: true };

describe("collaboration presence + lock (browser-direct, pinned)", () => {
  test("heartbeatPresence pins userId to the token; a spoofed userId is ignored", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asAlice).mutation(api.collaboration.heartbeatPresence, {
      orgId: ORG, userId: BOB /* spoof */, userName: "Not Alice", userColor: "#000", ...ENTITY, mode: "viewing",
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("collaborationPresence").withIndex("by_orgId_entityType_entityId", (q) => q.eq("orgId", ORG).eq("entityType", "project").eq("entityId", "proj_1")).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ALICE); // pinned, not BOB
  });

  test("clearPresence only clears the caller's own row", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asAlice).mutation(api.collaboration.heartbeatPresence, { orgId: ORG, userId: ALICE, userName: "Alice", userColor: "#000", ...ENTITY, mode: "viewing" });
    await t.withIdentity(asBob).mutation(api.collaboration.heartbeatPresence, { orgId: ORG, userId: BOB, userName: "Bob", userColor: "#000", ...ENTITY, mode: "viewing" });
    // Bob clears with a spoofed userId=ALICE → pinned to Bob → only Bob's row goes.
    await t.withIdentity(asBob).mutation(api.collaboration.clearPresence, { orgId: ORG, userId: ALICE, ...ENTITY });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("collaborationPresence").withIndex("by_orgId_entityType_entityId", (q) => q.eq("orgId", ORG).eq("entityType", "project").eq("entityId", "proj_1")).collect(),
    );
    expect(rows.map((r) => r.userId)).toEqual([ALICE]); // Alice survives, Bob cleared his own
  });

  test("acquireLock pins ownerUserId; another user is blocked, not made owner", async () => {
    const t = makeT();
    await seed(t);
    const a = await t.withIdentity(asAlice).mutation(api.collaboration.acquireLock, {
      orgId: ORG, ...ENTITY, ...TARGET, ownerUserId: ALICE, ownerName: "Alice", ownerColor: "#000", clientSessionId: "sess_a",
    });
    expect(a.acquired).toBe(true);
    // Bob tries to acquire, spoofing ownerUserId=ALICE + clientSessionId — pinned to Bob,
    // so he is NOT the owner and the active lock isn't stale → blocked.
    const b = await t.withIdentity(asBob).mutation(api.collaboration.acquireLock, {
      orgId: ORG, ...ENTITY, ...TARGET, ownerUserId: ALICE, ownerName: "x", ownerColor: "#000", clientSessionId: "sess_a",
    });
    expect(b.acquired).toBe(false);
    const lock = await t.run(async (ctx) =>
      ctx.db.query("collaborationLocks").withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) => q.eq("orgId", ORG).eq("entityType", "project").eq("entityId", "proj_1").eq("targetType", "lineItem").eq("targetId", "li_1")).first(),
    );
    expect(lock!.ownerUserId).toBe(ALICE); // still Alice's
  });

  test("releaseLock only releases a lock the caller's token owns", async () => {
    const t = makeT();
    await seed(t);
    const a = await t.withIdentity(asAlice).mutation(api.collaboration.acquireLock, {
      orgId: ORG, ...ENTITY, ...TARGET, ownerUserId: ALICE, ownerName: "Alice", ownerColor: "#000", clientSessionId: "sess_a",
    });
    // Bob tries to release Alice's lock, spoofing ownerUserId=ALICE + her session → pinned to Bob → mismatch → false.
    const bobRelease = await t.withIdentity(asBob).mutation(api.collaboration.releaseLock, {
      orgId: ORG, lockId: a.lockId!, ownerUserId: ALICE, clientSessionId: "sess_a",
    });
    expect(bobRelease).toBe(false);
    // Alice releases her own → true.
    const aliceRelease = await t.withIdentity(asAlice).mutation(api.collaboration.releaseLock, {
      orgId: ORG, lockId: a.lockId!, ownerUserId: ALICE, clientSessionId: "sess_a",
    });
    expect(aliceRelease).toBe(true);
  });

  test("SERVICE token trusts the supplied owner id (backward-compat)", async () => {
    const t = makeT();
    await seed(t);
    const a = await t.withIdentity(SERVICE).mutation(api.collaboration.acquireLock, {
      orgId: ORG, ...ENTITY, ...TARGET, ownerUserId: ALICE, ownerName: "Alice", ownerColor: "#000", clientSessionId: "sess_a",
    });
    expect(a.acquired).toBe(true);
    const lock = await t.run(async (ctx) =>
      ctx.db.query("collaborationLocks").withIndex("by_orgId_entityType_entityId_targetType_targetId", (q) => q.eq("orgId", ORG).eq("entityType", "project").eq("entityId", "proj_1").eq("targetType", "lineItem").eq("targetId", "li_1")).first(),
    );
    expect(lock!.ownerUserId).toBe(ALICE); // service trusts supplied
  });
});
