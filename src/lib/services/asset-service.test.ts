import { describe, it, expect, vi } from "vitest";
import { getAssetForDiscord } from "./asset-service";
import type { ServiceActor } from "./discord-actor";

const viewer: ServiceActor = {
  organizationId: "org1",
  crewMemberId: "cm1",
  userId: null,
  userName: "Jo",
  role: "viewer",
  discordUserId: "d1",
};

function dbWith(opts: {
  asset?: unknown;
  lineItem?: unknown;
}) {
  return {
    asset: { findFirst: vi.fn().mockResolvedValue(opts.asset ?? null) },
    projectLineItem: { findFirst: vi.fn().mockResolvedValue(opts.lineItem ?? null) },
  } as never;
}

const baseAsset = {
  id: "a1",
  assetTag: "TTP-042",
  customName: null,
  status: "AVAILABLE",
  nextTestAndTagDate: null,
  model: { name: "Shure SM58" },
};

describe("getAssetForDiscord", () => {
  it("rejects an empty code with VALIDATION", async () => {
    await expect(getAssetForDiscord(viewer, "   ", dbWith({}))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("throws ASSET_NOT_FOUND (with the code) when nothing matches", async () => {
    const err = await getAssetForDiscord(viewer, "ZZZ-1", dbWith({ asset: null })).catch((e) => e);
    expect(err.code).toBe("ASSET_NOT_FOUND");
    expect(err.details).toMatchObject({ code: "ZZZ-1" });
  });

  it("maps an unassigned asset, using model name as description", async () => {
    const res = await getAssetForDiscord(viewer, "TTP-042", dbWith({ asset: baseAsset }));
    expect(res).toEqual({
      assetTag: "TTP-042",
      description: "Shure SM58",
      status: "AVAILABLE",
      testTagStatus: null,
      currentProject: null,
    });
  });

  it("prefers customName and surfaces the current project", async () => {
    const res = await getAssetForDiscord(
      viewer,
      "TTP-042",
      dbWith({
        asset: { ...baseAsset, customName: "Lead Vocal Mic" },
        lineItem: { project: { projectNumber: "TTP001", name: "Pippin" } },
      }),
    );
    expect(res.description).toBe("Lead Vocal Mic");
    expect(res.currentProject).toEqual({ projectNumber: "TTP001", name: "Pippin" });
  });

  it("formats test & tag status relative to now", async () => {
    const now = new Date("2026-06-04T00:00:00Z");
    const overdue = await getAssetForDiscord(
      viewer,
      "TTP-042",
      dbWith({ asset: { ...baseAsset, nextTestAndTagDate: new Date("2026-01-01T00:00:00Z") } }),
      now,
    );
    expect(overdue.testTagStatus).toBe("Overdue (due 2026-01-01)");

    const valid = await getAssetForDiscord(
      viewer,
      "TTP-042",
      dbWith({ asset: { ...baseAsset, nextTestAndTagDate: new Date("2026-12-01T00:00:00Z") } }),
      now,
    );
    expect(valid.testTagStatus).toBe("Valid to 2026-12-01");
  });

  it("denies a role without asset:read before querying", async () => {
    const db = {
      customRole: { findUnique: vi.fn().mockResolvedValue({ permissions: JSON.stringify({ project: ["read"] }) }) },
      asset: { findFirst: vi.fn() },
      projectLineItem: { findFirst: vi.fn() },
    } as never;
    await expect(
      getAssetForDiscord({ ...viewer, role: "custom:r1" }, "TTP-042", db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((db as { asset: { findFirst: ReturnType<typeof vi.fn> } }).asset.findFirst).not.toHaveBeenCalled();
  });
});
