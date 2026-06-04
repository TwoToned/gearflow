import { describe, it, expect, vi } from "vitest";
import { assertBootRunnable, BootstrapError, fetchBootstrap, type BootstrapConfig } from "./bootstrap.js";
import type { BotEnv } from "./env.js";

const env: BotEnv = {
  GEARFLOW_API_URL: "https://gearflow.test",
  GEARFLOW_BOT_BEARER: "bearer",
  GEARFLOW_ORG_ID: "org-1",
  POLL_INTERVAL_MS: 5000,
};

function fetchOk(data: Partial<BootstrapConfig>): typeof fetch {
  const body: BootstrapConfig = {
    isEnabled: true,
    signingSecret: "sig",
    discordBotToken: "bot-token",
    discordApplicationId: "app-id",
    guildId: "guild-id",
    projectCategoryId: "cat-1",
    archiveCategoryId: "cat-2",
    alertChannelId: null,
    auditChannelId: null,
    channelCreateOnStatuses: ["CONFIRMED"],
    channelArchiveOnStatuses: ["COMPLETED", "INVOICED", "RETURNED", "CANCELLED"],
    postWelcomeOnCreate: true,
    postFaultsToProjectChannel: true,
    botUserId: null,
    ...data,
  };
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, data }), { status: 200 })) as typeof fetch;
}

describe("fetchBootstrap", () => {
  it("calls the bootstrap URL with the global Bearer + org header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const stub: typeof fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            isEnabled: true,
            signingSecret: "sig",
            discordBotToken: "bot-token",
            discordApplicationId: "app",
            guildId: "g",
            projectCategoryId: null,
            archiveCategoryId: null,
            alertChannelId: null,
            auditChannelId: null,
            channelCreateOnStatuses: [],
            channelArchiveOnStatuses: [],
            postWelcomeOnCreate: true,
            postFaultsToProjectChannel: true,
            botUserId: null,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const cfg = await fetchBootstrap(env, stub);
    expect(cfg.guildId).toBe("g");
    expect(calls[0]!.url).toBe("https://gearflow.test/api/discord/v1/integration/bootstrap");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer bearer");
    expect(headers["x-gearflow-org"]).toBe("org-1");
  });

  it("translates SIGNATURE_INVALID into an actionable message naming the env var", async () => {
    const stub = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "SIGNATURE_INVALID", message: "no" } }),
        { status: 401 },
      ),
    ) as typeof fetch;
    await expect(fetchBootstrap(env, stub)).rejects.toMatchObject({
      name: "BootstrapError",
      message: expect.stringContaining("GEARFLOW_BOT_BEARER"),
    });
  });

  it("translates ORG_NOT_CONFIGURED into a clear admin-page hint", async () => {
    const stub = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "ORG_NOT_CONFIGURED", message: "no" } }),
        { status: 409 },
      ),
    ) as typeof fetch;
    await expect(fetchBootstrap(env, stub)).rejects.toMatchObject({
      message: expect.stringContaining("Settings → Discord"),
    });
  });

  it("wraps a network failure in a BootstrapError that names the URL", async () => {
    const stub = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(fetchBootstrap(env, stub)).rejects.toMatchObject({
      message: expect.stringMatching(/integration\/bootstrap[\s\S]*ECONNREFUSED/),
    });
  });
});

describe("assertBootRunnable", () => {
  const baseConfig: BootstrapConfig = {
    isEnabled: true,
    signingSecret: "sig",
    discordBotToken: "bot-token",
    discordApplicationId: "app-id",
    guildId: "guild-id",
    projectCategoryId: null,
    archiveCategoryId: null,
    alertChannelId: null,
    auditChannelId: null,
    channelCreateOnStatuses: [],
    channelArchiveOnStatuses: [],
    postWelcomeOnCreate: true,
    postFaultsToProjectChannel: true,
    botUserId: null,
  };

  it("passes when every required field is present and isEnabled=true", () => {
    expect(() => assertBootRunnable({ ...baseConfig })).not.toThrow();
  });

  it("rejects a disabled integration with a specific message", () => {
    expect(() => assertBootRunnable({ ...baseConfig, isEnabled: false })).toThrow(/disabled/);
  });

  it("lists every missing field in one error", () => {
    expect(() =>
      assertBootRunnable({ ...baseConfig, discordBotToken: null, guildId: null }),
    ).toThrow(/Discord bot token[\s\S]*Guild id/);
  });
});
