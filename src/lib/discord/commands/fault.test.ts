import { describe, it, expect, vi } from "vitest";
import { command } from "./fault";
import { makeMockContext } from "../test-utils";
import * as faultService from "@/lib/services/asset-fault-service";
import type { ServiceActor } from "@/lib/services/discord-actor";

const linkedActor: ServiceActor = {
  organizationId: "org_1",
  crewMemberId: "cm_1",
  userId: "u_1",
  userName: "Manager",
  role: "manager",
  discordUserId: "discord_123",
};

describe("/fault command", () => {
  it("requires both a code and a description", async () => {
    const ctx = makeMockContext({ options: { code: "TTP-042" }, actor: linkedActor });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/asset code and a description/i);
    expect(ctx.deferred).toHaveLength(0);
  });

  it("calls reportAssetFault with the interaction id as idempotencyKey and confirms in-channel", async () => {
    const spy = vi.spyOn(faultService, "reportAssetFault").mockResolvedValue({
      damageEventId: "de_1",
      assetTag: "TTP-042",
      description: "Won't power on",
      severity: "MAJOR",
      holdForRepair: true,
      statusChanged: true,
      newStatus: "IN_MAINTENANCE",
      idempotentReplay: false,
    });
    const ctx = makeMockContext({
      options: { code: "TTP-042", description: "Won't power on", severity: "MAJOR", hold: "true" },
      actor: linkedActor,
    });
    await command.execute(ctx);
    expect(spy).toHaveBeenCalledWith(linkedActor, {
      code: "TTP-042",
      description: "Won't power on",
      severity: "MAJOR",
      holdForRepair: true,
      idempotencyKey: "interaction_1",
    });
    const embed = ctx.replies[0]?.embeds?.[0] as { title: string; fields: { value: string }[] };
    expect(embed.title).toMatch(/TTP-042/);
    expect(embed.fields.some((f) => /IN_MAINTENANCE/.test(f.value))).toBe(true);
    spy.mockRestore();
  });

  it("is in-channel by default (shared state) and open to any linked crew", () => {
    expect(command.defaultEphemeral).toBe(false);
    expect(command.requiredPermission).toEqual({ kind: "linkedUser" });
  });
});
