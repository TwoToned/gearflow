import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({ query }),
  withConvexReadRetry: async <T,>(fn: () => Promise<T>) => fn(),
}));

import { getProjectServicesForVersion } from "./project-services-read";

describe("getProjectServicesForVersion", () => {
  beforeEach(() => query.mockReset());

  // Regression: quote PDFs listed every service twice on a multi-version
  // project, because they read the org-wide list (one copy of each service per
  // version) and filtered by projectId only.
  it("reads ONE project's services for ONE version, not the org-wide list", async () => {
    query.mockResolvedValue([{ id: "s1" }]);
    const rows = await getProjectServicesForVersion("org_1", "p1", "v2");
    expect(rows).toEqual([{ id: "s1" }]);
    expect(query).toHaveBeenCalledTimes(1);
    const [, args] = query.mock.calls[0];
    expect(args).toEqual({ orgId: "org_1", projectId: "p1", versionId: "v2" });
  });

  it("omits versionId to mean the live version", async () => {
    query.mockResolvedValue([]);
    await getProjectServicesForVersion("org_1", "p1");
    const [, args] = query.mock.calls[0];
    expect(args.versionId).toBeUndefined();
  });
});
