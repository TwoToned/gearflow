/**
 * Bot supervisor — the reconciliation loop that runs inside the standalone
 * `gearflow-discord-bot` process.
 *
 * The web process can't call the bot's start/stop functions across the process
 * boundary, so it writes intent to the `discord_integration` row
 * (`botDesiredState`, `botRestartRequestedAt`) and this loop reconciles the
 * running bot to that intent. It also writes a heartbeat every tick so the admin
 * page can tell the supervisor is alive — even when the bot itself is
 * intentionally stopped or failed to start.
 *
 * `reconcileOnce` is pure and dependency-injected so the control logic is unit
 * testable without a DB or a live Discord gateway.
 */

export type DesiredState = "RUNNING" | "STOPPED";

export interface SupervisorState {
  desiredState: DesiredState;
  /** Set by the admin "Restart" action (and config saves). */
  restartRequestedAt: Date | null;
}

export interface SupervisorDeps {
  /** Read control intent from the enabled integration row. null = none enabled. */
  readState: () => Promise<SupervisorState | null>;
  /** True when the discord.js client is connected/ready. */
  isRunning: () => boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Stamp lastHeartbeatAt/botPid on the enabled row. Best-effort. */
  writeHeartbeat: () => Promise<void>;
  log: (msg: string) => void;
}

/**
 * One reconciliation tick. Returns the restart timestamp it has now handled, to
 * thread into the next call so the same restart request isn't actioned twice.
 */
export async function reconcileOnce(
  deps: SupervisorDeps,
  lastHandledRestartAt: number | null,
): Promise<number | null> {
  const state = await deps.readState();

  if (!state) {
    // No enabled integration — nothing to run. Make sure we're stopped.
    if (deps.isRunning()) await deps.stop();
    return lastHandledRestartAt;
  }

  const restartTs = state.restartRequestedAt?.getTime() ?? null;
  let handled = lastHandledRestartAt;

  if (state.desiredState === "STOPPED") {
    if (deps.isRunning()) {
      deps.log("desiredState=STOPPED — stopping bot");
      await deps.stop();
    }
    // Track the restart timestamp even while stopped so a restart requested
    // during a stop doesn't fire the instant we're told to run again.
    return restartTs ?? lastHandledRestartAt;
  }

  // desiredState === RUNNING
  const restartRequested = restartTs != null && restartTs !== lastHandledRestartAt;
  if (restartRequested) {
    deps.log("restart requested — restarting bot");
    await deps.stop();
    await deps.start();
    handled = restartTs;
  } else if (!deps.isRunning()) {
    deps.log("bot down but desiredState=RUNNING — starting");
    await deps.start();
  }

  // The heartbeat is the web process's ONLY window into bot connectivity (it
  // can't call isRunning() across the process boundary). Stamp it only when the
  // client is actually up, so a stale heartbeat unambiguously means "down" —
  // which, combined with desiredState, lets the admin page tell "stopped by
  // admin" from "crashed".
  if (deps.isRunning()) {
    try {
      await deps.writeHeartbeat();
    } catch (err) {
      deps.log(`heartbeat write failed: ${String(err)}`);
    }
  }
  return handled;
}

/**
 * Run the supervisor loop until `signal` aborts. Seeds the handled-restart
 * marker from the current state so a stale `botRestartRequestedAt` on boot
 * doesn't cause a spurious restart right after the initial start.
 */
export async function runSupervisor(
  deps: SupervisorDeps,
  intervalMs: number,
  signal?: { aborted: boolean },
): Promise<void> {
  const initial = await deps.readState();
  let lastHandled = initial?.restartRequestedAt?.getTime() ?? null;

  // First reconcile brings the bot up (or not) per current intent.
  lastHandled = await reconcileOnce(deps, lastHandled);

  while (!signal?.aborted) {
    await sleep(intervalMs, signal);
    if (signal?.aborted) break;
    try {
      lastHandled = await reconcileOnce(deps, lastHandled);
    } catch (err) {
      deps.log(`reconcile tick failed: ${String(err)}`);
    }
  }
}

function sleep(ms: number, signal?: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the event loop alive solely for the timer.
    if (typeof t === "object" && "unref" in t) t.unref();
    if (signal?.aborted) {
      clearTimeout(t);
      resolve();
    }
  });
}
