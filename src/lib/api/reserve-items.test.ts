import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext } from "../actor-context";
import type { ReservationPort, ReserveResult, ReserveItemsInput } from "@/lib/api/reserve-items";

type ReserveArgs = Parameters<ReservationPort["reserve"]>[0];

const memberFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findFirst: (...a: unknown[]) => memberFindFirst(...a) },
    customRole: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth-server", () => ({ requireOrganization: vi.fn() }));

import { reserveItems } from "@/lib/api/reserve-items";
import { ApiError } from "@/lib/api/errors";
import { ApiKeyAuthError } from "@/lib/api-key";

function actorWith(scopes: string[]): ActorContext {
  return {
    organizationId: "org_1",
    userId: "user_1",
    userName: "Ada",
    actorType: "apiKey",
    apiKeyId: "key_1",
    scopes,
  };
}

const OK_SCOPES = ["project:manage_line_items"];

function fakePort(): ReservationPort & { calls: ReserveArgs[] } {
  const calls: ReserveArgs[] = [];
  return {
    calls,
    reserve: vi.fn(async (args) => {
      calls.push(args);
      const result: ReserveResult = {
        reservationId: args.dryRun ? null : "res_1",
        committed: !args.dryRun,
        replayed: false,
        lineItemIds: args.dryRun ? [] : ["li_1"],
        summary: "Reserve 2x Model-X on Project-42",
      };
      return result;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memberFindFirst.mockResolvedValue({ role: "owner" }); // RBAC allows by default
});

const validInput = {
  projectId: "proj_42",
  items: [{ modelId: "model_x", quantity: 2 }],
};

describe("reserveItems — guard + contract", () => {
  it("rejects a key missing the scope before doing any work", async () => {
    const port = fakePort();
    await expect(
      reserveItems(actorWith(["assets:read"]), validInput, port),
    ).rejects.toBeInstanceOf(ApiKeyAuthError);
    expect(port.reserve).not.toHaveBeenCalled();
    expect(memberFindFirst).not.toHaveBeenCalled(); // scope failed first
  });

  it("rejects when the acting user's role lacks the permission (RBAC caps the key)", async () => {
    memberFindFirst.mockResolvedValue({ role: "viewer" });
    const port = fakePort();
    await expect(
      reserveItems(actorWith(["project:*"]), validInput, port),
    ).rejects.toThrow(/don't have permission/i);
    expect(port.reserve).not.toHaveBeenCalled();
  });

  it("uses the AUTHORIZED org, never an org smuggled in the input", async () => {
    const port = fakePort();
    // Attacker-style input carrying a foreign orgId field is simply ignored —
    // reserveItems only reads projectId/items, and org comes from the actor.
    await reserveItems(
      actorWith(OK_SCOPES),
      // organizationId is NOT a field of ReserveItemsInput — an attacker adding it
      // must be ignored. Cast through unknown to smuggle the extra field past the type.
      ({ ...validInput, confirm: true, idempotencyKey: "idem_1", organizationId: "org_EVIL" } as unknown) as ReserveItemsInput,
      port,
    );
    expect(port.calls[0].organizationId).toBe("org_1");
    expect(port.calls[0].actorUserId).toBe("user_1");
    expect(port.calls[0].apiKeyId).toBe("key_1");
  });

  it("requires an idempotency key to COMMIT, but not to preview", async () => {
    const port = fakePort();

    // commit without a key → rejected
    await expect(
      reserveItems(actorWith(OK_SCOPES), { ...validInput, confirm: true }, port),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });

    // preview (default) without a key → allowed, dryRun true, no reservation id
    const preview = await reserveItems(actorWith(OK_SCOPES), validInput, port);
    expect(preview.committed).toBe(false);
    expect(preview.reservationId).toBeNull();
    expect(port.calls.at(-1)!.dryRun).toBe(true);
  });

  it("commits with an idempotency key and passes it to the write port", async () => {
    const port = fakePort();
    const result = await reserveItems(
      actorWith(OK_SCOPES),
      { ...validInput, confirm: true, idempotencyKey: "idem_42" },
      port,
    );
    expect(result.committed).toBe(true);
    expect(result.reservationId).toBe("res_1");
    expect(port.calls[0].idempotencyKey).toBe("idem_42");
    expect(port.calls[0].dryRun).toBe(false);
  });

  it("validates the request shape with actionable errors", async () => {
    const port = fakePort();
    // empty items
    await expect(
      reserveItems(actorWith(OK_SCOPES), { projectId: "p", items: [] }, port),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // both modelId and assetId set
    await expect(
      reserveItems(
        actorWith(OK_SCOPES),
        { projectId: "p", items: [{ modelId: "m", assetId: "a", quantity: 1 }] },
        port,
      ),
    ).rejects.toBeInstanceOf(ApiError);
    // quantity < 1
    await expect(
      reserveItems(
        actorWith(OK_SCOPES),
        { projectId: "p", items: [{ modelId: "m", quantity: 0 }] },
        port,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(port.reserve).not.toHaveBeenCalled();
  });
});
