import { describe, it, expect, vi } from "vitest";
import {
  requireActorPermission,
  resolveDiscordActor,
  type ServiceActor,
} from "./discord-actor";
import { DiscordApiError } from "@/lib/discord/api-errors";

function actor(role: string): ServiceActor {
  return {
    organizationId: "org1",
    crewMemberId: "cm1",
    userId: null,
    userName: "Jo Crew",
    role,
    discordUserId: "d1",
  };
}

/** A db stub that fails if touched — proves built-in roles never hit the DB. */
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error("DB should not be queried for a built-in role");
    },
  },
) as never;

describe("requireActorPermission", () => {
  it("allows a viewer to read assets", async () => {
    await expect(requireActorPermission(actor("viewer"), "asset", "read", noDb)).resolves.toBeUndefined();
  });

  it("denies a viewer creating assets with FORBIDDEN + details", async () => {
    const err = await requireActorPermission(actor("viewer"), "asset", "create", noDb).catch((e) => e);
    expect(err).toBeInstanceOf(DiscordApiError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details).toMatchObject({ requiredPermission: "asset:create", actualRole: "viewer" });
  });

  it("lets a manager update projects but denies a member", async () => {
    await expect(requireActorPermission(actor("manager"), "project", "update", noDb)).resolves.toBeUndefined();
    await expect(requireActorPermission(actor("member"), "orgSettings", "update", noDb)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("owner is allowed anything", async () => {
    await expect(requireActorPermission(actor("owner"), "asset", "delete", noDb)).resolves.toBeUndefined();
  });

  it("resolves a custom role's permission map from the DB", async () => {
    const db = {
      customRole: {
        findUnique: vi.fn().mockResolvedValue({ permissions: JSON.stringify({ asset: ["read"] }) }),
      },
    } as never;
    await expect(requireActorPermission(actor("custom:r1"), "asset", "read", db)).resolves.toBeUndefined();
    await expect(requireActorPermission(actor("custom:r1"), "asset", "create", db)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies a custom role that no longer exists", async () => {
    const db = { customRole: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    await expect(requireActorPermission(actor("custom:gone"), "asset", "read", db)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("resolveDiscordActor", () => {
  it("returns null when there is no link", async () => {
    const db = { discordAccountLink: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(await resolveDiscordActor("org1", "d1", db)).toBeNull();
  });

  it("gives a freelancer (no User) the viewer baseline", async () => {
    const db = {
      discordAccountLink: {
        findUnique: vi.fn().mockResolvedValue({
          crewMember: { id: "cm1", userId: null, firstName: "Sam", lastName: "Lee" },
        }),
      },
      member: { findFirst: vi.fn() },
    } as never;
    const a = await resolveDiscordActor("org1", "d1", db);
    expect(a).toMatchObject({ crewMemberId: "cm1", role: "viewer", userName: "Sam Lee", userId: null });
  });

  it("uses the platform Member role when the crew member has a User", async () => {
    const db = {
      discordAccountLink: {
        findUnique: vi.fn().mockResolvedValue({
          crewMember: { id: "cm2", userId: "u1", firstName: "Pat", lastName: "Boss" },
        }),
      },
      member: { findFirst: vi.fn().mockResolvedValue({ role: "manager" }) },
    } as never;
    const a = await resolveDiscordActor("org1", "d2", db);
    expect(a).toMatchObject({ role: "manager", userId: "u1" });
  });
});
