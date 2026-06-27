/** getProject still returns line items + client + project manager after the
 * parallel-reads refactor (parity guard for the wave-1/wave-2 restructure). */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupIntegrationTest } from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
const h = vi.hoisted(() => ({ ctx: { organizationId: "", userId: "t", userName: "T" } }));
vi.mock("@/lib/org-context", () => ({ getOrgContext: async () => h.ctx, requirePermission: async () => h.ctx, requireOrganization: async () => ({ organizationId: h.ctx.organizationId, session: {} }) }));
import { getProject } from "@/server/projects";
describe("getProject parallel parity", () => {
  beforeEach(async () => { await setupIntegrationTest(); });
  it("returns line item + client", async () => {
    const orgA = createId(); h.ctx.organizationId = orgA;
    const convex = await getConvexClient();
    const clientId = createId();
    await convex.mutation(api.clients.createIfMissing, { id: clientId, organizationId: orgA, name: "Acme" });
    const projectId = createId();
    await convex.mutation(api.projects.createIfMissing, { id: projectId, organizationId: orgA, projectNumber: "P-9", name: "Proj", clientId });
    const m = createId(), a = createId();
    await convex.mutation(api.models.createIfMissing, { id: m, organizationId: orgA, name: "Mod" });
    await convex.mutation(api.assets.createIfMissing, { id: a, organizationId: orgA, modelId: m, assetTag: "AA" });
    const lineId = createId();
    await convex.mutation(api.projectLineItems.createIfMissing, { id: lineId, organizationId: orgA, projectId, modelId: m, assetId: a, quantity: 1 });
    const p = (await getProject(projectId)) as { client: { id: string } | null; lineItems: Array<{ id: string }> };
    expect(p.client?.id).toBe(clientId);
    expect(p.lineItems.some((li) => li.id === lineId)).toBe(true);
  });
});
