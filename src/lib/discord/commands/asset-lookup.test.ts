import { describe, it, expect, vi } from "vitest";
import { command } from "./asset-lookup";
import { makeMockContext } from "../test-utils";
import * as assetService from "@/lib/services/asset-service";
import type { ServiceActor } from "@/lib/services/discord-actor";

const linkedActor: ServiceActor = {
  organizationId: "org_1",
  crewMemberId: "cm_1",
  userId: null,
  userName: "Jo",
  role: "viewer",
  discordUserId: "discord_123",
};

describe("/asset lookup command", () => {
  it("rejects an empty code without calling the service", async () => {
    const spy = vi.spyOn(assetService, "getAssetForDiscord");
    const ctx = makeMockContext({ options: {}, actor: linkedActor });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/provide an asset code/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls the asset service with the linked actor and renders the embed", async () => {
    const spy = vi.spyOn(assetService, "getAssetForDiscord").mockResolvedValue({
      assetTag: "TTP-042",
      description: "Shure SM58",
      status: "AVAILABLE",
      testTagStatus: null,
      currentProject: { projectNumber: "TTP001", name: "Pippin" },
    });
    const ctx = makeMockContext({ options: { code: "TTP-042" }, actor: linkedActor });
    await command.execute(ctx);
    expect(spy).toHaveBeenCalledWith(linkedActor, "TTP-042");
    expect(ctx.deferred[0]).toEqual({ ephemeral: true });
    const embed = ctx.replies[0]?.embeds?.[0] as { title: string; fields: { name: string; value: string }[] };
    expect(embed.title).toBe("TTP-042 — Shure SM58");
    expect(embed.fields.find((f) => f.name === "Assigned to")?.value).toMatch(/TTP001.*Pippin/);
    spy.mockRestore();
  });

  it("requires a linked user and is ephemeral", () => {
    expect(command.requiredPermission).toEqual({ kind: "linkedUser" });
    expect(command.defaultEphemeral).toBe(true);
  });
});
