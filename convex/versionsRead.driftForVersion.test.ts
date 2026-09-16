// @vitest-environment node
//
// convex/versionsRead.ts's `quoteDriftForVersion` — #1233 (Phase 6, parent
// #1221) drift DETECTION signal: does a version's current live-computed
// total still match what its sent quote froze? Deliberately narrow (a
// numeric compare, not the line-item Compare-mode diff — #1232, not built).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
type T = ReturnType<typeof makeT>;
const asUser = (orgId: string) => ({ subject: USER, orgId });

async function seedMember(t: T, role = "owner", orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m_${orgId}`, organizationId: orgId, userId: USER, role });
  });
}

/** A project with a live version ("v1") and a second, non-live version
 *  ("v2") holding its own line item. */
async function seedProjectWithTwoVersions(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, liveVersionId: "v1", revision: 1,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: orgId, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectVersions", { id: "v2", organizationId: orgId, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "l2", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "Budget PA", quantity: 1, unitPrice: 50, lineTotal: 50,
      versionId: "v2", lineageId: "l2",
    });
  });
}

const send = (t: T, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, {
    id: "q2", organizationId: ORG, projectId: "p1", versionId: "v2",
    quoteDate: NOW, actor: { userId: USER, userName: "Alice" }, auditId: "a1", now: NOW, ...over,
  } as never);

const drift = (t: T, versionId = "v2") =>
  t.withIdentity(asUser(ORG)).query(api.versionsRead.quoteDriftForVersion, {
    organizationId: ORG, projectId: "p1", versionId, now: NOW,
  } as never);

describe("versionsRead.quoteDriftForVersion", () => {
  test("returns null when the version has never had a quote sent", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithTwoVersions(t);

    expect(await drift(t)).toBeNull();
  });

  test("returns zero drift when the version's content hasn't changed since send", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithTwoVersions(t);
    await send(t);

    const result = await drift(t);
    expect(result).not.toBeNull();
    expect(result!.sentTotal).toBe(50);
    expect(result!.currentTotal).toBe(50);
    expect(result!.driftAmount).toBe(0);
    expect(result!.quoteStatus).toBe("SENT");
  });

  test("detects drift once the version's line items change after the quote was sent", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithTwoVersions(t);
    await send(t);

    // The version's content moves AFTER the freeze — this is exactly what
    // `sendNative` locks against for the LIVE version (D55) but a NON-live
    // version stays fully editable (design principle) even with a quote out.
    await t.run(async (ctx) => {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l2")).first();
      await ctx.db.patch(line!._id, { unitPrice: 1290, lineTotal: 1290 });
    });

    const result = await drift(t);
    expect(result!.sentTotal).toBe(50);
    expect(result!.currentTotal).toBe(1290);
    expect(result!.driftAmount).toBe(1240);
  });

  test("returns null for a version whose quote is still a DRAFT (never sent)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithTwoVersions(t);
    // Seed a DRAFT row directly — sendNative always sends, never leaves a bare draft.
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q2", organizationId: ORG, projectId: "p1", versionId: "v2", version: 2,
        status: "DRAFT", snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });

    expect(await drift(t)).toBeNull();
  });

  test("cross-tenant: a same-versionId probe from another org sees nothing (IDOR guard, R-8.4.3)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectWithTwoVersions(t);
    await send(t);
    await seedMember(t, "owner", OTHER);

    const result = await t.withIdentity(asUser(OTHER)).query(api.versionsRead.quoteDriftForVersion, {
      organizationId: OTHER, projectId: "p1", versionId: "v2", now: NOW,
    } as never);
    expect(result).toBeNull();
  });
});
