/**
 * Integration tests for the scoped reads that replaced whole-org `.list()` +
 * a per-unit N+1 in the add/update-line-item double-booking checks (the
 * "adding an item takes a minute / hundreds of Convex calls" fix):
 *   - projectLineItems.listByModelId
 *   - projectLineItemUnits.listByOrgAndAsset
 * Both must return the same rows the old whole-org-collect-then-filter did, and
 * never leak across orgs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

describe("line-item scoped reads", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("projectLineItems.listByModelId returns only this model's lines, org-scoped", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const orgB = createId();
    const m1 = createId();
    const m2 = createId();
    const projectId = createId();
    const l1 = createId();
    const l2 = createId();
    await convex.mutation(api.projectLineItems.createIfMissing, { id: l1, organizationId: orgA, projectId, modelId: m1 });
    await convex.mutation(api.projectLineItems.createIfMissing, { id: l2, organizationId: orgA, projectId, modelId: m2 });
    // same model m1 but a different org — must be excluded.
    await convex.mutation(api.projectLineItems.createIfMissing, { id: createId(), organizationId: orgB, projectId, modelId: m1 });

    const res = await convex.query(api.projectLineItems.listByModelId, { modelId: m1, orgId: orgA });
    expect(res.map((r) => r.id)).toEqual([l1]);
  });

  it("projectLineItemUnits.listByOrgAndAsset returns only this asset's units (all statuses), org-scoped", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const orgB = createId();
    const asset = createId();
    const lineItemId = createId();
    const u1 = createId();
    const u2 = createId();
    // two units of `asset` in orgA, different statuses
    await convex.mutation(api.projectLineItemUnits.createIfMissing, { id: u1, organizationId: orgA, lineItemId, ordinal: 0, assetId: asset, status: "CHECKED_OUT" });
    await convex.mutation(api.projectLineItemUnits.createIfMissing, { id: u2, organizationId: orgA, lineItemId, ordinal: 1, assetId: asset, status: "RETURNED" });
    // a different asset, and a cross-org unit on the same asset — both excluded.
    await convex.mutation(api.projectLineItemUnits.createIfMissing, { id: createId(), organizationId: orgA, lineItemId, ordinal: 2, assetId: createId(), status: "CHECKED_OUT" });
    await convex.mutation(api.projectLineItemUnits.createIfMissing, { id: createId(), organizationId: orgB, lineItemId, ordinal: 0, assetId: asset, status: "CHECKED_OUT" });

    const res = await convex.query(api.projectLineItemUnits.listByOrgAndAsset, { orgId: orgA, assetId: asset });
    expect(res.map((r) => r.id).sort()).toEqual([u1, u2].sort());
  });
});
