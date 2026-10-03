// @vitest-environment node
//
// convex/versionsRead.ts's `compareVersions` — #1232 (Phase 5b, parent
// #1221) Compare mode's one new Convex read. Integration-level coverage
// (auth/org-checks/query wiring); the exactness/alignment math itself is
// proven in isolation in `convex/lib/versionCompare.test.ts`.
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

async function seedTwoVersions(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, taxRate: 10, discountPercent: 0, liveVersionId: "v1", revision: 2,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", { id: "v1", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    // taxRate/discountPercent copied explicitly (a real `versions.createNative`
    // always copies every plan field from its source) — isolates this fixture
    // to the one line-item change; `versionCompare.test.ts` covers a
    // plan-field-ONLY change in isolation.
    await ctx.db.insert("projectVersions", { id: "v2", organizationId: ORG, projectId: "p1", number: 2, label: "With LED wall", contentState: "ready", createdAt: NOW, createdById: "u1", taxRate: 10, discountPercent: 0 });
    await ctx.db.insert("projectCategories", { id: "cat1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "cat1", name: "Lighting", sortOrder: 0 });
    await ctx.db.insert("projectCategories", { id: "cat1b", organizationId: ORG, projectId: "p1", versionId: "v2", lineageId: "cat1", name: "Lighting", sortOrder: 0 });
    await ctx.db.insert("projectLineItems", { id: "l1", organizationId: ORG, projectId: "p1", versionId: "v1", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "cat1", description: "Source Four", quantity: 1, unitPrice: 100, lineTotal: 100 });
    await ctx.db.insert("projectLineItems", { id: "l1b", organizationId: ORG, projectId: "p1", versionId: "v2", lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, isOptional: false, categoryId: "cat1", description: "Source Four", quantity: 1, unitPrice: 150, lineTotal: 150 });
  });
}

const compare = (t: T, orgId: string, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(orgId)).query(api.versionsRead.compareVersions, {
    organizationId: orgId,
    projectId: "p1",
    a: { kind: "version", versionId: "v1" },
    b: { kind: "version", versionId: "v2" },
    ...over,
  } as never);

describe("versionsRead.compareVersions", () => {
  test("version vs version: rows classified, bridge sums exactly, labels resolved", async () => {
    const t = makeT();
    await seedMember(t);
    await seedTwoVersions(t);

    const result = await compare(t, ORG);
    expect(result.a.label).toBe("v1");
    expect(result.b.label).toBe("v2 · With LED wall");
    expect(result.rows).not.toBeNull();
    const row = result.rows!.find((r: { key: string }) => r.key === "l1")!;
    expect(row.state).toBe("changed");
    expect(row.categoryLabel).toBe("Lighting");

    const sum = Math.round(result.bridge.segments.reduce((s: number, seg: { amount: number }) => s + seg.amount, 0) * 100) / 100;
    expect(sum).toBe(Math.round((result.bridge.totalB - result.bridge.totalA) * 100) / 100);
    expect(result.planFieldChanges).toEqual([]);
  });

  test("quoteSnapshot vs version: totals-only, single unattributed bridge segment, rows null", async () => {
    const t = makeT();
    await seedMember(t);
    await seedTwoVersions(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", versionId: "v1", version: 1,
        status: "SENT", sentAt: NOW,
        snapshot: { subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110 },
        createdAt: NOW, updatedAt: NOW,
      });
    });

    const result = await compare(t, ORG, { a: { kind: "quoteSnapshot", quoteId: "q1" }, b: { kind: "version", versionId: "v2" } });
    expect(result.rows).toBeNull();
    expect(result.planFieldChanges).toBeNull();
    expect(result.a.totals.total).toBe(110);
    expect(result.bridge.totalA).toBe(110);
    expect(result.bridge.segments).toHaveLength(1);
    expect(result.bridge.segments[0].state).toBe("snapshotOnly");
    expect(result.bridge.segments[0].amount).toBe(result.bridge.totalB - result.bridge.totalA);
  });

  test("cross-tenant: comparing another org's versionId is rejected, not silently empty", async () => {
    const t = makeT();
    await seedMember(t);
    await seedTwoVersions(t);
    await seedMember(t, "owner", OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: OTHER, projectNumber: "OTHER-1", name: "Other gig", status: "QUOTING", isTemplate: false, liveVersionId: "vOther", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "vOther", organizationId: OTHER, projectId: "p2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u2" });
    });

    // Caller is in ORG, but the referenced versionId (v1) belongs to ORG's
    // own project — try comparing it against the OTHER org's version id
    // while authenticated as OTHER: should reject (not found / cross-org),
    // never silently return ORG's row data to OTHER.
    await expect(
      t.withIdentity(asUser(OTHER)).query(api.versionsRead.compareVersions, {
        organizationId: OTHER,
        projectId: "p2",
        a: { kind: "version", versionId: "v1" },
        b: { kind: "version", versionId: "vOther" },
      } as never),
    ).rejects.toThrow();
  });
});
