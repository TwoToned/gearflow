/**
 * Integration tests for the additive by-entity Convex queries that let the
 * getKit/getAsset composites read entity-scoped data instead of whole-org
 * `.collect()`s (finding #2 groundwork). These queries are NOT wired into the
 * composites yet — this PR only ships them additively, so the safety property
 * to lock in now is: each returns the right rows AND never leaks across orgs.
 *
 * Two representative shapes are covered (the other four are structurally
 * identical): `listByIds` (batch point-read + org filter) via assets.listByIds,
 * and `listByKitId` (by_kitId index + org filter) via kitSerializedItems.
 * Self-contained: synthetic org/kit ids, asserts only on its own rows.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

describe("scoped by-entity Convex queries (#2 groundwork)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("assets.listByIds returns requested in-org assets, drops cross-org + unknown ids", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const orgB = createId();
    const modelId = createId();
    const a1 = createId();
    const a2 = createId();
    const bForeign = createId();

    for (const [id, org, tag] of [
      [a1, orgA, "A1"],
      [a2, orgA, "A2"],
      [bForeign, orgB, "B1"],
    ] as const) {
      await convex.mutation(api.assets.createIfMissing, {
        id,
        organizationId: org,
        modelId,
        assetTag: tag,
      });
    }

    const res = await convex.query(api.assets.listByIds, {
      orgId: orgA,
      ids: [a1, a2, bForeign, createId()],
    });

    expect(res.map((d) => d.id).sort()).toEqual([a1, a2].sort());
    // cross-org id present in the request must NOT be returned
    expect(res.some((d) => d.id === bForeign)).toBe(false);
  });

  it("kitSerializedItems.listByKitId returns only this kit's items, org-filtered", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const kitId = createId();
    const otherKit = createId();
    const addedById = createId();
    const m1 = createId();
    const m2 = createId();

    await convex.mutation(api.kitSerializedItems.createIfMissing, {
      id: m1,
      organizationId: orgA,
      kitId,
      assetId: createId(),
      addedById,
    });
    // same org, DIFFERENT kit — must not appear
    await convex.mutation(api.kitSerializedItems.createIfMissing, {
      id: m2,
      organizationId: orgA,
      kitId: otherKit,
      assetId: createId(),
      addedById,
    });

    const res = await convex.query(api.kitSerializedItems.listByKitId, {
      orgId: orgA,
      kitId,
    });
    expect(res.map((d) => d.id)).toEqual([m1]);

    // same kitId but a DIFFERENT org must return nothing (no cross-org leak)
    const otherOrg = await convex.query(api.kitSerializedItems.listByKitId, {
      orgId: createId(),
      kitId,
    });
    expect(otherOrg).toEqual([]);
  });
});
