import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

const ALL = {
  GEARFLOW_BOT_BEARER: "bearer",
  GEARFLOW_ORG_ID: "org-1",
};

describe("loadEnv", () => {
  it("returns a populated BotEnv when both required vars are present", () => {
    const env = loadEnv(ALL as unknown as NodeJS.ProcessEnv);
    expect(env.GEARFLOW_ORG_ID).toBe("org-1");
    expect(env.POLL_INTERVAL_MS).toBe(5000);
    expect(env.GEARFLOW_API_URL).toBe("https://home.twotoned.com.au"); // sensible default
  });

  it("fails loudly listing every missing required var at once", () => {
    const err = (() => {
      try {
        loadEnv({ GEARFLOW_BOT_BEARER: "x" } as unknown as NodeJS.ProcessEnv);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).not.toBeNull();
    expect(err!.message).toContain("GEARFLOW_ORG_ID");
  });

  it("uses a custom GEARFLOW_API_URL when provided", () => {
    const env = loadEnv({ ...ALL, GEARFLOW_API_URL: "http://localhost:3000" } as unknown as NodeJS.ProcessEnv);
    expect(env.GEARFLOW_API_URL).toBe("http://localhost:3000");
  });

  it("accepts a custom POLL_INTERVAL_MS", () => {
    const env = loadEnv({ ...ALL, POLL_INTERVAL_MS: "2000" } as unknown as NodeJS.ProcessEnv);
    expect(env.POLL_INTERVAL_MS).toBe(2000);
  });

  it("rejects a too-small POLL_INTERVAL_MS (hammer-the-API guard)", () => {
    expect(() => loadEnv({ ...ALL, POLL_INTERVAL_MS: "100" } as unknown as NodeJS.ProcessEnv)).toThrow(/>= 500/);
  });

  it("rejects a non-numeric POLL_INTERVAL_MS", () => {
    expect(() => loadEnv({ ...ALL, POLL_INTERVAL_MS: "soon" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});
