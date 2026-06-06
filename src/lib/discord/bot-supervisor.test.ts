import { describe, expect, it, vi } from "vitest";
import {
  reconcileOnce,
  runSupervisor,
  type SupervisorDeps,
  type SupervisorState,
} from "./bot-supervisor";

function makeDeps(
  state: SupervisorState | null,
  running: boolean,
): SupervisorDeps & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  writeHeartbeat: ReturnType<typeof vi.fn>;
} {
  let isRunning = running;
  const start = vi.fn(async () => {
    isRunning = true;
  });
  const stop = vi.fn(async () => {
    isRunning = false;
  });
  return {
    readState: async () => state,
    isRunning: () => isRunning,
    start,
    stop,
    writeHeartbeat: vi.fn(async () => {}),
    log: () => {},
  };
}

describe("reconcileOnce", () => {
  it("heartbeats when the bot is up (its only cross-process liveness signal)", async () => {
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: null }, true);
    await reconcileOnce(deps, null);
    expect(deps.writeHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("does NOT heartbeat when the bot is down, so a stale heartbeat means down", async () => {
    const deps = makeDeps({ desiredState: "STOPPED", restartRequestedAt: null }, false);
    await reconcileOnce(deps, null);
    expect(deps.writeHeartbeat).not.toHaveBeenCalled();
  });

  it("starts the bot when RUNNING and currently down, then heartbeats", async () => {
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: null }, false);
    await reconcileOnce(deps, null);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.writeHeartbeat).toHaveBeenCalledTimes(1); // up after start()
  });

  it("does nothing when RUNNING and already up", async () => {
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: null }, true);
    await reconcileOnce(deps, null);
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it("stops the bot when STOPPED and currently up", async () => {
    const deps = makeDeps({ desiredState: "STOPPED", restartRequestedAt: null }, true);
    await reconcileOnce(deps, null);
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.start).not.toHaveBeenCalled();
  });

  it("stops the bot when no integration is enabled", async () => {
    const deps = makeDeps(null, true);
    await reconcileOnce(deps, null);
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });

  it("restarts on a new restart request and records the handled timestamp", async () => {
    const ts = new Date("2026-06-06T10:00:00Z");
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: ts }, true);
    const handled = await reconcileOnce(deps, null);
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(handled).toBe(ts.getTime());
  });

  it("does NOT restart again for an already-handled restart request", async () => {
    const ts = new Date("2026-06-06T10:00:00Z");
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: ts }, true);
    await reconcileOnce(deps, ts.getTime()); // already handled
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  });

  it("a heartbeat-only update (no control change) never triggers a restart", async () => {
    // Heartbeat writes bump updatedAt but not botRestartRequestedAt, so a steady
    // RUNNING+up bot stays untouched across many ticks.
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: null }, true);
    let handled: number | null = null;
    for (let i = 0; i < 5; i++) handled = await reconcileOnce(deps, handled);
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
  });
});

describe("runSupervisor", () => {
  it("seeds the handled-restart marker on boot so a STALE restartRequestedAt doesn't cause a spurious restart", async () => {
    // The bot is already up (pm2 reload of an existing process) and the row has
    // an old restart timestamp. On boot the supervisor must NOT restart it.
    const ts = new Date("2026-06-06T10:00:00Z");
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: ts }, true);
    await runSupervisor(deps, 999_999, { aborted: true });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
    expect(deps.writeHeartbeat).toHaveBeenCalledTimes(1); // running => heartbeats once
  });

  it("starts the bot on boot when it's down and desiredState=RUNNING", async () => {
    const deps = makeDeps({ desiredState: "RUNNING", restartRequestedAt: null }, false);
    await runSupervisor(deps, 999_999, { aborted: true });
    expect(deps.start).toHaveBeenCalledTimes(1);
  });
});
