# Operating the Discord bot

The Discord bot runs as **its own pm2 process** (`gearflow-discord-bot`),
separate from the `gearflow` web app. This is deliberate: the bot used to run
inside the Next.js server, and a discord.js gateway crash there took the whole
website down (intermittent Cloudflare 502s). Isolating it means a bot crash now
only restarts the bot.

## Architecture

- **Process:** `scripts/discord-bot.ts`, launched by pm2 as `gearflow-discord-bot`
  (`npm run bot:start` → `tsx --env-file=.env scripts/discord-bot.ts`). Defined in
  `ecosystem.config.js`.
- **Same code as the web app.** It imports the `@/lib` service layer, so domain
  invariants (`requirePermission`, `logActivity`, transactions) still run exactly
  once — the bot just lives in a different process.
- **No env for Discord.** All credentials/config live in the `discord_integration`
  DB row (bot token is AES-256-GCM encrypted). Configure everything at
  `/settings/discord`.
- **Control plane is the DB.** The web app can't call the bot across the process
  boundary. It writes intent to the row and the bot's supervisor loop reconciles:
  - `botDesiredState` (`RUNNING`/`STOPPED`) — set by the admin Stop/Start buttons.
  - `botRestartRequestedAt` — bumped by Restart and by config/token saves.
  - `lastHeartbeatAt` / `botPid` — written by the bot every ~15s **only while
    connected**. The admin status pill reads this: fresh heartbeat +
    `RUNNING` ⇒ "Bot running"; stale ⇒ down; `STOPPED` ⇒ stopped by admin.
  - `botStartError` — last startup failure (e.g. bad token, disallowed intents),
    surfaced on the admin page so you don't have to SSH in to learn why.
- **Crash safety:** the discord.js client has `error`/`shardError` listeners and
  the process installs an `unhandledRejection`/`uncaughtException` net
  (`src/lib/process-safety.ts`). Failures go to pm2's stderr log and to Sentry
  (if `SENTRY_DSN` is set).

## Everyday operations

```bash
# Status of both processes
pm2 list

# Logs (THIS is where bot crash traces live — not the app's own logging)
pm2 logs gearflow-discord-bot           # live
pm2 logs gearflow-discord-bot --err --lines 200
pm2 describe gearflow-discord-bot       # restarts count, uptime, memory

# Manual control (normally done from /settings/discord instead)
pm2 restart gearflow-discord-bot
pm2 stop gearflow-discord-bot
pm2 start ecosystem.config.js --only gearflow-discord-bot

# After changing the pm2 process list, persist so a reboot brings it back
pm2 save
```

Deploys are automatic on push to `main`: the workflow runs `pm2 restart gearflow`
and `pm2 startOrReload ecosystem.config.js --only gearflow-discord-bot`, then
`pm2 save`.

## Discord Developer Portal setup

1. Create an application + bot; copy the **token**, **application id**.
2. Invite to the guild with scopes `bot applications.commands` and permissions:
   Manage Channels, Send Messages, Read Message History, Manage Roles (Manage
   Roles is needed for per-project channel permission overwrites).
3. At `/settings/discord`: paste token (encrypted on save), app id, guild id.
   Save, wait ~5s, confirm the status pill goes green. Click "Deploy slash
   commands".

**Server Members Intent is OFF** by default and the bot requests only the
`Guilds` intent. Single-ID member lookups work via REST without it. If you later
enable v2 role-mapping (needs the `GuildMembers` privileged intent), you must
re-add the intent in `bot-process.ts` **and** flip "Server Members Intent" ON in
the Developer Portal — otherwise the bot crash-loops at login.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Admin pill red / "still offline" | `botStartError` on the page; `pm2 logs gearflow-discord-bot --err` |
| Bot keeps restarting | `pm2 describe gearflow-discord-bot` (restarts, memory vs `max_memory_restart`); err log for a crash-loop cause (bad token → backoff applies) |
| Website 502 (not the bot) | That's the `gearflow` process, not this one. The split means they fail independently — check `pm2 logs gearflow`. |
| Slash commands missing in Discord | Re-run "Deploy slash commands" on the admin page |
