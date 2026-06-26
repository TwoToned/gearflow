/**
 * Parity / scoping test for the entity-scoped getAsset rewrite (finding #2, T-D).
 *
 * getAsset used to call getProjectsByOrg (every project in the org) just to build
 * a lookup map for attaching projects to the asset's ≤20 line items. It now fetches
 * only the projects those line items reference (projects.listByIds). Property to
 * lock in: a line item still gets its project attached correctly, and an unrelated
 * org project is simply not needed — output is unchanged.
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

import { getAsset } from "@/server/assets";

describe("getAsset — entity-scoped project reads", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("attaches the line item's referenced project (via scoped listByIds)", async () => {
    const orgA = createId();
    h.ctx.organizationId = orgA;
    const convex = await getConvexClient();
    const modelId = createId();
    await convex.mutation(api.models.createIfMissing, { id: modelId, organizationId: orgA, name: "M" });

    const assetId = createId();
    await convex.mutation(api.assets.createIfMissing, { id: assetId, organizationId: orgA, modelId, assetTag: "A1" });

    const projectId = createId();
    await convex.mutation(api.projects.createIfMissing, {
      id: projectId,
      organizationId: orgA,
      projectNumber: "P-100",
      name: "Project One",
    });
    // an UNRELATED org project the asset never references — old code fetched it
    // (whole-org), new code does not need it; either way it must not appear.
    await convex.mutation(api.projects.createIfMissing, {
      id: createId(),
      organizationId: orgA,
      projectNumber: "P-999",
      name: "Unrelated",
    });

    await convex.mutation(api.projectLineItems.createIfMissing, {
      id: createId(),
      organizationId: orgA,
      projectId,
      assetId,
      createdAt: Date.now(),
    });

    const asset = (await getAsset(assetId)) as {
      lineItems: Array<{ projectId: string | null; project: { projectNumber: string; name: string } }>;
    } | null;

    expect(asset).not.toBeNull();
    expect(asset!.lineItems).toHaveLength(1);
    expect(asset!.lineItems[0].projectId).toBe(projectId);
    expect(asset!.lineItems[0].project.projectNumber).toBe("P-100");
    expect(asset!.lineItems[0].project.name).toBe("Project One");
  });
});
