/**
 * Integration tests for /asset fault (test plan #7) against a real Postgres. The
 * marquee case: a freelancer CrewMember with NO platform User must not 500 on the
 * required createdById FK. Plus severity mapping, the guarded status flip, and
 * idempotency.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../../../tests/helpers/integration";
import { reportAssetFault } from "./asset-fault-service";
import type { ServiceActor } from "./discord-actor";

async function freelancer(orgId: string): Promise<ServiceActor> {
  const cm = await testPrisma.crewMember.create({
    data: { organizationId: orgId, firstName: "Free", lastName: "Lance" },
  });
  return { organizationId: orgId, crewMemberId: cm.id, userId: null, userName: "Free Lance", role: "viewer", discordUserId: "d1" };
}

async function manager(orgId: string): Promise<ServiceActor> {
  const user = await createUserFixture(orgId, "admin"); // admin → maintenance:create
  const cm = await testPrisma.crewMember.create({
    data: { organizationId: orgId, firstName: "Man", lastName: "Ager", userId: user.id },
  });
  return { organizationId: orgId, crewMemberId: cm.id, userId: user.id, userName: "Man Ager", role: "admin", discordUserId: "d2" };
}

describe("reportAssetFault (integration)", () => {
  let orgId: string;
  let ownerUserId: string;
  let assetId: string;

  beforeEach(async () => {
    await setupIntegrationTest();
    orgId = (await createOrgFixture()).id;
    const owner = await createUserFixture(orgId, "owner"); // the system actor fallback
    ownerUserId = owner.id;
    const model = await createModelFixture(orgId);
    assetId = (await createAssetFixture(orgId, model.id, { assetTag: "TTP-042", status: "AVAILABLE" })).id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("does not 500 for a freelancer with no User — attributes to the system actor + records the reporter", async () => {
    const actor = await freelancer(orgId);
    const res = await reportAssetFault(actor, { code: "TTP-042", description: "Cracked housing", severity: "MINOR", holdForRepair: false }, testPrisma);
    expect(res.statusChanged).toBe(false);

    const event = await testPrisma.damageEvent.findUnique({ where: { id: res.damageEventId } });
    expect(event?.createdById).toBe(ownerUserId); // system actor satisfies the required FK
    expect(event?.reportedByCrewMemberId).toBe(actor.crewMemberId); // true reporter preserved
    expect(event?.severity).toBe("MINOR");

    // Audit row writes cleanly (userId FK = the system actor, not a bogus "system").
    expect(await testPrisma.activityLog.count({ where: { entityId: res.damageEventId } })).toBe(1);
  });

  it("flips an AVAILABLE asset to IN_MAINTENANCE on holdForRepair (privileged)", async () => {
    const actor = await manager(orgId);
    const res = await reportAssetFault(actor, { code: "TTP-042", description: "Won't power on", severity: "MAJOR", holdForRepair: true }, testPrisma);
    expect(res).toMatchObject({ statusChanged: true, newStatus: "IN_MAINTENANCE" });
    const asset = await testPrisma.asset.findUnique({ where: { id: assetId } });
    expect(asset?.status).toBe("IN_MAINTENANCE");
  });

  it("does NOT clobber a CHECKED_OUT asset, but still logs the fault", async () => {
    await testPrisma.asset.update({ where: { id: assetId }, data: { status: "CHECKED_OUT" } });
    const actor = await manager(orgId);
    const res = await reportAssetFault(actor, { code: "TTP-042", description: "Damaged on site", severity: "MAJOR", holdForRepair: true }, testPrisma);
    expect(res.statusChanged).toBe(false);
    const asset = await testPrisma.asset.findUnique({ where: { id: assetId } });
    expect(asset?.status).toBe("CHECKED_OUT"); // untouched
    expect(await testPrisma.damageEvent.count({ where: { assetId } })).toBe(1); // fault still recorded
  });

  it("is idempotent on the interaction id — a retry creates no second event", async () => {
    const actor = await freelancer(orgId);
    const input = { code: "TTP-042", description: "Buzzing", severity: "MINOR" as const, holdForRepair: false, idempotencyKey: "interaction-99" };
    const first = await reportAssetFault(actor, input, testPrisma);
    const second = await reportAssetFault(actor, input, testPrisma);
    expect(first.damageEventId).toBe(second.damageEventId);
    expect(second.idempotentReplay).toBe(true);
    expect(await testPrisma.damageEvent.count({ where: { assetId } })).toBe(1);
  });

  it("denies the status flip to a low-privilege reporter and writes nothing", async () => {
    const actor = await freelancer(orgId); // viewer baseline — no maintenance:create
    await expect(
      reportAssetFault(actor, { code: "TTP-042", description: "Broken", severity: "MAJOR", holdForRepair: true }, testPrisma),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await testPrisma.damageEvent.count({ where: { assetId } })).toBe(0);
  });
});
