/**
 * pm2 process definitions for RVLT Flow.
 *
 *   - gearflow : the Next.js web app
 *
 * Start:   pm2 start ecosystem.config.js
 * Reload:  pm2 startOrReload ecosystem.config.js --update-env
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
  ],
};
