import { describe, it, expect } from "vitest";
import { ALL_COMMANDS, buildRegistry, loadCommands } from "./registry";
import type { BotCommand } from "./bot-types";

const dummy = (name: string): BotCommand => ({
  data: { name, description: "test" },
  requiredPermission: { kind: "none" },
  defaultEphemeral: true,
  async execute() {
    /* no-op */
  },
});

describe("buildRegistry", () => {
  it("indexes each command by name", () => {
    const r = buildRegistry([dummy("asset"), dummy("link")]);
    expect(r.size).toBe(2);
    expect(r.get("asset")?.data.name).toBe("asset");
  });

  it("rejects duplicates fail-fast (silent skip = prod gap)", () => {
    expect(() => buildRegistry([dummy("asset"), dummy("asset")])).toThrow(/Duplicate/);
  });

  it("rejects uppercase names (Discord coerces; this prevents drift)", () => {
    expect(() => buildRegistry([dummy("Asset")])).toThrow(/lowercase/);
  });

  it("rejects a command missing execute", () => {
    expect(() =>
      buildRegistry([
        {
          data: { name: "bad", description: "x" },
          requiredPermission: { kind: "none" },
          defaultEphemeral: true,
        } as never,
      ]),
    ).toThrow(/execute/);
  });
});

describe("loadCommands", () => {
  it("returns the canonical command set", () => {
    const r = loadCommands();
    expect([...r.keys()].sort()).toEqual(ALL_COMMANDS.map((c) => c.data.name).sort());
  });
});
