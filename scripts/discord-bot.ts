/**
 * Standalone Discord bot process (pm2 app: `gearflow-discord-bot`).
 *
 * Why a separate process: the bot used to run inside the Next.js web server
 * (instrumentation.ts). A discord.js gateway crash there took the whole website
 * down — the root cause of the intermittent Cloudflare 502s. Running it in its
 * own process isolates that blast radius: a bot crash now only restarts the bot,
 * never the website.
 *
 * It imports the SAME `@/lib` service layer as the web app, so domain invariants
 * still run exactly once (the reason the bot was put in-process originally). The
 * web app communicates intent through the `discord_integration` row
 * (botDesiredState / botRestartRequestedAt); the supervisor loop reconciles.
 *
 * Run:  npm run bot:start   (tsx --env-file=.env scripts/discord-bot.ts)
 */
import { installProcessSafetyNet } from "@/lib/process-safety";
import { createSupervisorDeps, stopBot } from "@/lib/discord/bot-process";
import { runSupervisor } from "@/lib/discord/bot-supervisor";

const HEARTBEAT_INTERVAL_MS = Number(
  process.env.DISCORD_HEARTBEAT_INTERVAL_MS ?? 15_000,
);

async function main(): Promise<void> {
  // Initialise Sentry if configured — same server config the web process uses.
  if (process.env.SENTRY_DSN) {
    await import("../sentry.server.config");
  }
  // Last-resort net: a stray rejection is logged, not fatal; an uncaught
  // exception logs + flushes + exits so pm2 restarts a clean bot process.
  installProcessSafetyNet("discord-bot");

  const abort = { aborted: false };
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[discord-bot] ${signal} received — shutting down`);
    abort.aborted = true;
    try {
      await stopBot();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(
    `[discord-bot] supervisor starting (pid=${process.pid}, heartbeat every ${HEARTBEAT_INTERVAL_MS}ms)`,
  );
  await runSupervisor(createSupervisorDeps(), HEARTBEAT_INTERVAL_MS, abort);
}

main().catch((err) => {
  console.error("[discord-bot] fatal:", err);
  process.exit(1);
});
