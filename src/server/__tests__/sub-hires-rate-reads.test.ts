import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, getOrgContext, query } = vi.hoisted(() => ({ requirePermission: vi.fn(), getOrgContext: vi.fn(), query: vi.fn() }));

vi.mock("@/lib/org-context", () => ({ requirePermission, getOrgContext }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: async () => ({ query }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/media-write", () => ({}));
vi.mock("@/lib/media-read", () => ({}));
vi.mock("@/lib/sub-hire-read", () => ({}));
vi.mock("@/lib/suppliers-read", () => ({ attachSupplier: async (_o: string, r: unknown) => r, getMatchingSupplierIds: vi.fn(), getSupplierById: vi.fn() }));
vi.mock("@/lib/models-read", () => ({}));
vi.mock("@/lib/projects-read", () => ({}));

import { getSupplierModelRate, getSupplierRateHistory } from "../sub-hires";

// Cached supplier cost rates are cost data: a member without subHire:read (e.g. a custom role)
// must not read them, and the Convex query is scoped to the org the permission check resolved.
describe("supplier rate reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue([]);
  });

  it("are refused, touching nothing, when the role has no subHire read", async () => {
    requirePermission.mockRejectedValue(new Error("Forbidden"));
    await expect(getSupplierRateHistory("m1")).rejects.toThrow("Forbidden");
    await expect(getSupplierModelRate("s1", "m1")).rejects.toThrow("Forbidden");
    expect(requirePermission).toHaveBeenCalledWith("subHire", "read");
    expect(query).not.toHaveBeenCalled();
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("read with the caller's own org, never an argument", async () => {
    requirePermission.mockResolvedValue({ organizationId: "org_1" });
    await getSupplierRateHistory("m1");
    expect(query).toHaveBeenCalledWith(expect.anything(), { organizationId: "org_1", modelId: "m1" });
  });
});
