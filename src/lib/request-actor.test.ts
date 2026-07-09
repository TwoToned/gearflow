import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWithActor, getAmbientActor } from "./request-actor";
import type { ActorContext } from "./actor-context";

const requireOrganization = vi.hoisted(() => vi.fn());
const findUniqueUser = vi.hoisted(() => vi.fn());
const findFirstMember = vi.hoisted(() => vi.fn());

vi.mock("./auth-server", () => ({ requireOrganization }));
vi.mock("./prisma", () => ({
  prisma: {
    user: { findUnique: findUniqueUser },
    member: { findFirst: findFirstMember },
    customRole: { findUnique: vi.fn() },
  },
}));

const { getOrgContext, requirePermission } = await import("./org-context");

const apiActor: ActorContext = {
  organizationId: "org_api",
  userId: "user_api",
  userName: "Agent Key",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["project:read", "asset:*"],
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueUser.mockResolvedValue({
    id: "user_api",
    name: "Agent Key",
    email: "agent@example.com",
    image: null,
  });
  findFirstMember.mockResolvedValue({ role: "admin", organizationId: "org_api" });
  requireOrganization.mockResolvedValue({
    organizationId: "org_session",
    session: {
      user: { id: "user_session", name: "Web User", image: null },
      session: { id: "sess_1" },
    },
  });
});

describe("ambient actor storage", () => {
  it("is empty outside runWithActor", () => {
    expect(getAmbientActor()).toBeUndefined();
  });

  it("propagates across await boundaries and nested calls", async () => {
    const seen = await runWithActor(apiActor, async () => {
      await Promise.resolve();
      const nested = async () => getAmbientActor();
      return nested();
    });
    expect(seen).toEqual(apiActor);
  });

  it("isolates concurrent actors", async () => {
    const other: ActorContext = { ...apiActor, organizationId: "org_b", userId: "user_b" };
    const [a, b] = await Promise.all([
      runWithActor(apiActor, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getAmbientActor()?.organizationId;
      }),
      runWithActor(other, async () => getAmbientActor()?.organizationId),
    ]);
    expect(a).toBe("org_api");
    expect(b).toBe("org_b");
  });
});

describe("getOrgContext", () => {
  it("uses the session when there is no ambient actor", async () => {
    const ctx = await getOrgContext();
    expect(ctx.organizationId).toBe("org_session");
    expect(ctx.userId).toBe("user_session");
    expect(requireOrganization).toHaveBeenCalled();
  });

  it("uses the ambient actor and never reads the session", async () => {
    const ctx = await runWithActor(apiActor, () => getOrgContext());
    expect(ctx.organizationId).toBe("org_api");
    expect(ctx.userId).toBe("user_api");
    expect(ctx.user.image).toBeNull();
    expect(requireOrganization).not.toHaveBeenCalled();
  });

  it("rejects a key whose acting user was deleted", async () => {
    findUniqueUser.mockResolvedValue(null);
    await expect(runWithActor(apiActor, () => getOrgContext())).rejects.toThrow(
      /no longer exists/,
    );
  });
});

describe("requirePermission under an ambient API-key actor", () => {
  it("allows an operation covered by both scope and RBAC", async () => {
    const res = await runWithActor(apiActor, () => requirePermission("project", "read"));
    expect(res.organizationId).toBe("org_api");
  });

  it("honours a resource wildcard scope", async () => {
    const res = await runWithActor(apiActor, () => requirePermission("asset", "delete"));
    expect(res.userId).toBe("user_api");
  });

  it("throws MISSING_SCOPE when the key lacks the scope, even though RBAC allows it", async () => {
    // The acting user is an admin, so RBAC would permit this. The key may not.
    await expect(
      runWithActor(apiActor, () => requirePermission("project", "delete")),
    ).rejects.toMatchObject({ code: "MISSING_SCOPE", requiredScope: "project:delete" });
  });

  it("still enforces the acting user's live RBAC even with a wildcard scope", async () => {
    findFirstMember.mockResolvedValue({ role: "viewer", organizationId: "org_api" });
    const wildcard: ActorContext = { ...apiActor, scopes: ["*"] };
    await expect(
      runWithActor(wildcard, () => requirePermission("asset", "delete")),
    ).rejects.toThrow(/don't have permission/);
  });

  it("does not scope-check session actors", async () => {
    const res = await requirePermission("project", "delete");
    expect(res.organizationId).toBe("org_session");
  });
});
