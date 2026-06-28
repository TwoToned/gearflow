// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";

const SERVICE = { subject: "gearflow-service", svc: true };
const asUser = (orgId: string | null) => ({ subject: USER, ...(orgId ? { orgId } : {}) });

async function seedViewerAndProject(t: ReturnType<typeof convexTest>, projOrg = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("projects", {
      id: "p1",
      organizationId: projOrg,
      projectNumber: "P-1",
      name: "Test Project",
    });
  });
}

describe("projectDetail.bundle — auth gating", () => {
  test("denies anonymous", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.projectDetail.bundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/authentication required/i);
  });

  test("denies a non-member", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.withIdentity(asUser(ORG)).query(api.projectDetail.bundle, { projectId: "p1", orgId: ORG }),
    ).rejects.toThrow(/not a member/i);
  });

  test("allows a viewer (project:read) and returns the project-detail shape", async () => {
    const t = convexTest(schema, modules);
    await seedViewerAndProject(t);
    const res = await t
      .withIdentity(asUser(ORG))
      .query(api.projectDetail.bundle, { projectId: "p1", orgId: ORG });
    expect(res).not.toBeNull();
    expect(res!.project.id).toBe("p1");
    expect(res).toHaveProperty("projectManagers");
    expect(res).toHaveProperty("managerUsers");
    expect(res).toHaveProperty("media");
    expect(res).toHaveProperty("client");
    expect(res).toHaveProperty("location");
  });

  test("returns null for a project in a different org (doc org-scope)", async () => {
    const t = convexTest(schema, modules);
    // Member of ORG, but the project belongs to another org.
    await seedViewerAndProject(t, "org_other");
    const res = await t
      .withIdentity(asUser(ORG))
      .query(api.projectDetail.bundle, { projectId: "p1", orgId: ORG });
    expect(res).toBeNull();
  });

  test("service identity is allowed", async () => {
    const t = convexTest(schema, modules);
    const res = await t
      .withIdentity(SERVICE)
      .query(api.projectDetail.bundle, { projectId: "missing", orgId: ORG });
    expect(res).toBeNull(); // auth passed; project simply absent
  });
});
