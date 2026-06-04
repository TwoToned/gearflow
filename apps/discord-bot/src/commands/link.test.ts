import { describe, it, expect, vi } from "vitest";
import { command } from "./link.js";
import { makeMockContext } from "../test-utils.js";

describe("/link command", () => {
  it("asks for an email when none is given", async () => {
    const ctx = makeMockContext({ options: {} });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/provide your email/i);
    expect(ctx.deferred).toHaveLength(0);
  });

  it("renders the constant pending message for a normal start", async () => {
    const post = vi.fn().mockResolvedValue({ status: "pending" });
    const ctx = makeMockContext({ options: { email: "you@example.com" }, api: { post } });
    await command.execute(ctx);
    expect(post).toHaveBeenCalledWith("/link", { email: "you@example.com" });
    expect(ctx.deferred[0]).toEqual({ ephemeral: true });
    expect(ctx.replies[0]?.content).toMatch(/if that email is on a gearflow crew profile/i);
  });

  it("tells an already-linked user who they're linked as", async () => {
    const post = vi.fn().mockResolvedValue({ status: "already_linked", linkedToName: "Sam Lee" });
    const ctx = makeMockContext({ options: { email: "sam@example.com" }, api: { post } });
    await command.execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/already linked.*Sam Lee/i);
  });

  it("is open to anyone (no link required) and ephemeral", () => {
    expect(command.requiredPermission).toEqual({ kind: "none" });
    expect(command.defaultEphemeral).toBe(true);
  });
});
