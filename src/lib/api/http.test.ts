import { describe, it, expect, vi, beforeEach } from "vitest";

const getApiKeyActorContext = vi.fn();
vi.mock("@/lib/api-key", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-key")>("@/lib/api-key");
  return { ...actual, getApiKeyActorContext: (...a: unknown[]) => getApiKeyActorContext(...a) };
});
// api-key imports @/lib/prisma transitively; stub it so importing the real module is safe.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  extractBearerToken,
  toErrorEnvelope,
  authenticateApiRequest,
} from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import { ApiKeyAuthError } from "@/lib/api-key";

beforeEach(() => vi.clearAllMocks());

describe("extractBearerToken", () => {
  it("pulls the token from a well-formed header (case-insensitive)", () => {
    expect(extractBearerToken("Bearer rvlt_live_abc")).toBe("rvlt_live_abc");
    expect(extractBearerToken("bearer  rvlt_live_xyz  ")).toBe("rvlt_live_xyz");
  });
  it("returns null for missing or malformed headers", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Token abc")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
  });
});

describe("toErrorEnvelope", () => {
  it("maps an ApiError to its status + full envelope", () => {
    const { status, body } = toErrorEnvelope(
      new ApiError("MISSING_SCOPE", "need it", {
        requiredScope: "project:manage_line_items",
      }),
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe("MISSING_SCOPE");
    expect(body.error.requiredScope).toBe("project:manage_line_items");
    expect(body.error.retryable).toBe(false);
    // Every error points the agent at the docs so it can self-serve recovery.
    expect(body.error.documentation_url).toContain("/llms.txt");
  });

  it("maps an ApiKeyAuthError (401/403) preserving its code", () => {
    expect(toErrorEnvelope(new ApiKeyAuthError("INVALID_KEY", "nope")).status).toBe(401);
    expect(toErrorEnvelope(new ApiKeyAuthError("ORG_KILL_SWITCH", "off")).status).toBe(403);
    const conflict = toErrorEnvelope(new ApiError("INVENTORY_CONFLICT", "x", { retryable: false }));
    expect(conflict.status).toBe(409);
  });

  it("maps an unknown error to an opaque 500 (no internal leak)", () => {
    const { status, body } = toErrorEnvelope(new Error("secret db string"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("secret");
  });
});

describe("authenticateApiRequest", () => {
  it("rejects a request with no bearer token before hitting the key store", async () => {
    await expect(authenticateApiRequest(null)).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(getApiKeyActorContext).not.toHaveBeenCalled();
  });

  it("resolves a valid header to the ActorContext from the key store", async () => {
    getApiKeyActorContext.mockResolvedValue({
      organizationId: "org_1",
      userId: "user_1",
      userName: "Ada",
      actorType: "apiKey",
      apiKeyId: "key_1",
      scopes: ["assets:read"],
    });

    const actor = await authenticateApiRequest("Bearer rvlt_live_abc");

    expect(actor.actorType).toBe("apiKey");
    expect(actor.organizationId).toBe("org_1");
    expect(getApiKeyActorContext).toHaveBeenCalledWith("rvlt_live_abc");
  });
});
