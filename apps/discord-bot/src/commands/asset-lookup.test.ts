import { describe, expect, it, vi } from "vitest";
import { command } from "./asset-lookup.js";
import { makeMockContext } from "../test-utils.js";
import { BotError } from "../errors.js";

describe("/asset lookup", () => {
  it("is gated on a linked user and ephemeral by default", () => {
    expect(command.requiredPermission).toEqual({ kind: "linkedUser" });
    expect(command.defaultEphemeral).toBe(true);
  });

  it("asks for a code when none is given (no API call)", async () => {
    const get = vi.fn();
    const ctx = makeMockContext({ options: {}, api: { get } });
    await command.execute(ctx);
    expect(get).not.toHaveBeenCalled();
    expect(ctx.replies[0]?.content).toMatch(/asset code/i);
  });

  it("defers, calls the API with the encoded code, and renders an embed", async () => {
    const get = vi.fn().mockResolvedValue({
      assetTag: "TTP-042",
      description: "Shure SM58",
      status: "AVAILABLE",
      testTagStatus: "CURRENT",
      currentProject: { projectNumber: "TTP001", name: "Pippin" },
    });
    const ctx = makeMockContext({ options: { code: "TTP-042" }, api: { get } });

    await command.execute(ctx);

    expect(ctx.deferred).toHaveLength(1);
    expect(get).toHaveBeenCalledWith("/asset/TTP-042");
    const embed = ctx.replies[0]?.embeds?.[0] as { title: string; fields: { name: string; value: string }[] };
    expect(embed.title).toContain("TTP-042");
    expect(embed.fields.find((f) => f.name === "Assigned to")?.value).toContain("TTP001");
  });

  it("propagates a BotError from the API (runner renders it)", async () => {
    const get = vi.fn().mockRejectedValue(new BotError("ASSET_NOT_FOUND", "nope", { details: { code: "ZZZ" } }));
    const ctx = makeMockContext({ options: { code: "ZZZ" }, api: { get } });
    await expect(command.execute(ctx)).rejects.toBeInstanceOf(BotError);
  });
});
