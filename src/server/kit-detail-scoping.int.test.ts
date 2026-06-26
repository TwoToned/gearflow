/**
 * Parity / scoping test for the entity-scoped getKit rewrite (finding #2, T-C).
 *
 * getKit used to read the WHOLE org's serialized items / bulk items / asset
 * registry / bulk assets / scan logs / projects and JS-filter to the kit. It now
 * reads each scoped to the kit (listByKitId / listByIds). The property to lock in:
 * the composite returns EXACTLY this kit's members (with their assets + models
 * attached) and unrelated same-org data (another kit's members/assets) never
 * leaks in — i.e. scoping changed which rows are read, not the output.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "tester", userName: "Tester" } }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
  requireOrganization: async () => ({ organizationId: h.ctx.organizationId, session: {} }),
}));

import { getKit } from "@/server/kits";

describe("getKit — entity-scoped reads (no cross-kit leak)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("returns ONLY this kit's members with assets+models attached; ignores other kits", async () => {
    const orgA = createId();
    h.ctx.organizationId = orgA;
    const convex = await getConvexClient();
    const modelId = createId();
    const userId = createId();
    await convex.mutation(api.models.createIfMissing, { id: modelId, organizationId: orgA, name: "M" });

    // Our kit: one serialized member (asset a1) + one bulk member (bulkAsset b1).
    const kitId = createId();
    const a1 = createId();
    const b1 = createId();
    await convex.mutation(api.kits.createIfMissing, { id: kitId, organizationId: orgA, assetTag: "KIT-1", name: "Kit One" });
    await convex.mutation(api.assets.createIfMissing, { id: a1, organizationId: orgA, modelId, assetTag: "A1" });
    await convex.mutation(api.bulkAssets.createIfMissing, { id: b1, organizationId: orgA, modelId, assetTag: "B1" });
    await convex.mutation(api.kitSerializedItems.createIfMissing, { id: createId(), organizationId: orgA, kitId, assetId: a1, addedById: userId });
    await convex.mutation(api.kitBulkItems.createIfMissing, { id: createId(), organizationId: orgA, kitId, bulkAssetId: b1, quantity: 2, addedById: userId });

    // Unrelated SAME-ORG kit with its own member + asset — must not leak in.
    const otherKit = createId();
    const aOther = createId();
    await convex.mutation(api.kits.createIfMissing, { id: otherKit, organizationId: orgA, assetTag: "KIT-2", name: "Kit Two" });
    await convex.mutation(api.assets.createIfMissing, { id: aOther, organizationId: orgA, modelId, assetTag: "A-OTHER" });
    await convex.mutation(api.kitSerializedItems.createIfMissing, { id: createId(), organizationId: orgA, kitId: otherKit, assetId: aOther, addedById: userId });

    const kit = (await getKit(kitId)) as {
      serializedItems: Array<{ assetId: string; asset: { id: string; model: { id: string } | null } }>;
      bulkItems: Array<{ bulkAssetId: string; bulkAsset: { id: string } }>;
    } | null;

    expect(kit).not.toBeNull();
    // exactly our serialized member, with asset + model attached
    expect(kit!.serializedItems).toHaveLength(1);
    expect(kit!.serializedItems[0].assetId).toBe(a1);
    expect(kit!.serializedItems[0].asset.id).toBe(a1);
    expect(kit!.serializedItems[0].asset.model?.id).toBe(modelId);
    // exactly our bulk member
    expect(kit!.bulkItems).toHaveLength(1);
    expect(kit!.bulkItems[0].bulkAssetId).toBe(b1);
    // the other kit's asset must not appear among members
    expect(kit!.serializedItems.some((s) => s.assetId === aOther)).toBe(false);
  });
});
