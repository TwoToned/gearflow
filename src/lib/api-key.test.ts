import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "./actor-context";

const apiKeyFindUnique = vi.fn();
const apiKeyUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findUnique: (...a: unknown[]) => apiKeyFindUnique(...a),
      update: (...a: unknown[]) => apiKeyUpdate(...a),
    },
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
} from "@/lib/api-key";

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key_1",
    organizationId: "org_1",
    actingUserId: "user_1",
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    scopes: '["assets:read","project:manage_line_items"]',
    actingUser: { name: "Ada" },
    organization: { apiKillSwitchAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiKeyUpdate.mockResolvedValue({});
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
    apiKeyFindUnique.mockResolvedValue(keyRow());

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
    expect(apiKeyFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashApiKey("gf_live_whatever") } }),
    );
  });

  it("rejects an unknown key (INVALID_KEY)", async () => {
    apiKeyFindUnique.mockResolvedValue(null);
    await expect(getApiKeyActorContext("nope")).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("rejects an inactive or revoked key (KEY_INACTIVE)", async () => {
    apiKeyFindUnique.mockResolvedValue(keyRow({ revokedAt: new Date() }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_INACTIVE" });

    apiKeyFindUnique.mockResolvedValue(keyRow({ isActive: false }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_INACTIVE" });
  });

  it("rejects an expired key (KEY_EXPIRED)", async () => {
    apiKeyFindUnique.mockResolvedValue(keyRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "KEY_EXPIRED" });
  });

  it("rejects every key when the org kill switch is set (ORG_KILL_SWITCH)", async () => {
    apiKeyFindUnique.mockResolvedValue(
      keyRow({ organization: { apiKillSwitchAt: new Date() } }),
    );
    await expect(getApiKeyActorContext("x")).rejects.toMatchObject({ code: "ORG_KILL_SWITCH" });
  });
});
