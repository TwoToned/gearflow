import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

const ALL = {
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_APPLICATION_ID: "app-id",
  DISCORD_GUILD_ID: "guild-id",
  GEARFLOW_API_URL: "https://gearflow.test",
  GEARFLOW_BOT_BEARER: "bearer",
  GEARFLOW_DISCORD_SIGNING_SECRET: "sig",
  GEARFLOW_ORG_ID: "org-1",
};

describe("loadEnv", () => {
  it("returns a populated BotEnv when every required var is present", () => {
    const env = loadEnv(ALL as unknown as NodeJS.ProcessEnv);
    expect(env.GEARFLOW_ORG_ID).toBe("org-1");
    expect(env.POLL_INTERVAL_MS).toBe(5000); // default
  });

  it("fails loudly listing every missing required var at once", () => {
    const err = (() => {
      try {
        loadEnv({ DISCORD_BOT_TOKEN: "x" } as unknown as NodeJS.ProcessEnv);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).not.toBeNull();
    const msg = err!.message;
    for (const k of [
      "DISCORD_APPLICATION_ID",
      "DISCORD_GUILD_ID",
      "GEARFLOW_API_URL",
      "GEARFLOW_BOT_BEARER",
      "GEARFLOW_DISCORD_SIGNING_SECRET",
      "GEARFLOW_ORG_ID",
    ]) {
      expect(msg).toContain(k);
    }
  });

  it("accepts a custom POLL_INTERVAL_MS", () => {
    expect(loadEnv({ ...ALL, POLL_INTERVAL_MS: "2000" } as unknown as NodeJS.ProcessEnv).POLL_INTERVAL_MS).toBe(2000);
  });

  it("rejects a too-small POLL_INTERVAL_MS (hammer-the-API guard)", () => {
    expect(() => loadEnv({ ...ALL, POLL_INTERVAL_MS: "100" } as unknown as NodeJS.ProcessEnv)).toThrow(/>= 500/);
  });

  it("rejects a non-numeric POLL_INTERVAL_MS", () => {
    expect(() => loadEnv({ ...ALL, POLL_INTERVAL_MS: "soon" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
