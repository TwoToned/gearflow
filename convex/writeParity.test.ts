// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";

/**
 * Write-parity gate (design doc Phase 5): for each domain, the NATIVE mutation must
 * produce the SAME resulting Convex state as the legacy service mutation for the same
 * input. Run both with the SERVICE identity (RBAC is proven separately in the per-domain
 * tests; here we isolate DATA parity). The native path additionally writes an
 * activityLogs row — that's an intentional addition, excluded from the doc comparison.
 */

const modules = import.meta.glob("./**/*.ts");
// Counted writes go through the sharded counter component (gate #3); mount it.
function makeT() {
  const tc = convexTest(schema, modules);
  registerShardedCounter(tc, "shardedCounter");
  return tc;
}
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const ACTOR = { userId: "u1", userName: "Alice" };

/** Strip volatile / identity fields so two rows created from the same input compare equal. */
function normalize(doc: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!doc) return null;
  const { _id, _creationTime, id, ...rest } = doc as Record<string, unknown>;
  void _id; void _creationTime; void id;
  return rest;
}

async function readByCuid(t: ReturnType<typeof convexTest>, table: "assets" | "projectLineItems" | "projects", id: string) {
  return t.run(async (ctx) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.db.query(table) as any).withIndex("by_cuid", (q: any) => q.eq("id", id)).first() as Promise<Record<string, unknown> | null>,
  );
}

describe("write-parity: assets", () => {
  const baseFields = {
    organizationId: ORG, modelId: "m1", assetTag: "TAG-X", serialNumber: "SN1",
    status: "AVAILABLE" as const, condition: "GOOD" as const, isActive: true,
    createdAt: NOW, updatedAt: NOW,
  };

  test("createNative == assets.create (same resulting doc)", async () => {
    const t = makeT();
    // Model the fixtures reference — createNative now org-validates the modelId FK.
    await t.run(async (ctx) => { await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "M1" }); });
    // Distinct tags (native has a dup-guard the service mutation lacks); exclude the tag.
    await t.withIdentity(SERVICE).mutation(api.assets.create, { id: "svc", ...baseFields, assetTag: "TAG-S" });
    await t.withIdentity(SERVICE).mutation(api.assetWrites.createNative, { id: "nat", ...baseFields, assetTag: "TAG-N", actor: ACTOR, auditId: "log1" });
    const svc = normalize(await readByCuid(t, "assets", "svc"));
    const nat = normalize(await readByCuid(t, "assets", "nat"));
    delete (svc as Record<string, unknown>).assetTag;
    delete (nat as Record<string, unknown>).assetTag;
    expect(nat).toEqual(svc);
  });

  test("updateNative(set/clear) == patchAsset (same resulting doc)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "svc", ...baseFields, notes: "old", assetTag: "A" });
      await ctx.db.insert("assets", { id: "nat", ...baseFields, notes: "old", assetTag: "B" });
    });
    const set = { status: "IN_MAINTENANCE" as const, updatedAt: NOW + 1 };
    await t.withIdentity(SERVICE).mutation(api.assets.patchAsset, { id: "svc", set, clear: ["notes"] });
    await t.withIdentity(SERVICE).mutation(api.assetWrites.updateNative, { id: "nat", orgId: ORG, set, clear: ["notes"], actor: ACTOR, auditId: "log1", now: NOW + 1 });
    const svc = normalize(await readByCuid(t, "assets", "svc"));
    const nat = normalize(await readByCuid(t, "assets", "nat"));
    // assetTag differs by construction (a/b) — compare everything else.
    delete (svc as Record<string, unknown>).assetTag;
    delete (nat as Record<string, unknown>).assetTag;
    expect(nat).toEqual(svc);
  });

  test("deleteNative == assets.remove (both gone)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "svc", ...baseFields, assetTag: "A" });
      await ctx.db.insert("assets", { id: "nat", ...baseFields, assetTag: "B" });
    });
    await t.withIdentity(SERVICE).mutation(api.assets.remove, { id: "svc" });
    await t.withIdentity(SERVICE).mutation(api.assetWrites.deleteNative, { id: "nat", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW });
    expect(await readByCuid(t, "assets", "svc")).toBeNull();
    expect(await readByCuid(t, "assets", "nat")).toBeNull();
  });
});

describe("write-parity: line-items", () => {
  const fields = { type: "EQUIPMENT" as const, modelId: "m1", description: "Light", quantity: 2, unitPrice: 15 };

  test("addNative == createLineItem (same resulting parent line, except lineTotal)", async () => {
    const t = makeT();
    // Model the fields reference — addNative now org-validates the modelId FK.
    // Project row — addNative now resolves the project's lock tier (#957).
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "M1" });
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    });
    await t.withIdentity(SERVICE).mutation(api.projectLineItems.createLineItem, { id: "svc", organizationId: ORG, projectId: "p1", fields, includeAccessories: false, now: NOW });
    await t.withIdentity(SERVICE).mutation(api.lineItemWrites.addNative, { id: "nat", organizationId: ORG, projectId: "p1", fields, includeAccessories: false, allowOverbook: true, actor: ACTOR, auditId: "log1", now: NOW });
    const svc = normalize(await readByCuid(t, "projectLineItems", "svc"));
    const nat = normalize(await readByCuid(t, "projectLineItems", "nat"));
    // sortOrder differs (svc got 0, nat got 1) — normalize it.
    delete (svc as Record<string, unknown>).sortOrder;
    delete (nat as Record<string, unknown>).sortOrder;
    // lineTotal is a DELIBERATE divergence (security hardening, not a parity bug):
    // createLineItem is a raw insert with no legitimate callers (grep-confirmed dead —
    // trusts whatever `fields` it's handed verbatim); addNative now ALWAYS recomputes
    // lineTotal server-side from unitPrice×quantity×duration−discount rather than
    // trusting a client-supplied value, closing a same-org invoice-forgery gap a
    // browser-direct caller could otherwise exploit. 15×2×1 = 30 is the correct value
    // for this fixture's fields (unitPrice:15, quantity:2, no duration ⇒ 1).
    expect((nat as Record<string, unknown>).lineTotal).toBe(30);
    delete (nat as Record<string, unknown>).lineTotal;
    // allocatedRevenue/allocationBasis are ANOTHER deliberate divergence, surfaced now
    // that this fixture has a real project row (needed for addNative's #957 lock-tier
    // check): createLineItem is the same dead raw-insert path noted above and never
    // runs the revenue-allocation pipeline (stays 0/NO_REVENUE regardless), while
    // addNative does run it once a project exists (30/DIRECT here) — not a parity bug.
    delete (nat as Record<string, unknown>).allocatedRevenue;
    delete (nat as Record<string, unknown>).allocationBasis;
    delete (svc as Record<string, unknown>).allocatedRevenue;
    delete (svc as Record<string, unknown>).allocationBasis;
    expect(nat).toEqual(svc);
  });

  test("removeNative == removeLineItemCascade (both gone)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      // Project row — removeNative now resolves the project's lock tier (#957).
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "QUOTED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "svc", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
      await ctx.db.insert("projectLineItems", { id: "nat", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false });
    });
    await t.withIdentity(SERVICE).mutation(api.projectLineItems.removeLineItemCascade, { id: "svc" });
    await t.withIdentity(SERVICE).mutation(api.lineItemWrites.removeNative, { id: "nat", orgId: ORG, actor: ACTOR, auditId: "log1", now: NOW });
    expect(await readByCuid(t, "projectLineItems", "svc")).toBeNull();
    expect(await readByCuid(t, "projectLineItems", "nat")).toBeNull();
  });
});

describe("write-parity: projects", () => {
  const fields = { name: "Gig", status: "CONFIRMED" as const, isTemplate: false, createdAt: NOW, updatedAt: NOW };

  test("createNative == createWithUniqueNumber (same resulting doc)", async () => {
    const t = makeT();
    await t.withIdentity(SERVICE).mutation(api.projects.createWithUniqueNumber, { id: "svc", organizationId: ORG, projectNumber: "P-1", ...fields });
    await t.withIdentity(SERVICE).mutation(api.projectWrites.createNative, { id: "nat", organizationId: ORG, projectNumber: "P-2", ...fields, actor: ACTOR, auditId: "log1" });
    const svc = normalize(await readByCuid(t, "projects", "svc"));
    const nat = normalize(await readByCuid(t, "projects", "nat"));
    delete (svc as Record<string, unknown>).projectNumber;
    delete (nat as Record<string, unknown>).projectNumber;
    expect(nat).toEqual(svc);
  });
});
