/**
 * Integration parity tests for setProjectManagers — proves the batched
 * "set managers to exactly this set" action produces the same Convex rows as the
 * old add/removeProjectManager fan-out loop, plus validation + idempotency.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => h.ctx,
  getOrgContext: async () => h.ctx,
}));

import {
  addProjectManager,
  removeProjectManager,
  setProjectManagers,
} from "@/server/project-managers";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0,
    },
  });
}

async function managerUserIds(projectId: string, orgId: string) {
  const convex = await getConvexClient();
  const rows = await convex.query(api.projectManagers.listByProject, { projectId, orgId });
  return rows.map((r) => r.userId).sort();
}

describe("setProjectManagers — parity with the add/remove fan-out", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("batched set == the per-manager add/remove loop", async () => {
    const org = await createOrgFixture();
    const actor = await createUserFixture(org.id, "owner");
    const u1 = await createUserFixture(org.id);
    const u2 = await createUserFixture(org.id);
    const u3 = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: actor.id, userName: "Tester" };

    // Scenario A — old fan-out: seed {u1,u2}, then edit to {u1,u3}.
    const projA = await createProjectFixture(org.id);
    await addProjectManager(projA.id, u1.id);
    await addProjectManager(projA.id, u2.id);
    await addProjectManager(projA.id, u3.id);
    await removeProjectManager(projA.id, u2.id);

    // Scenario B — batch: set {u1,u2} then set {u1,u3}.
    const projB = await createProjectFixture(org.id);
    await setProjectManagers(projB.id, [u1.id, u2.id]);
    await setProjectManagers(projB.id, [u1.id, u3.id]);

    const a = await managerUserIds(projA.id, org.id);
    const b = await managerUserIds(projB.id, org.id);
    expect(b).toEqual(a);
    expect(b).toEqual([u1.id, u3.id].sort());
  });

  it("create-mode: setting from empty adds exactly the selected set", async () => {
    const org = await createOrgFixture();
    const actor = await createUserFixture(org.id, "owner");
    const u1 = await createUserFixture(org.id);
    const u2 = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: actor.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    await setProjectManagers(project.id, [u1.id, u2.id]);

    expect(await managerUserIds(project.id, org.id)).toEqual([u1.id, u2.id].sort());
  });

  it("idempotent: setting the same set twice makes no change and no duplicates", async () => {
    const org = await createOrgFixture();
    const actor = await createUserFixture(org.id, "owner");
    const u1 = await createUserFixture(org.id);
    h.ctx = { organizationId: org.id, userId: actor.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    await setProjectManagers(project.id, [u1.id]);
    await setProjectManagers(project.id, [u1.id]);

    const convex = await getConvexClient();
    const rows = await convex.query(api.projectManagers.listByProject, {
      projectId: project.id,
      orgId: org.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(u1.id);
  });

  it("rejects a non-member and writes nothing", async () => {
    const org = await createOrgFixture();
    const actor = await createUserFixture(org.id, "owner");
    const otherOrg = await createOrgFixture();
    const outsider = await createUserFixture(otherOrg.id); // member of a DIFFERENT org
    h.ctx = { organizationId: org.id, userId: actor.id, userName: "Tester" };

    const project = await createProjectFixture(org.id);
    await expect(setProjectManagers(project.id, [outsider.id])).rejects.toThrow(
      /not a member/i,
    );
    expect(await managerUserIds(project.id, org.id)).toEqual([]);
  });
});
