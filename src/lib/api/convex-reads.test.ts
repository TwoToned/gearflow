import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";

const convexQuery = vi.hoisted(() => vi.fn());
const authorizeApiOperation = vi.hoisted(() => vi.fn());

vi.mock("../convex-client", () => ({
  getConvexClient: async () => ({ query: convexQuery }),
}));
vi.mock("./authorize", () => ({ authorizeApiOperation }));
vi.mock("../prisma", () => ({
  prisma: { apiIdempotency: { findUnique: vi.fn(), create: vi.fn() } },
}));

const { invokeOperation, getOperation, ALL_OPERATIONS } = await import("./dispatch");
const { CONVEX_READS } = await import("./convex-reads");
const { OPERATIONS } = await import("./generated/operations");

const actor: ActorContext = {
  organizationId: "org_real",
  userId: "user_1",
  userName: "Agent",
  actorType: "apiKey",
  apiKeyId: "key_1",
  scopes: ["*"],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorizeApiOperation.mockResolvedValue({
    organizationId: "org_real",
    userId: "user_1",
    userName: "Agent",
  });
  convexQuery.mockResolvedValue([{ id: "k1" }]);
});

describe("the Convex read bridge closes the server-action gap", () => {
  it("exposes the reads that have no server action behind them", () => {
    for (const name of [
      "kits.listKits",
      "collaboration.listThreads",
      "dashboard.stats",
      "warehouse.listBundle",
      "search.models",
      "line-items.listByProject",
    ]) {
      expect(ALL_OPERATIONS[name], `${name} should be reachable`).toBeDefined();
    }
  });

  it("never shadows a generated server action", () => {
    for (const name of Object.keys(CONVEX_READS)) {
      expect(OPERATIONS[name], `${name} collides with a server action`).toBeUndefined();
    }
  });

  it("marks every bridged operation as a read", () => {
    for (const meta of Object.values(CONVEX_READS)) {
      expect(meta.kind).toBe("read");
      expect(meta.dangerous).toBe(false);
    }
  });
});

describe("invokeOperation — Convex reads", () => {
  it("injects orgId from the authenticated actor", async () => {
    await invokeOperation(actor, { operation: "kits.listKits" });
    expect(convexQuery).toHaveBeenCalledWith(expect.anything(), { orgId: "org_real" });
  });

  it("REFUSES a caller-supplied orgId instead of trusting it", async () => {
    // The service token would happily read another org. This is the guard.
    await expect(
      invokeOperation(actor, {
        operation: "kits.listKits",
        arguments: { orgId: "org_victim" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("passes through declared args alongside the injected orgId", async () => {
    await invokeOperation(actor, {
      operation: "search.models",
      arguments: { query: "SM58", limit: 5 },
    });
    expect(convexQuery).toHaveBeenCalledWith(expect.anything(), {
      query: "SM58",
      limit: 5,
      orgId: "org_real",
    });
  });

  it("fills server-side autoArgs like `now` without accepting them from the caller", async () => {
    await invokeOperation(actor, { operation: "dashboard.stats" });
    const args = convexQuery.mock.calls[0][1] as { now: number; orgId: string };
    expect(args.orgId).toBe("org_real");
    expect(typeof args.now).toBe("number");

    await expect(
      invokeOperation(actor, { operation: "dashboard.stats", arguments: { now: 0 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("authorizes before touching Convex", async () => {
    authorizeApiOperation.mockRejectedValue(new Error("You don't have permission"));
    await expect(invokeOperation(actor, { operation: "kits.listKits" })).rejects.toThrow();
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it("enforces required args", async () => {
    await expect(
      invokeOperation(actor, { operation: "collaboration.listComments" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects unknown args rather than dropping them", async () => {
    await expect(
      invokeOperation(actor, { operation: "search.models", arguments: { q: "SM58" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns the serialized query result, never an idempotency replay", async () => {
    const res = await invokeOperation(actor, { operation: "kits.listKits" });
    expect(res).toEqual({
      operation: "kits.listKits",
      kind: "read",
      replayed: false,
      result: [{ id: "k1" }],
    });
  });

  it("declares the right scope for each bridged read", () => {
    expect(getOperation("kits.listKits").scope).toBe("kit:read");
    expect(getOperation("warehouse.listBundle").scope).toBe("warehouse:read");
    expect(getOperation("dashboard.stats").scope).toBe("reports:read");
    expect(getOperation("collaboration.listThreads").scope).toBe("project:read");
  });
});
