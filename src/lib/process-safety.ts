import * as Sentry from "@sentry/nextjs";

let installed = false;

/**
 * Install last-resort process-level error handlers.
 *
 * Why this exists: since Node 15 an unhandled promise rejection or uncaught
 * exception terminates the process by default. In production that means the
 * whole web server (or, after isolation, the standalone Discord bot process)
 * dies and pm2 restarts it — which users see as an intermittent Cloudflare 502
 * with NO application-level log to explain it. The original offender was the
 * in-process discord.js client emitting a gateway `error` event with no
 * listener (see `bot-process.ts`); this net is the backstop for any other stray
 * async error.
 *
 * Guarantees the failure is always written to stderr (captured by pm2's log)
 * and reported to Sentry when configured — turning a silent crash into a
 * diagnosable event.
 *
 * Idempotent: safe to call from multiple entrypoints; only the first call wires
 * the listeners. `scope` tags the source ("web" | "discord-bot") in logs and
 * Sentry.
 */
export function installProcessSafetyNet(scope: string): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    // Log + report, but do NOT exit. An unhandled rejection is usually isolated
    // to one async chain; the process itself is still healthy. Crashing the
    // whole server over it is exactly what produced the user-visible 502s.
    console.error(`[${scope}] unhandledRejection:`, reason);
    capture(reason, scope, "unhandledRejection");
  });

  process.on("uncaughtException", (err) => {
    // An uncaught exception leaves the process in an undefined state. Log +
    // report + flush, then exit(1) so pm2 restarts a clean process rather than
    // serving from a corrupt one.
    console.error(`[${scope}] uncaughtException:`, err);
    try {
      Sentry.captureException(err, { tags: { net: "uncaughtException", scope } });
      void Sentry.flush(2000).finally(() => process.exit(1));
    } catch {
      process.exit(1);
    }
  });
}

function capture(reason: unknown, scope: string, net: string): void {
  try {
    Sentry.captureException(
      reason instanceof Error ? reason : new Error(String(reason)),
      { tags: { net, scope } },
    );
  } catch {
    // Sentry not initialized or failed — the console.error above is the floor.
  }
}

/** Test-only: reset the install guard so each test starts clean. */
export function __resetProcessSafetyNetForTests(): void {
  installed = false;
}
