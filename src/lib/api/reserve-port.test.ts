import { describe, it, expect, vi, beforeEach } from "vitest";

const getProjectById = vi.fn();
const addLineItem = vi.fn();
const checkAvailability = vi.fn();
const idemFindUnique = vi.fn();
const idemCreate = vi.fn();

vi.mock("@/lib/projects-read", () => ({ getProjectById: (...a: unknown[]) => getProjectById(...a) }));
vi.mock("@/server/line-items", () => ({
  addLineItem: (...a: unknown[]) => addLineItem(...a),
  checkAvailability: (...a: unknown[]) => checkAvailability(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiIdempotency: {
      findUnique: (...a: unknown[]) => idemFindUnique(...a),
      create: (...a: unknown[]) => idemCreate(...a),
    },
  },
}));

import { convexReservationPort } from "@/lib/api/reserve-port";
import { UserFacingError } from "@/lib/errors/user-facing-error";

const baseArgs = {
  organizationId: "org_1",
  actorUserId: "user_1",
  actorUserName: "Ada",
  apiKeyId: "key_1",
  projectId: "proj_1",
  items: [{ modelId: "model_x", quantity: 2 }],
  idempotencyKey: "idem_1",
  dryRun: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getProjectById.mockResolvedValue({
    id: "proj_1",
    organizationId: "org_1",
    name: "Acme Show",
    rentalStartDate: null,
    rentalEndDate: null,
  });
});

describe("convexReservationPort — preview", () => {
  it("returns per-item availability without writing", async () => {
    checkAvailability.mockResolvedValue({ available: 5, conflicts: [] });

    const res = await convexReservationPort.reserve({ ...baseArgs, dryRun: true });

    expect(res.committed).toBe(false);
    expect(res.reservationId).toBeNull();
    expect(res.preview).toEqual([
      { modelId: "model_x", requested: 2, available: 5, sufficient: true, conflicts: [] },
    ]);
    expect(addLineItem).not.toHaveBeenCalled();
  });

  it("flags insufficient stock in the preview", async () => {
    checkAvailability.mockResolvedValue({ available: 1, conflicts: ["Other Show #12"] });

    const res = await convexReservationPort.reserve({ ...baseArgs, dryRun: true });

    expect(res.preview![0].sufficient).toBe(false);
    expect(res.summary).toMatch(/short on stock/i);
  });
});

describe("convexReservationPort — commit", () => {
  it("reserves via addLineItem and records idempotency", async () => {
    idemFindUnique.mockResolvedValue(null);
    addLineItem.mockResolvedValue({ id: "li_1" });
    idemCreate.mockResolvedValue({});

    const res = await convexReservationPort.reserve(baseArgs);

    expect(res.committed).toBe(true);
    expect(res.lineItemIds).toEqual(["li_1"]);
    expect(res.replayed).toBe(false);
    // Drove the guarded add on behalf of the API key, no accessory expansion.
    expect(addLineItem).toHaveBeenCalledWith(
      "proj_1",
      { type: "EQUIPMENT", modelId: "model_x", quantity: 2 },
      false,
      false,
      false,
      expect.objectContaining({ actorType: "apiKey", organizationId: "org_1", apiKeyId: "key_1" }),
    );
    expect(idemCreate).toHaveBeenCalled();
  });

  it("replays a prior result for the same idempotency key (no second write)", async () => {
    idemFindUnique.mockResolvedValue({
      result: JSON.stringify({
        reservationId: "li_1",
        committed: true,
        replayed: false,
        lineItemIds: ["li_1"],
        summary: "Reserved 1 item(s) on Acme Show.",
      }),
    });

    const res = await convexReservationPort.reserve(baseArgs);

    expect(res.replayed).toBe(true);
    expect(res.lineItemIds).toEqual(["li_1"]);
    expect(addLineItem).not.toHaveBeenCalled();
  });

  it("maps an availability UserFacingError to INVENTORY_CONFLICT", async () => {
    idemFindUnique.mockResolvedValue(null);
    addLineItem.mockRejectedValue(
      new UserFacingError({
        code: "INSUFFICIENT_STOCK",
        title: "Asset not available",
        message: "Only 1 of Model-X free in this window.",
      }),
    );

    await expect(convexReservationPort.reserve(baseArgs)).rejects.toMatchObject({
      code: "INVENTORY_CONFLICT",
    });
    expect(idemCreate).not.toHaveBeenCalled();
  });
});

describe("convexReservationPort — guards", () => {
  it("rejects a project outside the actor's org", async () => {
    getProjectById.mockResolvedValue({ id: "proj_1", organizationId: "org_OTHER" });
    await expect(convexReservationPort.reserve(baseArgs)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a non-model item in v1", async () => {
    await expect(
      convexReservationPort.reserve({
        ...baseArgs,
        items: [{ assetId: "asset_1", quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
