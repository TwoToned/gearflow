/**
 * Integration tests for channel-sync source-of-truth fns (test plan #6) against a
 * real Postgres: discordChannelId idempotency guard, linked vs pending members,
 * template exclusion, and retroactive grant resolution after a late link.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, setupIntegrationTest, createOrgFixture } from "../../../tests/helpers/integration";
import {
  getProjectChannelSpec,
  recordProjectChannelId,
  getCrewActiveProjects,
} from "./channel-sync-service";

async function project(orgId: string, overrides?: { isTemplate?: boolean; status?: "CONFIRMED" | "COMPLETED" }) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `TTP-${Math.floor(Math.random() * 1e9)}`,
      name: "Pippin",
      isTemplate: overrides?.isTemplate ?? false,
      status: overrides?.status ?? "CONFIRMED",
    },
  });
}

async function crew(orgId: string, opts?: { discordUserId?: string }) {
  const cm = await testPrisma.crewMember.create({
    data: { organizationId: orgId, firstName: "Crew", lastName: "Member" },
  });
  if (opts?.discordUserId) {
    await testPrisma.discordAccountLink.create({
      data: { organizationId: orgId, crewMemberId: cm.id, discordUserId: opts.discordUserId },
    });
  }
  return cm;
}

function assign(orgId: string, projectId: string, crewMemberId: string) {
  return testPrisma.crewAssignment.create({ data: { organizationId: orgId, projectId, crewMemberId } });
}

describe("channel-sync source of truth (integration)", () => {
  let orgId: string;

  beforeEach(async () => {
    await setupIntegrationTest();
    orgId = (await createOrgFixture()).id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("recordProjectChannelId is an idempotency guard — first writer wins", async () => {
    const p = await project(orgId);
    const first = await recordProjectChannelId(p.id, orgId, "chan-A");
    expect(first).toEqual({ channelId: "chan-A", created: true });

    // A second (racing) create returns the existing id and reports created:false.
    const second = await recordProjectChannelId(p.id, orgId, "chan-B");
    expect(second).toEqual({ channelId: "chan-A", created: false });

    const fresh = await testPrisma.project.findUnique({ where: { id: p.id }, select: { discordChannelId: true } });
    expect(fresh?.discordChannelId).toBe("chan-A");
  });

  it("spec lists only linked crew as members and counts the unlinked as pending", async () => {
    const p = await project(orgId);
    const linked = await crew(orgId, { discordUserId: "alice" });
    const unlinked = await crew(orgId);
    await assign(orgId, p.id, linked.id);
    await assign(orgId, p.id, unlinked.id);

    const spec = await getProjectChannelSpec(p.id, orgId);
    expect(spec.members).toEqual(["alice"]);
    expect(spec.pendingCount).toBe(1);
    expect(spec.shouldArchive).toBe(false);
  });

  it("flags terminal projects for archive (status in channelArchiveOnStatuses)", async () => {
    const p = await project(orgId, { status: "COMPLETED" });
    const spec = await getProjectChannelSpec(p.id, orgId);
    expect(spec.shouldArchive).toBe(true);
    expect(spec.shouldExist).toBe(true);
  });

  it("throws PROJECT_NOT_FOUND for another org's project (org-scoped)", async () => {
    const otherOrg = (await createOrgFixture()).id;
    const p = await project(otherOrg);
    await expect(getProjectChannelSpec(p.id, orgId)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("resolves a late-linking crew member's active projects for retroactive grant", async () => {
    const active1 = await project(orgId);
    const active2 = await project(orgId);
    const done = await project(orgId, { status: "COMPLETED" });
    const template = await project(orgId, { isTemplate: true });
    const cm = await crew(orgId, { discordUserId: "alice" });
    await assign(orgId, active1.id, cm.id);
    await assign(orgId, active2.id, cm.id);
    await assign(orgId, done.id, cm.id);
    await assign(orgId, template.id, cm.id);

    const res = await getCrewActiveProjects(cm.id, orgId);
    expect(res.discordUserId).toBe("alice");
    expect(res.projectIds.sort()).toEqual([active1.id, active2.id].sort());
  });
});
