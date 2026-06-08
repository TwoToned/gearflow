/**
 * pm2 process definitions for GearFlow.
 *
 * Two long-lived processes:
 *   - gearflow             : the Next.js web app
 *   - gearflow-discord-bot : the standalone Discord bot (scripts/discord-bot.ts)
 *
 * The bot was split out of the web server (it used to run in-process via
 * instrumentation.ts) so a discord.js gateway crash can only restart the bot,
 * never take the website down — the root cause of the intermittent 502s.
 *
 * Start both:   pm2 start ecosystem.config.js
 * Reload both:  pm2 startOrReload ecosystem.config.js --update-env
 * Bot only:     pm2 startOrReload ecosystem.config.js --only gearflow-discord-bot
 *
 * The deploy workflow intentionally restarts `gearflow` the way it always has
 * (pm2 restart gearflow) and uses this file only for the bot (--only), so the
 * proven web deploy path is untouched.
 */
module.exports = {
  apps: [
    {
      name: "gearflow",
      script: "npm",
      args: "start",
      env: { NODE_ENV: "production" },
      time: true,
      autorestart: true,
      max_memory_restart: "1G",
    },
    {
      name: "gearflow-discord-bot",
      // Runs via the same npm script as local: tsx --env-file=.env scripts/discord-bot.ts
      script: "npm",
      args: "run bot:start",
      env: { NODE_ENV: "production" },
      time: true,
      autorestart: true,
      // Long-lived gateway + outbox poller. Restart if it leaks past this so a
      // slow leak can't OOM the box (the secondary 502 suspect). Tune to the box.
      max_memory_restart: "400M",
      // If the bot crash-loops (e.g. a bad token), back off instead of hammering
      // Discord's login endpoint.
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
    },
  ],
};
