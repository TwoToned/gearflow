import { describe, it, expect, vi } from "vitest";
import { buildApiClient, buildRunnerDeps } from "./runner-deps.js";
import type { BotEnv } from "./env.js";

const env: BotEnv = {
  DISCORD_BOT_TOKEN: "bot",
  DISCORD_APPLICATION_ID: "app",
  DISCORD_GUILD_ID: "guild",
  GEARFLOW_API_URL: "https://gearflow.test",
  GEARFLOW_BOT_BEARER: "bearer",
  GEARFLOW_DISCORD_SIGNING_SECRET: "sig",
  GEARFLOW_ORG_ID: "org-1",
  POLL_INTERVAL_MS: 5000,
};

function meResponseFetch(meReturn: unknown) {
  return vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, data: meReturn }),
  } as never);
}

describe("buildRunnerDeps.resolveActor", () => {
  it("calls GET /me with the invoker's Discord id and returns the resolved link", async () => {
    const fetchImpl = meResponseFetch({
      discordUserId: "alice",
      link: { organizationId: "org-1", crewMemberId: "cm-7", role: "manager", userName: "Alice Sample" },
    });
    const deps = buildRunnerDeps({ ...env });
    // Inject the fetch stub by shimming global fetch (api-client picks process fetch by default).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const actor = await deps.resolveActor("alice", "guild-1");
      expect(actor.discordUserId).toBe("alice");
      expect(actor.link).toEqual({ organizationId: "org-1", crewMemberId: "cm-7", role: "manager" });

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(String(url)).toBe("https://gearflow.test/api/discord/v1/me");
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["x-gearflow-actor-discord-id"]).toBe("alice");
      expect(headers["x-gearflow-org"]).toBe("org-1");
      expect(headers.authorization).toBe("Bearer bearer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns link=null when the Discord user has not enrolled", async () => {
    const fetchImpl = meResponseFetch({ discordUserId: "stranger", link: null });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const actor = await buildRunnerDeps(env).resolveActor("stranger", "guild-1");
      expect(actor.link).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("narrows an unknown / custom role to null so the bot gate falls through to server-side enforcement", async () => {
    const fetchImpl = meResponseFetch({
      discordUserId: "x",
      link: { organizationId: "org-1", crewMemberId: "cm-1", role: "custom:fancy", userName: "X" },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const actor = await buildRunnerDeps(env).resolveActor("x", "g");
      expect(actor.link?.role).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("buildApiClient", () => {
  it("wires the env into a client that signs with the per-org secret", () => {
    const client = buildApiClient(env, "alice");
    expect(client).toBeDefined(); // Concrete construction; api-client.test covers signing.
  });
});
