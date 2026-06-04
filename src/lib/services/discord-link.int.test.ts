/**
 * Integration tests for the hardened enrollment pipeline (test plan #5) against a
 * real Postgres: identity binding, single-use, expiry, durable rate-limit,
 * enumeration-constant response, null/cross-org email, and re-link rejection.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testPrisma, setupIntegrationTest, createOrgFixture } from "../../../tests/helpers/integration";
import { startDiscordLink, consumeDiscordLink } from "./discord-link-service";

const EMAIL = "crew@example.com";

async function seedOrg(opts?: { email?: string | null }) {
  const org = await createOrgFixture();
  await testPrisma.discordIntegration.create({
    data: { organizationId: org.id, isEnabled: true, signingSecret: "s", guildId: "g1" },
  });
  const crew = await testPrisma.crewMember.create({
    data: {
      organizationId: org.id,
      firstName: "Crew",
      lastName: "Member",
      email: opts?.email === undefined ? EMAIL : opts.email,
    },
  });
  return { orgId: org.id, crewId: crew.id };
}

/** Deterministic, unique tokens so multi-call tests don't collide on tokenHash. */
function tokenGen() {
  let n = 0;
  return () => `rawtoken-${n++}`;
}

describe("Discord enrollment pipeline (integration)", () => {
  let orgId: string;
  let crewId: string;

  beforeEach(async () => {
    await setupIntegrationTest();
    ({ orgId, crewId } = await seedOrg());
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("binds the invoker's Discord id and links it on consume", async () => {
    const sendEmail = async () => ({});
    await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { generateToken: () => "raw-A", sendEmail },
    );
    const res = await consumeDiscordLink("raw-A", testPrisma);
    expect(res).toEqual({ status: "linked", crewName: "Crew Member" });

    const link = await testPrisma.discordAccountLink.findFirst({ where: { organizationId: orgId } });
    expect(link?.discordUserId).toBe("alice"); // bound id — not click-time supplied
    expect(link?.crewMemberId).toBe(crewId);

    // discord.link.confirmed outbox event drives the retroactive channel grant.
    const events = await testPrisma.discordOutbox.findMany({ where: { organizationId: orgId } });
    expect(events.map((e) => e.eventType)).toContain("discord.link.confirmed");
  });

  it("is single-use: a second consume of the same token fails", async () => {
    await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { generateToken: () => "raw-A", sendEmail: async () => ({}) },
    );
    expect((await consumeDiscordLink("raw-A", testPrisma)).status).toBe("linked");
    expect((await consumeDiscordLink("raw-A", testPrisma)).status).toBe("invalid");
    expect(await testPrisma.discordAccountLink.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("rejects an expired token", async () => {
    await testPrisma.discordIntegration.update({
      where: { organizationId: orgId },
      data: { linkTokenTtlMinutes: 1 },
    });
    await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { generateToken: () => "raw-A", sendEmail: async () => ({}), now: new Date(Date.now() - 5 * 60 * 1000) },
    );
    expect((await consumeDiscordLink("raw-A", testPrisma)).status).toBe("invalid");
  });

  it("gives a byte-identical 'pending' for matched and unmatched emails (no oracle)", async () => {
    const matched = await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { generateToken: tokenGen(), sendEmail: async () => ({}) },
    );
    const unmatched = await startDiscordLink(
      { organizationId: orgId, discordUserId: "bob", email: "nobody@example.com" },
      { sendEmail: async () => ({}) },
    );
    expect(matched).toEqual({ status: "pending" });
    expect(unmatched).toEqual({ status: "pending" });
    // Only the matched attempt issued a token.
    expect(await testPrisma.discordLinkToken.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("enforces the durable per-Discord-user rate limit (3/hr)", async () => {
    const gen = tokenGen();
    for (let i = 0; i < 5; i++) {
      await startDiscordLink(
        { organizationId: orgId, discordUserId: "spammer", email: EMAIL },
        { generateToken: gen, sendEmail: async () => ({}) },
      );
    }
    // 4th and 5th are silently dropped — at most 3 tokens issued.
    expect(await testPrisma.discordLinkToken.count({ where: { discordUserId: "spammer" } })).toBe(3);
  });

  it("never matches a null email or a same-email crew member in another org", async () => {
    // Null-email crew in this org.
    await testPrisma.crewMember.update({ where: { id: crewId }, data: { email: null } });
    const nullRes = await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: "" },
      { sendEmail: async () => ({}) },
    );
    expect(nullRes).toEqual({ status: "pending" });

    // Same email, different org — must not leak across the tenant boundary.
    const other = await seedOrg(); // EMAIL in a different org
    const crossRes = await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { sendEmail: async () => ({}) },
    );
    expect(crossRes).toEqual({ status: "pending" });
    expect(await testPrisma.discordLinkToken.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await testPrisma.discordLinkToken.count({ where: { organizationId: other.orgId } })).toBe(0);
  });

  it("rejects re-linking an already-linked crew member (token burned)", async () => {
    await startDiscordLink(
      { organizationId: orgId, discordUserId: "alice", email: EMAIL },
      { generateToken: () => "raw-A", sendEmail: async () => ({}) },
    );
    await consumeDiscordLink("raw-A", testPrisma);
    // A second enrollment for the same crew (different invoker) then consume.
    await startDiscordLink(
      { organizationId: orgId, discordUserId: "mallory", email: EMAIL },
      { generateToken: () => "raw-B", sendEmail: async () => ({}) },
    );
    expect((await consumeDiscordLink("raw-B", testPrisma)).status).toBe("already_linked");
    expect(await testPrisma.discordAccountLink.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
