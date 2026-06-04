# 48 — Discord Integration

Status: **in progress** (foundation landed; reviewed via `/autoplan`, dual-voice CEO/Design/Eng/DX).

A Discord bot that bridges Discord and GearFlow: per-project channels, account enrollment, and slash commands for crew to look up assets/projects, pull documents, and log faults from their phone. The bot is a standalone discord.js v14 service. **GearFlow is always the source of truth; the bot holds no DB access.**

## Core architecture decisions (locked)

1. **Bot has zero DB access.** Every read/write goes through signed `src/app/api/discord/v1/*` endpoints, which call shared `Core(orgId, actor, tx)` service functions so `requirePermission` + invariants + `logActivity` run exactly once (the same path server actions use). A bot route has no Better Auth session, so the existing `"use server"` actions cannot be called directly — logic is extracted into plain `src/lib/services/*`.
2. **Per-org config**, not global. `DiscordIntegration` table keyed `organizationId @unique`, mirroring `WooCommerceIntegration`. Guild ID lives on the row, not in env.
3. **Transactional outbox** for events. `DiscordOutbox` rows are written inside the same Prisma `$transaction` as the project/crew mutation, so an event cannot outlive a rolled-back txn. The bot polls `GET /api/discord/v1/outbox?since=<cursor>` (its only state is the cursor). `/reconcile` is a drift backstop, not the primary recovery.
4. **Trust boundary = HMAC.** Per-org `DiscordIntegration.signingSecret` signs `timestamp.body` (replay window). A global `DISCORD_BOT_TOKEN` Bearer gates the outbox pull. See `src/lib/discord/hmac.ts`.
5. **Machine-readable error envelope.** Every endpoint returns `{ ok, data|error:{code,...}, meta }` with a closed `DiscordApiErrorCode` union the bot switches on exhaustively. See `src/lib/discord/api-errors.ts`.
6. **Enrollment via email magic-link** (product decision), HARDENED: constant ephemeral response (no enumeration), rate-limited, single-use hash-at-rest token, org-scoped email resolution, and the token **binds the invoker's Discord ID at issue time** (anti-hijack).

## Reuse (do not rebuild)
- `generatePdf(projectId, orgId, docType)` — `packing-list` (pick list) and `call-sheet` already exist.
- `DamageEvent` is the `/asset fault` target — no new Incident model. Severity = MINOR/MAJOR + a `holdForRepair` flag → `AssetStatus.IN_MAINTENANCE` (there is no `OUT_OF_SERVICE`). `DamageEvent.createdById` is a required `User` FK — non-User freelancers need an explicit creator decision.
- `WooCommerceIntegration` + `verifyWebhookSignature` (HMAC pattern), `CRON_SECRET` Bearer pattern, `logActivity`, `sendEmail`.

## Data model (migration `20260604114413_discord_integration`)
- `DiscordIntegration` (per-org config + heartbeat)
- `DiscordOutbox` (transactional event outbox, monotonic `id` cursor)
- `DiscordAccountLink` (resolved Discord↔CrewMember, org-scoped, unique both ways)
- `DiscordLinkToken` (single-use, hash-at-rest, Discord-ID-bound enrollment token)
- `Project.discordChannelId` (idempotency guard for channel creation)

## v1 scope (read-only first)
Enrollment (`/link`), read commands (`/asset lookup`, `/project info|crew|doc`), `/asset fault`, per-project channels + crew permission sync. **Deferred to v2:** `/asset checkout|checkin`, `/incident`, role-mapping matrix, live-Discord-dropdown admin UI, the bot's reverse API.

## Bot service
Lives in `apps/discord-bot/` (standalone Node service). Command registry: each `src/commands/*.ts` exports a `BotCommand` ({ data, requiredPermission, defaultEphemeral, execute, modal? }); the runner resolves the linked actor once and injects a typed `apiClient` via `CommandContext`. Commands are unit-testable without Discord via `makeMockContext()`. Guild-scoped command deploy (`npm run deploy-commands -- --guild <id>`), never global-on-boot.

## Status / TODO
- [x] Prisma schema + migration
- [x] Error envelope + HMAC contract (+ unit tests)
- [ ] Bot service scaffold + command registry
- [ ] `Core()` service extraction + `src/app/api/discord/v1/*` routes
- [ ] Outbox emission hooks (createProject, crew-assignment writes)
- [ ] `/link` enrollment flow (hardened) + `/discord/verify` endpoint
- [ ] Channel sync (create + permission overwrites + reconcile)
- [ ] `/asset fault` → DamageEvent
- [ ] Admin "Discord Integration" settings page
- [ ] `apps/discord-bot/README.md` operator setup (intents, scopes, perm bits) + `npm run doctor`

See the full reviewed plan + test plan in `~/.gstack/projects/TwoToned-gearflow/`.
