/**
 * Integration tests for the user-centric home query (getMyHomeData): returns the
 * active user's managed projects via BOTH the single projectManagerId and the
 * ProjectManager join, excludes projects managed by others and finished projects.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Casey Manager" },
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
}));

import { getMyHomeData } from "@/server/dashboard";

async function makeProject(
  orgId: string,
  opts: { name: string; status?: string; pmId?: string; start?: Date },
) {
  return testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name: opts.name,
      status: (opts.status as never) ?? "CONFIRMED",
      projectManagerId: opts.pmId ?? null,
      rentalStartDate: opts.start ?? null,
    },
  });
}

describe("getMyHomeData", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns projects I manage (single PM + join), excludes others' and finished", async () => {
    const org = await createOrgFixture();
    const me = await createUserFixture(org.id);
    const other = await createUserFixture(org.id);
    h.ctx.organizationId = org.id;
    h.ctx.userId = me.id;

    // Mine via projectManagerId (earlier start → first)
    const p1 = await makeProject(org.id, { name: "Mine (PM field)", pmId: me.id, start: new Date("2026-07-01") });
    // Mine via the ProjectManager join (later start → second)
    const p2 = await makeProject(org.id, { name: "Mine (join)", start: new Date("2026-08-01") });
    await testPrisma.projectManager.create({
      data: { id: createId(), organizationId: org.id, projectId: p2.id, userId: me.id },
    });
    // Someone else's
    await makeProject(org.id, { name: "Theirs", pmId: other.id });
    // Mine but completed → excluded
    await makeProject(org.id, { name: "Mine but done", pmId: me.id, status: "COMPLETED" });

    const data = (await getMyHomeData()) as {
      userName: string;
      myProjects: Array<{ id: string; name: string }>;
    };

    expect(data.userName).toBe("Casey Manager");
    expect(data.myProjects.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it("sorts dated projects before undated ones (NULL starts last)", async () => {
    const org = await createOrgFixture();
    const me = await createUserFixture(org.id);
    h.ctx.organizationId = org.id;
    h.ctx.userId = me.id;

    const undated = await makeProject(org.id, { name: "Undated enquiry", pmId: me.id });
    const dated = await makeProject(org.id, { name: "Dated", pmId: me.id, start: new Date("2026-09-01") });

    const data = (await getMyHomeData()) as { myProjects: Array<{ id: string }> };
    // The dated project must come first even though it was created after the undated one.
    expect(data.myProjects.map((p) => p.id)).toEqual([dated.id, undated.id]);
  });

  it("returns an empty list when the user manages nothing", async () => {
    const org = await createOrgFixture();
    const me = await createUserFixture(org.id);
    const other = await createUserFixture(org.id);
    h.ctx.organizationId = org.id;
    h.ctx.userId = me.id;
    await makeProject(org.id, { name: "Theirs", pmId: other.id });

    const data = (await getMyHomeData()) as { myProjects: unknown[] };
    expect(data.myProjects).toHaveLength(0);
  });
});
