import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.js";
import type { BotCommand } from "./types.js";

const make = (name: string): BotCommand => ({
  data: { name, description: "x" },
  requiredPermission: { kind: "none" },
  defaultEphemeral: true,
  execute: async () => {},
});

describe("buildRegistry", () => {
  it("maps commands by name", () => {
    const reg = buildRegistry([make("asset"), make("project")]);
    expect([...reg.keys()].sort()).toEqual(["asset", "project"]);
  });

  it("fails fast on a duplicate command name", () => {
    expect(() => buildRegistry([make("asset"), make("asset")])).toThrow(/Duplicate/);
  });

  it("rejects a non-lowercase name", () => {
    expect(() => buildRegistry([make("Asset")])).toThrow(/lowercase/);
  });

  it("rejects a command missing execute", () => {
    const bad = { data: { name: "x", description: "y" }, requiredPermission: { kind: "none" }, defaultEphemeral: true } as unknown as BotCommand;
    expect(() => buildRegistry([bad])).toThrow(/execute/);
  });
});
