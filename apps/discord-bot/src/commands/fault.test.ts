import { describe, it, expect, vi } from "vitest";
import { command } from "./fault.js";
import { makeMockContext } from "../test-utils.js";

describe("/fault command", () => {
  it("requires both a code and a description", async () => {
    const ctx = makeMockContext({ options: { code: "TTP-042" } });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/asset code and a description/i);
    expect(ctx.deferred).toHaveLength(0);
  });

  it("posts the fault with the interaction id as the Idempotency-Key and confirms in-channel", async () => {
    const post = vi.fn().mockResolvedValue({
      assetTag: "TTP-042",
      severity: "MAJOR",
      holdForRepair: true,
      statusChanged: true,
      newStatus: "IN_MAINTENANCE",
      idempotentReplay: false,
    });
    const ctx = makeMockContext({
      options: { code: "TTP-042", description: "Won't power on", severity: "MAJOR", hold: "true" },
      api: { post },
    });
    await command.execute(ctx);

    expect(post).toHaveBeenCalledWith(
      "/asset/TTP-042/fault",
      { description: "Won't power on", severity: "MAJOR", holdForRepair: true },
      { idempotencyKey: "interaction_1" },
    );
    const embed = ctx.replies[0]?.embeds?.[0] as { title: string; fields: { value: string }[] };
    expect(embed.title).toMatch(/TTP-042/);
    expect(embed.fields.some((f) => /IN_MAINTENANCE/.test(f.value))).toBe(true);
  });

  it("is in-channel by default (shared state) and open to any linked crew", () => {
    expect(command.defaultEphemeral).toBe(false);
    expect(command.requiredPermission).toEqual({ kind: "linkedUser" });
  });
});
