import { describe, it, expect, vi } from "vitest";
import { startDiscordLink, hashLinkToken } from "./discord-link-service";

/**
 * Builds a mock db whose call counts/returns are configurable. Only the methods
 * startDiscordLink touches are implemented.
 */
function makeDb(opts: {
  existingLink?: unknown;
  crewMatches?: { id: string }[];
  perUserCount?: number;
  perEmailCount?: number;
  ttl?: number;
}) {
  const create = vi.fn().mockResolvedValue({});
  const counts = [opts.perUserCount ?? 0, opts.perEmailCount ?? 0];
  let countIdx = 0;
  const db = {
    discordAccountLink: { findUnique: vi.fn().mockResolvedValue(opts.existingLink ?? null) },
    crewMember: { findMany: vi.fn().mockResolvedValue(opts.crewMatches ?? []) },
    discordLinkToken: {
      count: vi.fn().mockImplementation(() => Promise.resolve(counts[countIdx++] ?? 0)),
      create,
    },
    discordIntegration: { findUnique: vi.fn().mockResolvedValue({ linkTokenTtlMinutes: opts.ttl ?? 15, guildId: "g1" }) },
  } as never;
  return { db, create };
}

const base = { organizationId: "org1", discordUserId: "d1", email: "you@example.com" };

describe("startDiscordLink", () => {
  it("reveals already-linked status for the invoker (their own account)", async () => {
    const { db } = makeDb({ existingLink: { crewMember: { firstName: "Sam", lastName: "Lee" } } });
    const res = await startDiscordLink(base, { db, sendEmail: vi.fn() });
    expect(res).toEqual({ status: "already_linked", linkedToName: "Sam Lee" });
  });

  it("returns the constant 'pending' and sends NO email when the email has no match", async () => {
    const { db, create } = makeDb({ crewMatches: [] });
    const sendEmail = vi.fn();
    const res = await startDiscordLink(base, { db, sendEmail });
    expect(res).toEqual({ status: "pending" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 'pending' and sends nothing on an AMBIGUOUS (>1) email match", async () => {
    const { db, create } = makeDb({ crewMatches: [{ id: "c1" }, { id: "c2" }] });
    const sendEmail = vi.fn();
    const res = await startDiscordLink(base, { db, sendEmail });
    expect(res).toEqual({ status: "pending" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("issues a hashed token + email on a single match, binding the invoker's Discord id", async () => {
    const { db, create } = makeDb({ crewMatches: [{ id: "c1" }] });
    const sendEmail = vi.fn().mockResolvedValue({});
    const res = await startDiscordLink(base, {
      db,
      sendEmail,
      generateToken: () => "RAWTOKEN",
      now: new Date("2026-06-04T00:00:00Z"),
    });
    expect(res).toEqual({ status: "pending" });
    const data = create.mock.calls[0][0].data;
    expect(data.crewMemberId).toBe("c1");
    expect(data.discordUserId).toBe("d1"); // anti-hijack binding
    expect(data.tokenHash).toBe(hashLinkToken("RAWTOKEN"));
    expect(data.tokenHash).not.toContain("RAWTOKEN"); // raw never stored
    expect(data.expiresAt).toEqual(new Date("2026-06-04T00:15:00Z"));
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("you@example.com");
    expect(sent.html).toContain("token=RAWTOKEN");
  });

  it("silently drops (pending, no email) when the per-Discord-user rate limit is hit", async () => {
    const { db, create } = makeDb({ crewMatches: [{ id: "c1" }], perUserCount: 3 });
    const sendEmail = vi.fn();
    const res = await startDiscordLink(base, { db, sendEmail });
    expect(res).toEqual({ status: "pending" });
    expect(create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("silently drops when the per-email rate limit is hit", async () => {
    const { db, create } = makeDb({ crewMatches: [{ id: "c1" }], perEmailCount: 3 });
    const sendEmail = vi.fn();
    const res = await startDiscordLink(base, { db, sendEmail });
    expect(res).toEqual({ status: "pending" });
    expect(create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
