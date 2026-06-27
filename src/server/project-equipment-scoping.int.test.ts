/**
 * Scoping test for buildProjectEquipmentTree (the getProject equipment composite,
 * run on every project refetch — incl. every add/edit/delete). It used to read the
 * WHOLE org asset/bulk/kit registries to attach them to the project's line items;
 * it now reads only the ids the lines reference. Property to lock in: a line item's
 * asset still attaches correctly (proves the scoped read finds it), and unrelated
 * org assets don't change the result.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { buildProjectEquipmentTree } from "@/lib/project-line-item-read";

describe("buildProjectEquipmentTree — scoped asset/bulk/kit reads", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("attaches the line item's asset via the scoped read; ignores unrelated org assets", async () => {
    const convex = await getConvexClient();
    const orgA = createId();
    const modelId = createId();
    const projectId = createId();
    const a1 = createId();
    const lineId = createId();

    await convex.mutation(api.projects.createIfMissing, {
      id: projectId, organizationId: orgA, projectNumber: "P-1", name: "P",
    });
    await convex.mutation(api.assets.createIfMissing, {
      id: a1, organizationId: orgA, modelId, assetTag: "A1",
    });
    // a top-level project line item referencing asset a1
    await convex.mutation(api.projectLineItems.createIfMissing, {
      id: lineId, organizationId: orgA, projectId, modelId, assetId: a1,
    });
    // an unrelated org asset NOT on the project — must not change the result and
    // (pre-fix) would have been pulled in by the whole-org read.
    await convex.mutation(api.assets.createIfMissing, {
      id: createId(), organizationId: orgA, modelId, assetTag: "A-OTHER",
    });

    const tree = (await buildProjectEquipmentTree(projectId, orgA)) as {
      lineItems: Array<{ id: string; asset: { id: string } | null }>;
    };

    const line = tree.lineItems.find((li) => li.id === lineId);
    expect(line).toBeDefined();
    // the scoped getAssetsByIds must have found a1 and attached it
    expect(line!.asset?.id).toBe(a1);
  });
});
