import { describe, it, expect, vi } from "vitest";
import { reportAssetFault } from "./asset-fault-service";
import type { ServiceActor } from "./discord-actor";

const viewer: ServiceActor = {
  organizationId: "org1",
  crewMemberId: "cm1",
  userId: null,
  userName: "Jo",
  role: "viewer",
  discordUserId: "d1",
};

function client(opts: { asset?: unknown } = {}) {
  return {
    damageEvent: { findUnique: vi.fn().mockResolvedValue(null) },
    asset: { findFirst: vi.fn().mockResolvedValue(opts.asset ?? null) },
    projectLineItem: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  } as never;
}

describe("reportAssetFault (guards)", () => {
  it("rejects a severity outside MINOR/MAJOR (no TOTAL / out_of_service leak)", async () => {
    await expect(
      reportAssetFault(viewer, { code: "TTP-042", description: "x", severity: "TOTAL" as never, holdForRepair: false }, client()),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { field: "severity" } });
  });

  it("rejects an empty description", async () => {
    await expect(
      reportAssetFault(viewer, { code: "TTP-042", description: "  ", severity: "MINOR", holdForRepair: false }, client()),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { field: "description" } });
  });

  it("throws ASSET_NOT_FOUND when the code does not resolve", async () => {
    await expect(
      reportAssetFault(viewer, { code: "ZZZ", description: "broken", severity: "MINOR", holdForRepair: false }, client({ asset: null })),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  });

  it("denies the hold-for-repair flip to a low-privilege reporter (FORBIDDEN)", async () => {
    const c = client({ asset: { id: "a1", assetTag: "TTP-042", status: "AVAILABLE" } });
    await expect(
      reportAssetFault(viewer, { code: "TTP-042", description: "broken", severity: "MAJOR", holdForRepair: true }, c),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The DamageEvent transaction is never entered when the flip is denied.
    expect((c as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
  });
});
