import { describe, it, expect, vi } from "vitest";
import { command } from "./link";
import { makeMockContext } from "../test-utils";
import * as linkService from "@/lib/services/discord-link-service";

describe("/link command", () => {
  it("asks for an email when none is given", async () => {
    const ctx = makeMockContext({ options: {} });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/provide your email/i);
    expect(ctx.deferred).toHaveLength(0);
  });

  it("renders the constant pending message for a normal start", async () => {
    const spy = vi.spyOn(linkService, "startDiscordLink").mockResolvedValue({ status: "pending" });
    const ctx = makeMockContext({ options: { email: "you@example.com" } });
    await command.execute(ctx);
    expect(spy).toHaveBeenCalledWith({
      organizationId: "org_1",
      discordUserId: "discord_123",
      email: "you@example.com",
    });
    expect(ctx.deferred[0]).toEqual({ ephemeral: true });
    expect(ctx.replies[0]?.content).toMatch(/if that email is on a gearflow crew profile/i);
    spy.mockRestore();
  });

  it("tells an already-linked user who they're linked as", async () => {
    const spy = vi.spyOn(linkService, "startDiscordLink").mockResolvedValue({
      status: "already_linked",
      linkedToName: "Sam Lee",
    });
    const ctx = makeMockContext({ options: { email: "sam@example.com" } });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/already linked.*Sam Lee/i);
    spy.mockRestore();
  });

  it("is open to anyone (no link required) and ephemeral", () => {
    expect(command.requiredPermission).toEqual({ kind: "none" });
    expect(command.defaultEphemeral).toBe(true);
  });
});
