import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { discordIntegration: { findFirst, updateMany } },
}));

import { getBotStatus, requestBotRestart, requestBotStop } from "./bot-control";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("getBotStatus", () => {
  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockClear();
  });

  it("is not running when no integration is enabled", async () => {
    findFirst.mockResolvedValue(null);
    const s = await getBotStatus(NOW);
    expect(s.running).toBe(false);
    expect(s.organizationId).toBeNull();
  });

  it("is running with a fresh heartbeat and desiredState=RUNNING", async () => {
    findFirst.mockResolvedValue({
      organizationId: "org_1",
      botDesiredState: "RUNNING",
      lastHeartbeatAt: new Date(NOW.getTime() - 5_000), // 5s ago
      botStartError: null,
      botPid: 4242,
    });
    const s = await getBotStatus(NOW);
    expect(s.running).toBe(true);
    expect(s.pid).toBe(4242);
  });

  it("is NOT running when the heartbeat is stale (crashed/down)", async () => {
    findFirst.mockResolvedValue({
      organizationId: "org_1",
      botDesiredState: "RUNNING",
      lastHeartbeatAt: new Date(NOW.getTime() - 120_000), // 2 min ago
      botStartError: null,
      botPid: 4242,
    });
    const s = await getBotStatus(NOW);
    expect(s.running).toBe(false);
  });

  it("is NOT running when stopped by admin even if the heartbeat is fresh", async () => {
    findFirst.mockResolvedValue({
      organizationId: "org_1",
      botDesiredState: "STOPPED",
      lastHeartbeatAt: new Date(NOW.getTime() - 1_000),
      botStartError: null,
      botPid: 4242,
    });
    const s = await getBotStatus(NOW);
    expect(s.running).toBe(false);
    expect(s.desiredState).toBe("STOPPED");
  });

  it("surfaces the last startup error", async () => {
    findFirst.mockResolvedValue({
      organizationId: "org_1",
      botDesiredState: "RUNNING",
      lastHeartbeatAt: null,
      botStartError: "Used disallowed intents",
      botPid: null,
    });
    const s = await getBotStatus(NOW);
    expect(s.running).toBe(false);
    expect(s.startError).toBe("Used disallowed intents");
  });
});

describe("requestBotStop", () => {
  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockClear();
  });

  it("writes desiredState=STOPPED and clears any stale startup error", async () => {
    findFirst.mockResolvedValue(null);
    await requestBotStop();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { botDesiredState: "STOPPED", botStartError: null },
      }),
    );
  });
});

describe("requestBotRestart", () => {
  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockClear();
  });

  it("writes desiredState=RUNNING + a fresh restart timestamp", async () => {
    findFirst.mockResolvedValue(null);
    await requestBotRestart();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          botDesiredState: "RUNNING",
          botRestartRequestedAt: expect.any(Date),
        }),
      }),
    );
  });
});
