import { captureServerException } from "@/lib/posthog-server";

let installed = false;

/**
 * Install last-resort process-level error handlers.
 *
 * Why this exists: since Node 15 an unhandled promise rejection or uncaught
 * exception terminates the process by default. In production that means the
 * whole web server dies and pm2 restarts it — which users see as an intermittent
 * Cloudflare 502 with NO application-level log to explain it. This net is the
 * backstop for any stray async error.
 *
 * Guarantees the failure is always written to stderr (captured by pm2's log)
 * and reported to PostHog Error Tracking when configured — turning a silent
 * crash into a diagnosable event.
 *
 * Idempotent: safe to call from multiple entrypoints; only the first call wires
 * the listeners. `scope` tags the source in logs and PostHog.
 */
export function installProcessSafetyNet(scope: string): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    // Log + report, but do NOT exit. An unhandled rejection is usually isolated
    // to one async chain; the process itself is still healthy. Crashing the
    // whole server over it is exactly what produced the user-visible 502s.
    // Crash-time floor: minimal work in a process-fault handler; the structured
    // logger is bypassed on purpose here.
    // eslint-disable-next-line no-console
    console.error(`[${scope}] unhandledRejection:`, reason);
    capture(reason, scope, "unhandledRejection");
  });

  process.on("uncaughtException", (err) => {
    // A peer that hung up is NOT an undefined process state — see
    // isPeerDisconnect. Log it so it stays greppable, then carry on serving.
    if (isPeerDisconnect(err)) {
      // Crash-time floor (see above).
      // eslint-disable-next-line no-console
      console.error(`[${scope}] ignored peer disconnect:`, err);
      return;
    }

    // Any other uncaught exception leaves the process in an undefined state.
    // Log + report + flush, then exit(1) so pm2 restarts a clean process rather
    // than serving from a corrupt one.
    // Crash-time floor (see above).
    // eslint-disable-next-line no-console
    console.error(`[${scope}] uncaughtException:`, err);
    const exit = () => process.exit(1);
    // captureServerException never throws (see src/lib/posthog-server.ts).
    void captureServerException(err, { net: "uncaughtException", scope }).finally(exit);
  });
}

/**
 * Socket-level codes that mean the OTHER end went away mid-request: the user
 * navigated off, hit Escape, lost signal, or a proxy timed the connection out.
 *
 * These reach `uncaughtException` when the abort lands in Node's net stack
 * rather than inside a handler that could catch it — Next's dev server throws a
 * bare `Error: aborted` (code `ECONNRESET`) when a request is aborted while a
 * route is still compiling (the #725 crash class `playwright.config.ts` works
 * around by serving a prebuilt `next start` for the harness suite).
 *
 * Exiting on these is worse than the error itself. Nothing in the process is
 * corrupt — no application invariant was touched, only a socket died — yet
 * exit(1) takes down every OTHER in-flight request with it, and in production
 * hands the next visitors a Cloudflare 502 while the container restarts. That
 * is precisely the intermittent-502 failure mode this module was written to
 * stop, so treating a disconnect as fatal turns the safety net into the
 * outage. They are logged but NOT reported to PostHog: a client hanging up is a
 * routine event whose volume scales with traffic, and error tracking is for
 * defects.
 *
 * Node's caveat about resuming after an uncaught exception still governs
 * everything else — this list is deliberately narrow and code-based, never
 * message-matched.
 */
const PEER_DISCONNECT_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
]);

function isPeerDisconnect(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && PEER_DISCONNECT_CODES.has(code);
}

function capture(reason: unknown, scope: string, net: string): void {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  void captureServerException(err, { net, scope });
}

/** Test-only: reset the install guard so each test starts clean. */
export function __resetProcessSafetyNetForTests(): void {
  installed = false;
}
