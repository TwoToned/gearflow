# GearFlow Discord Bot

Standalone discord.js v14 service. **Holds no database access** — every read/write
goes through signed `GEARFLOW_API_URL/api/discord/v1/*` endpoints. GearFlow is the
source of truth. See `../../FEATUREDOCS/48-discord-integration.md` for the full design.

## Architecture in one line
Discord ⇄ this bot ⇄ (HMAC-signed HTTP) ⇄ GearFlow `/api/discord/v1/*` ⇄ Postgres.
The bot also polls `GET /api/discord/v1/outbox?since=<cursor>` for project/crew events.

## Adding a command (TTHW ~15 min)
Create `src/commands/<name>.ts` exporting a `command: BotCommand`:
```ts
export const command: BotCommand = {
  data: { name, description, options },   // framework-free; converted to discord.js in deploy
  requiredPermission: { kind: "linkedUser" } | { kind: "gearflowRole", anyOf: [...] } | { kind: "none" },
  defaultEphemeral: true,
  async execute(ctx) { /* use ctx.options, ctx.actor, ctx.api, ctx.reply — no discord.js */ },
};
```
The runner resolves the linked actor + live role, enforces the gate + ephemeral
default, and renders any thrown `BotError`. Commands are unit-tested with
`makeMockContext()` — zero Discord, zero network (see `src/commands/asset-lookup.test.ts`).
Then deploy to your dev guild: `npm run deploy-commands -- --guild <id>` (instant;
never global during dev — global propagation takes up to 1h).

## Operator setup (zero → working bot)
1. **Create a Discord Application** — https://discord.com/developers/applications → copy the **Application ID** → `DISCORD_APPLICATION_ID`.
2. **Add a Bot** → reset & copy the **Bot Token** → `DISCORD_BOT_TOKEN`.
3. **Gateway intents** (Bot tab): enable **Server Members Intent** (PRIVILEGED — required to manage channel membership on crew assignment; without it member events never arrive). Guilds intent is default-on.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions: **Manage Channels**, **Manage Roles**, **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**. Copy the generated invite URL.
5. **Invite** the bot to your server with that URL.
6. In **GearFlow → Settings → Discord**: enable the integration, set the guild/category/alert channels, and **generate the signing secret** → `GEARFLOW_DISCORD_SIGNING_SECRET`.
7. Fill `.env` (copy `.env.example`): tokens above + `DISCORD_GUILD_ID`, `GEARFLOW_API_URL`, `GEARFLOW_BOT_BEARER`.
8. `npm install` then `npm run doctor` — green/red checklist (env, token, guild, API reachability).
9. `npm run deploy-commands -- --guild <id>` then `npm run dev`.
10. Smoke test: `/asset code:TTP-042` in your dev guild.

## Local dev
- Use a throwaway personal Discord server as `DISCORD_GUILD_ID` (guild-scoped deploy = instant loop).
- `GEARFLOW_API_URL=http://localhost:3000` against a dev GearFlow with a matching dev signing secret.
- `npm test` runs the pure command/contract tests with no Discord and no network.

## Status
Scaffold. Implemented: command registry + contract, error-code → copy map, HMAC api
client, `/asset lookup` reference command, test harness. TODO (see FEATUREDOCS/48):
runner actor-resolution wiring, outbox poller, `/link`, channel sync, `/asset fault`.
