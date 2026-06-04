/**
 * Integration tests for transactional-outbox emission (test plan #1 — the single
 * point of the whole design): an event must NOT outlive a rolled-back parent txn,
 * and orgs without an enabled integration must not accumulate orphan rows.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, setupIntegrationTest, createOrgFixture } from "../../../tests/helpers/integration";
import { emitIfDiscordEnabled } from "./outbox-service";

async function enableDiscord(orgId: string) {
  await testPrisma.discordIntegration.create({
    data: { organizationId: orgId, isEnabled: true, signingSecret: "s" },
  });
}

function event(orgId: string, projectId: string) {
  return {
    organizationId: orgId,
    eventType: "project.created" as const,
    payload: { projectId, projectNumber: "TTP001", name: "Pippin", status: "ENQUIRY" },
    dedupeKey: `project.created:${projectId}`,
  };
}

describe("emitIfDiscordEnabled (integration)", () => {
  let orgId: string;

  beforeEach(async () => {
    await setupIntegrationTest();
    orgId = (await createOrgFixture()).id;
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("writes a row inside a committed txn when the integration is enabled", async () => {
    await enableDiscord(orgId);
    await testPrisma.$transaction(async (tx) => {
      const wrote = await emitIfDiscordEnabled(tx, event(orgId, "p1"));
      expect(wrote).toBe(true);
    });
    expect(await testPrisma.discordOutbox.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("writes NO row when the parent txn rolls back", async () => {
    await enableDiscord(orgId);
    await expect(
      testPrisma.$transaction(async (tx) => {
        await emitIfDiscordEnabled(tx, event(orgId, "p1"));
        throw new Error("boom"); // parent mutation fails after the emit
      }),
    ).rejects.toThrow("boom");
    expect(await testPrisma.discordOutbox.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("writes NO row when the org has no enabled integration", async () => {
    // No integration row at all.
    await testPrisma.$transaction(async (tx) => {
      expect(await emitIfDiscordEnabled(tx, event(orgId, "p1"))).toBe(false);
    });
    // Disabled integration.
    await testPrisma.discordIntegration.create({
      data: { organizationId: orgId, isEnabled: false, signingSecret: "s" },
    });
    await testPrisma.$transaction(async (tx) => {
      expect(await emitIfDiscordEnabled(tx, event(orgId, "p2"))).toBe(false);
    });
    expect(await testPrisma.discordOutbox.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("rejects a duplicate dedupeKey (unique constraint backs at-least-once safety)", async () => {
    await enableDiscord(orgId);
    await testPrisma.$transaction((tx) => emitIfDiscordEnabled(tx, event(orgId, "p1")));
    await expect(
      testPrisma.$transaction((tx) => emitIfDiscordEnabled(tx, event(orgId, "p1"))),
    ).rejects.toThrow();
    expect(await testPrisma.discordOutbox.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
