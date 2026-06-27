/**
 * Integration test for assets.listByModelIds / bulkAssets.listByModelIds — the
 * batched queries that kill the per-model N+1 in availability (one listByModel
 * round-trip PER model). They must return all matching docs across the requested
 * models, org-scoped (cross-org dropped), in one call.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

describe("assets/bulkAssets.listByModelIds — batched per-model scans", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("returns assets across the requested models, org-scoped (no cross-org leak)", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const orgB = createId();
    const m1 = createId();
    const m2 = createId();
    const m3 = createId(); // not requested

    const a1 = createId();
    const a2 = createId();
    const aOtherModel = createId();
    const aForeign = createId();
    await convex.mutation(api.assets.createIfMissing, { id: a1, organizationId: orgA, modelId: m1, assetTag: "A1" });
    await convex.mutation(api.assets.createIfMissing, { id: a2, organizationId: orgA, modelId: m2, assetTag: "A2" });
    await convex.mutation(api.assets.createIfMissing, { id: aOtherModel, organizationId: orgA, modelId: m3, assetTag: "A3" });
    // same requested model m1, but a DIFFERENT org — must be excluded.
    await convex.mutation(api.assets.createIfMissing, { id: aForeign, organizationId: orgB, modelId: m1, assetTag: "AF" });

    const res = await convex.query(api.assets.listByModelIds, { orgId: orgA, modelIds: [m1, m2] });
    const ids = res.map((a) => a.id).sort();
    expect(ids).toEqual([a1, a2].sort());
    expect(res.some((a) => a.id === aForeign)).toBe(false); // cross-org excluded
    expect(res.some((a) => a.id === aOtherModel)).toBe(false); // unrequested model excluded
  });

  it("bulkAssets.listByModelIds groups bulk assets by the requested models", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const m1 = createId();
    const b1 = createId();
    await convex.mutation(api.bulkAssets.createIfMissing, { id: b1, organizationId: orgA, modelId: m1, assetTag: "B1" });

    const res = await convex.query(api.bulkAssets.listByModelIds, { orgId: orgA, modelIds: [m1] });
    expect(res.map((b) => b.id)).toEqual([b1]);
  });
});
