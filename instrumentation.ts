// Loaded by Next.js once per server start.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Start the in-process Discord bot. Reads the active DiscordIntegration
    // from the DB and skips silently if disabled / unconfigured. No env vars
    // needed for the bot — admin configures everything at /settings/discord.
    // Skipped during builds and in test mode.
    if (
      process.env.NEXT_PHASE !== "phase-production-build" &&
      process.env.NODE_ENV !== "test" &&
      process.env.GEARFLOW_DISCORD_BOT_DISABLED !== "1"
    ) {
      try {
        const { startBot } = await import("./src/lib/discord/bot-process");
        // Don't await — let the server start even if Discord login takes a
        // moment. Errors are logged inside startBot.
        void startBot();
      } catch (err) {
        console.error("[instrumentation] failed to start Discord bot:", err);
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
