import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "./actor-context";

// ApiKey lookup is Convex now; org kill-switch + acting-user name stay on Postgres.
const getByTokenHash = vi.fn();
const touchLastUsed = vi.fn();
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => ({
    query: (_ref: unknown, args: unknown) => getByTokenHash(args),
    mutation: (_ref: unknown, args: unknown) => {
      touchLastUsed(args);
      return Promise.resolve();
    },
  })),
}));
const orgFindUnique = vi.fn();
const userFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => orgFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

import {
  hashApiKey,
  generateApiKey,
  parseScopes,
  hasScope,
  requireApiScope,
  getApiKeyActorContext,
  ApiKeyAuthError,
  isScopeGranted,
  assertScopesWithinActor,
} from "@/lib/api-key";

// A Convex-shaped apiKey doc (epoch-ms dates; org/user resolved separately).
function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key_1",
    organizationId: "org_1",
    actingUserId: "user_1",
    isActive: true,
    revokedAt: undefined,
    expiresAt: undefined,
    scopes: '["assets:read","project:manage_line_items"]',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  orgFindUnique.mockResolvedValue({ apiKillSwitchAt: null });
  userFindUnique.mockResolvedValue({ name: "Ada" });
});

describe("hashApiKey / generateApiKey", () => {
  it("hashes deterministically and never returns the raw token in the hash", () => {
    expect(hashApiKey("gf_live_abc")).toBe(hashApiKey("gf_live_abc"));
    expect(hashApiKey("gf_live_abc")).not.toContain("gf_live_abc");
    expect(hashApiKey("gf_live_abc")).toHaveLength(64); // sha256 hex
  });

  it("generates a key whose prefix is a real substring and whose hash matches", () => {
    const { raw, prefix, tokenHash } = generateApiKey();
    expect(raw.startsWith(prefix)).toBe(true);
    expect(raw.startsWith("gf_live_")).toBe(true);
    expect(tokenHash).toBe(hashApiKey(raw));
    // Two keys never collide.
    expect(generateApiKey().raw).not.toBe(raw);
  });
});

describe("parseScopes / hasScope", () => {
  it("parses valid JSON arrays and tolerates garbage", () => {
    expect(parseScopes('["a:read","b:write"]')).toEqual(["a:read", "b:write"]);
    expect(parseScopes("not json")).toEqual([]);
    expect(parseScopes('{"a":1}')).toEqual([]);
    expect(parseScopes('["ok", 5, null]')).toEqual(["ok"]);
  });

  it("matches exact, resource-wildcard, and global-wildcard scopes", () => {
    expect(hasScope(["project:manage_line_items"], "project", "manage_line_items")).toBe(true);
    expect(hasScope(["project:*"], "project", "reserve")).toBe(true);
    expect(hasScope(["*"], "anything", "goes")).toBe(true);
    expect(hasScope(["assets:read"], "project", "manage_line_items")).toBe(false);
    expect(hasScope([], "project", "read")).toBe(false);
  });
});

describe("requireApiScope — the key-scope half of the intersection", () => {
  const apiActor: ActorContext = {
    organizationId: "org_1",
    userId: "user_1",
    userName: "Ada",
    actorType: "apiKey",
    apiKeyId: "key_1",
    scopes: ["project:manage_line_items"],
  };

  it("passes when the key carries the scope", () => {
    expect(() => requireApiScope(apiActor, "project", "manage_line_items")).not.toThrow();
  });

  it("throws MISSING_SCOPE naming the exact scope when the key lacks it", () => {
    try {
      requireApiScope(apiActor, "warehouse", "check_out");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiKeyAuthError);
      expect((e as ApiKeyAuthError).code).toBe("MISSING_SCOPE");
      expect((e as ApiKeyAuthError).requiredScope).toBe("warehouse:check_out");
    }
  });

  it("never restricts a session actor (sessions carry full user RBAC)", () => {
    const sessionActor: ActorContext = {
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
      actorType: "session",
    };
    expect(() => requireApiScope(sessionActor, "warehouse", "check_out")).not.toThrow();
  });
});

describe("getApiKeyActorContext — validation + resolution", () => {
  it("resolves a valid key to an apiKey ActorContext with its scopes", async () => {
    getByTokenHash.mockResolvedValue(keyRow());

    const actor = await getApiKeyActorContext("gf_live_whatever");

    expect(actor).toEqual({
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
      actorType: "apiKey",
      apiKeyId: "key_1",
      scopes: ["assets:read", "project:manage_line_items"],
    });
    // Looked up by hash, not raw token.
    expect(getByTokenHash).toHaveBeenCalledWith({ tokenHash: hashApiKey("gf_live_whatever") });
  });

  it("rejects an unknown key (INVALID_KEY)", async () => {
    getByTokenHash.mockResolvedValue(null);
    await expect(getApiKeyActorContext("nope")).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("rejects an inactive or revoked key (KEY_INACTIVE)", async () => {
    getByTokenHash.mockResolvedValue(keyRow({ revokedAt: Date.now() }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_INACTIVE" });

    getByTokenHash.mockResolvedValue(keyRow({ isActive: false }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_INACTIVE" });
  });

  it("rejects an expired key — including a non-finite stored expiry (KEY_EXPIRED)", async () => {
    getByTokenHash.mockResolvedValue(keyRow({ expiresAt: Date.now() - 1000 }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_EXPIRED" });

    // Fail closed: a garbage (NaN) stored expiry must reject, not read as "no expiry".
    getByTokenHash.mockResolvedValue(keyRow({ expiresAt: NaN }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_EXPIRED" });
  });

  it("rejects every key when the org kill switch is set (ORG_KILL_SWITCH)", async () => {
    getByTokenHash.mockResolvedValue(keyRow());
    orgFindUnique.mockResolvedValue({ apiKillSwitchAt: new Date() });
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "ORG_KILL_SWITCH" });
  });

  it("fails closed when the key's org no longer exists (INVALID_KEY)", async () => {
    getByTokenHash.mockResolvedValue(keyRow());
    orgFindUnique.mockResolvedValue(null);
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("fails closed when the acting user no longer exists (KEY_INACTIVE)", async () => {
    getByTokenHash.mockResolvedValue(keyRow());
    userFindUnique.mockResolvedValue(null);
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_INACTIVE" });
  });
});

describe("isScopeGranted", () => {
  it("grants anything to a `*` holder", () => {
    expect(isScopeGranted(["*"], "*")).toBe(true);
    expect(isScopeGranted(["*"], "project:delete")).toBe(true);
    expect(isScopeGranted(["*"], "asset:*")).toBe(true);
  });

  it("refuses to let a non-`*` holder grant `*`", () => {
    expect(isScopeGranted(["project:*", "asset:*"], "*")).toBe(false);
  });

  it("grants a resource wildcard only to a holder of that wildcard", () => {
    expect(isScopeGranted(["asset:*"], "asset:*")).toBe(true);
    expect(isScopeGranted(["asset:*"], "asset:delete")).toBe(true);
    expect(isScopeGranted(["asset:read"], "asset:*")).toBe(false);
  });

  it("grants an exact scope", () => {
    expect(isScopeGranted(["project:read"], "project:read")).toBe(true);
    expect(isScopeGranted(["project:read"], "project:delete")).toBe(false);
  });

  it("never grants a malformed scope", () => {
    expect(isScopeGranted(["project:read"], "project")).toBe(false);
    expect(isScopeGranted(["project:read"], "a:b:c")).toBe(false);
    expect(isScopeGranted(["project:read"], "")).toBe(false);
  });
});

describe("assertScopesWithinActor — key-minting privilege escalation", () => {
  const key = (scopes: string[]): ActorContext => ({
    organizationId: "org_1",
    userId: "u1",
    userName: "Agent",
    actorType: "apiKey",
    apiKeyId: "k1",
    scopes,
  });

  it("blocks the escalation: orgSettings:update alone cannot mint a `*` key", () => {
    expect(() => assertScopesWithinActor(key(["orgSettings:update"]), ["*"])).toThrowError(
      expect.objectContaining({ code: "MISSING_SCOPE", requiredScope: "*" }),
    );
  });

  it("blocks minting any scope the creating key lacks", () => {
    expect(() =>
      assertScopesWithinActor(key(["orgSettings:update", "project:read"]), [
        "project:read",
        "project:delete",
      ]),
    ).toThrowError(expect.objectContaining({ code: "MISSING_SCOPE", requiredScope: "project:delete" }));
  });

  it("allows minting a key with the same or narrower scopes", () => {
    expect(() =>
      assertScopesWithinActor(key(["orgSettings:update", "asset:*"]), ["asset:read"]),
    ).not.toThrow();
    expect(() => assertScopesWithinActor(key(["*"]), ["*", "project:delete"])).not.toThrow();
    expect(() => assertScopesWithinActor(key(["project:read"]), [])).not.toThrow();
  });

  it("does not constrain a human session (its role is the authority)", () => {
    const session: ActorContext = {
      organizationId: "org_1",
      userId: "u1",
      userName: "Ada",
      actorType: "session",
    };
    expect(() => assertScopesWithinActor(session, ["*"])).not.toThrow();
  });
});
