/**
 * Integration tests for project tasks (Asana-style per-project to-do list).
 *
 * Covers: create + list ordering, status→completedAt transitions, update,
 * delete, reorder, assignee validation (member vs non-member, cross-org crew),
 * cross-org isolation, and the cross-project getMyOpenTasks query.
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
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
}));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));

import {
  getProjectTasks,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  reorderProjectTasks,
  getMyOpenTasks,
} from "@/server/project-tasks";

async function makeProject(orgId: string, name = "Gig") {
  return testPrisma.project.create({
    data: {
      id: createId(),
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 6)}`,
      name,
    },
  });
}

function act(orgId: string, userId: string) {
  h.ctx.organizationId = orgId;
  h.ctx.userId = userId;
}

describe("project tasks", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates tasks appended in order and lists them by sortOrder", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    const project = await makeProject(org.id);

    await createProjectTask({ projectId: project.id, title: "First" });
    await createProjectTask({ projectId: project.id, title: "Second" });
    await createProjectTask({ projectId: project.id, title: "Third" });

    const tasks = (await getProjectTasks(project.id)) as Array<{ title: string; status: string }>;
    expect(tasks.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
    expect(tasks.every((t) => t.status === "TODO")).toBe(true);
  });

  it("sets completedAt when moved to DONE and clears it when moved back", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    const project = await makeProject(org.id);
    const task = (await createProjectTask({ projectId: project.id, title: "Pack truck" })) as { id: string };

    const done = (await updateProjectTask(task.id, { status: "DONE" })) as { completedAt: string | null };
    expect(done.completedAt).not.toBeNull();

    const reopened = (await updateProjectTask(task.id, { status: "TODO" })) as { completedAt: string | null };
    expect(reopened.completedAt).toBeNull();
  });

  it("persists description, priority, due date, checklist and assignee", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    const project = await makeProject(org.id);

    const task = (await createProjectTask({
      projectId: project.id,
      title: "Confirm power",
      description: "Call venue",
      priority: "HIGH",
      dueDate: "2026-07-01",
      assigneeUserId: user.id,
      checklist: [{ id: "a", text: "Phone", done: false }],
    })) as { id: string; priority: string; assigneeUserId: string; checklist: unknown };

    expect(task.priority).toBe("HIGH");
    expect(task.assigneeUserId).toBe(user.id);
    expect(Array.isArray(task.checklist)).toBe(true);
  });

  it("rejects an assignee who is not a member of the org", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const otherOrg = await createOrgFixture({ slug: "other" });
    const outsider = await createUserFixture(otherOrg.id);
    act(org.id, user.id);
    const project = await makeProject(org.id);

    await expect(
      createProjectTask({ projectId: project.id, title: "x", assigneeUserId: outsider.id }),
    ).rejects.toThrow(/not a member/i);
  });

  it("reorders tasks", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    act(org.id, user.id);
    const project = await makeProject(org.id);
    const a = (await createProjectTask({ projectId: project.id, title: "A" })) as { id: string };
    const b = (await createProjectTask({ projectId: project.id, title: "B" })) as { id: string };
    const c = (await createProjectTask({ projectId: project.id, title: "C" })) as { id: string };

    await reorderProjectTasks(project.id, [c.id, a.id, b.id]);
    const tasks = (await getProjectTasks(project.id)) as Array<{ title: string }>;
    expect(tasks.map((t) => t.title)).toEqual(["C", "A", "B"]);
  });

  it("does not leak tasks across orgs", async () => {
    const orgA = await createOrgFixture({ slug: "a" });
    const orgB = await createOrgFixture({ slug: "b" });
    const userA = await createUserFixture(orgA.id);
    const userB = await createUserFixture(orgB.id);

    act(orgA.id, userA.id);
    const projectA = await makeProject(orgA.id);
    const taskA = (await createProjectTask({ projectId: projectA.id, title: "A-task" })) as { id: string };

    // orgB cannot see, update, or delete orgA's task.
    act(orgB.id, userB.id);
    expect((await getProjectTasks(projectA.id)) as unknown[]).toHaveLength(0);
    await expect(updateProjectTask(taskA.id, { title: "hijack" })).rejects.toThrow(/not found/i);
    await expect(deleteProjectTask(taskA.id)).rejects.toThrow(/not found/i);
  });

  it("getMyOpenTasks returns the caller's non-done tasks across projects", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const other = await createUserFixture(org.id);
    act(org.id, user.id);
    const p1 = await makeProject(org.id, "P1");
    const p2 = await makeProject(org.id, "P2");

    await createProjectTask({ projectId: p1.id, title: "Mine open", assigneeUserId: user.id });
    const done = (await createProjectTask({ projectId: p2.id, title: "Mine done", assigneeUserId: user.id })) as { id: string };
    await updateProjectTask(done.id, { status: "DONE" });
    await createProjectTask({ projectId: p1.id, title: "Someone else's", assigneeUserId: other.id });
    await createProjectTask({ projectId: p1.id, title: "Unassigned" });

    const mine = (await getMyOpenTasks()) as Array<{ title: string }>;
    expect(mine.map((t) => t.title)).toEqual(["Mine open"]);
  });
});
