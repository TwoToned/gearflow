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
- [x] Bot service scaffold + command registry
- [x] `Core()` service extraction + first `src/app/api/discord/v1/*` routes (asset lookup + outbox)
- [x] Outbox emission hooks (createProject, crew-assignment add/remove) — `emitIfDiscordEnabled`
- [x] `/link` enrollment flow (hardened) + `/discord/verify` endpoint
- [x] Channel sync (create + permission overwrites + retroactive grant; converge logic = reconcile primitive)
- [x] `/asset fault` → DamageEvent
- [x] Bot runtime wired (live interaction listener + outbox poll loop) — bot actually runs now
- [x] Bot config moved off the bot host — admin page is the single source of truth for credentials + behavior. Bot reads everything via `/v1/integration/bootstrap` on startup.
- [x] Channel lifecycle rules + archive category — admin picks when channels are created (statuses) and when they're archived (separate category)
- [x] Admin "Discord Integration" settings page
- [~] `apps/discord-bot/README.md` operator setup + `npm run doctor` — scaffolded (47-line README, doctor stub); still needs the full ~15-step guide (privileged Guild Members intent, OAuth scopes, perm-bit invite URL) and to document `DISCORD_BOT_TOKEN` + the per-org signing secret + the new endpoints

## Implementation notes — server side (`src/lib/services/*`, `src/app/api/discord/v1/*`)
The session-less path is the load-bearing part (runtime-killer #1). Layers:

- **`src/lib/services/discord-actor.ts`** — `resolveDiscordActor(orgId, discordUserId, db)` →
  `ServiceActor` (role read LIVE; a freelancer CrewMember with no platform User gets the
  read-only `viewer` baseline). `requireActorPermission(actor, resource, action, db)` enforces
  the SAME `hasPermission()` matrix the session path uses — throws `FORBIDDEN`. No Better Auth
  session is ever touched.
- **`src/lib/discord/route-auth.ts`** — two wrappers. `withDiscordAuth` = global Bearer +
  per-org HMAC over `timestamp.rawBody` + actor resolution from the signed
  `x-gearflow-actor-discord-id` header (server-trusted because the whole request is signed; the
  role is never client-supplied). `withBotAuth` = Bearer only (outbox pull/heartbeat). Both render
  thrown `DiscordApiError`s into the envelope; a handler may return a raw `NextResponse` (e.g. a PDF).
  `requireLinkedActor(ctx)` → `NOT_LINKED` when unlinked.
- **`src/lib/discord/outbox-events.ts`** — shared event-type union + payload shapes (emit + consume
  contract). **`src/lib/services/outbox-service.ts`** — `emitOutboxEvent(tx, …)` (call inside the
  mutation's `$transaction`), `readOutboxEvents` (status-driven, so a lost cursor never replays
  PROCESSED rows), `ackOutboxEvents` (idempotent), `recordDiscordHeartbeat`.
- **Routes:** `GET /asset/[code]` (HMAC + linked actor + `asset:read`), `GET /outbox` (Bearer;
  heartbeat + pull), `POST /outbox/ack`.
- **Env:** global `DISCORD_BOT_TOKEN` (Bearer). Per-org HMAC secret stays in the DB.
- **Bot:** `api-client.ts` now sends `x-gearflow-actor-discord-id` so routes resolve the actor.

Trust boundary + session-less permission enforcement are covered by
`src/app/api/discord/v1/discord-route-auth.int.test.ts` (real Postgres): cross-org-secret,
stale ts, tampered body, disabled integration, NOT_LINKED, FORBIDDEN, freelancer baseline.

**Enrollment (`/link`)** — `src/lib/services/discord-link-service.ts`. `startDiscordLink` returns a
CONSTANT `pending` (no enumeration oracle); durable DB-backed rate limits (3/hr per Discord user,
3/day per crew member, counted from issued tokens); org-scoped email resolve (0 or >1 ⇒ nothing);
opaque `randomBytes(32)` token, **hash-at-rest only**, **invoker Discord id bound at issue time**
(anti-hijack), single-use. `consumeDiscordLink` claims atomically (`updateMany` guarded on
`consumedAt null AND expiresAt > now`), rejects re-link, emits `discord.link.confirmed`. Routes:
`POST /v1/link`, and the unauthenticated `/api/discord/verify` (GET = confirm button so email
link-scanners can't burn the token on a prefetch; POST = consume). Security pipeline covered by
`src/lib/services/discord-link.int.test.ts` (test plan #5). Bot: `commands/link.ts`.

**Channel sync** — the bot has no DB, so it reads the desired state and writes back the channel id.
App: `src/lib/services/channel-sync-service.ts` — `getProjectChannelSpec` (name, archive flag,
existing channel id, linked member set, pending-access count), `recordProjectChannelId` (the
`discordChannelId` idempotency guard — first writer wins, returns the effective id so a race-loser
discards its channel), `getCrewActiveProjects` (retroactive grant after a late link). Routes (Bearer):
`GET /project/:id/channel-spec`, `POST /project/:id/channel`, `GET /crew/:id/channels`. Covered by
`channel-sync.int.test.ts` (test plan #6). Bot (`apps/discord-bot/src`): `outbox-consumer.ts`
converges to desired state (idempotent; = the /reconcile primitive) with a per-project mutex; `pollOnce`
processes in id order, acks the successful prefix, stops on first failure, advances the cursor only past
acked events. `channel-name.ts` slugs `CODE-name`; `discord-channel-gateway.ts` is the only discord.js
module. v2: a `/reconcile` slash command (the converge primitive already exists).

**Runtime wiring** — what makes the bot actually answer commands and create
channels (not just scaffold). App: `GET /api/discord/v1/me` returns the resolved
actor link for the signed Discord invoker (drives the bot's `resolveActor`), `GET
/api/discord/v1/integration/config` returns `{ guildId, projectCategoryId, alertChannelId,
auditChannelId }` (system Bearer-only; the bot reads it on startup), and `GET
/api/discord/v1/health` is the unauth liveness probe `doctor` hits. Bot
(`apps/discord-bot/src`): `env.ts` validates required env at boot (fails loudly,
lists every missing var); `runner-deps.ts` builds the production `RunnerDeps`
(`resolveActor` calls `/me`, `apiFor` builds a per-actor `GearFlowApiClientImpl`);
`index.ts` rewired — `client.on(InteractionCreate)` dispatches through `handleInteraction`,
`client.once(ClientReady)` fetches the guild, builds a `DiscordChannelGateway`,
loads the integration config, and starts a recursive `setTimeout` poll loop calling
`pollOnce` every `POLL_INTERVAL_MS` (default 5s; exponential backoff to 60s on
repeated failure). SIGINT/SIGTERM stops the loop, destroys the client, exits 0.
Single-org-per-process for v1 (env-configured `GEARFLOW_ORG_ID` only —
everything else comes via bootstrap). Cursor is in-memory — the outbox read is
status-driven, so a restart with cursor=0 only re-pulls PENDING rows.

**Config-on-the-admin-page architecture** (bot is two env vars now). Migration
`20260604140000_discord_integration_config` adds 7 columns to `DiscordIntegration`:
`discordBotToken` (AES-256-GCM encrypted at rest, key derived from
`BETTER_AUTH_SECRET` via HKDF-SHA256 — see `src/lib/crypto/secret-vault.ts`),
`discordApplicationId`, `archiveCategoryId`, `channelCreateOnStatuses`
(`ProjectStatus[]`, default `[CONFIRMED]`), `channelArchiveOnStatuses` (default
`[COMPLETED, INVOICED, RETURNED, CANCELLED]`), `postWelcomeOnCreate`, and
`postFaultsToProjectChannel`. Server actions: `setDiscordCredentials({botToken})`
encrypts before storing, never returns it back (the admin page surfaces only
`hasDiscordBotToken: boolean`); `updateDiscordIntegrationConfig` covers the
behavior fields. New route `GET /api/discord/v1/integration/bootstrap`
(Bearer-only, single-call) returns everything the bot needs to login + sign +
converge channels. Bot side: `env.ts` shrinks to `GEARFLOW_BOT_BEARER` +
`GEARFLOW_ORG_ID` (plus optional `GEARFLOW_API_URL` defaulted to twotoned prod);
`bootstrap.ts` fetches the config with friendly error messages for wrong-Bearer
and not-configured; `index.ts` bootstraps **before** Discord login.
`deploy-commands.ts` does the same (pulls application id + guild id from
GearFlow instead of `.env`). `doctor.ts` runs through bootstrap reachability +
"is the config complete?" checks. Lifecycle rules: `shouldHaveChannel(status,
createOn, archiveOn, hasChannelAlready)` (in `src/lib/discord/project-statuses.ts`)
returns `{shouldExist, shouldArchive}`; `getProjectChannelSpec` carries those
plus `targetCategoryId` (active vs archive); bot's `convergeProject` no-ops if
`!shouldExist+no channel`, creates+optionally welcomes if `shouldExist+no channel`,
moves to archive category + locks if `shouldArchive+channel`, moves back to
active category if `!shouldArchive+channel in archive`. New event
`project.status.changed` emitted from `updateProject` + `updateProjectStatus`
inside their `$transaction` so a status flip triggers archive/un-archive within
one poll cycle. `DiscordChannelGateway` gains `moveToCategory` + `postWelcome`.

**`/asset fault`** — `src/lib/services/asset-fault-service.ts`. Migration
`20260604130000_discord_fault_reporter` adds `DamageEvent.reportedByCrewMemberId` (true reporter)
+ unique `discordIdempotencyKey`. createdById = the reporter's linked User, else a per-org system
actor (owner→admin→any) — resolves the required-FK runtime-killer for freelancers; the same id backs
the activity-log FK. Severity is MINOR/MAJOR only (no TOTAL/out_of_service); `holdForRepair` →
`IN_MAINTENANCE` via a guarded `updateMany` (AVAILABLE/RESERVED only, never clobbers CHECKED_OUT).
Reporting is open to linked crew; the flip needs `maintenance:create`. Idempotent on the Discord
interaction id. Route `POST /v1/asset/:code/fault`; bot `commands/fault.ts` (slash options + in-channel
embed; photo-in-modal deferred to v2). Covered by `asset-fault.int.test.ts` (test plan #7).

**Admin settings** — `src/app/(app)/settings/discord/page.tsx` (+ INTEGRATIONS nav entry) backed by
`src/server/discord-integration.ts`. Renders ENTIRELY from the DB, never awaiting the bot: a
connection-health card leads (online/offline derived from `lastHeartbeatAt`, dot+text via
`StatusIndicator` per DESIGN.md §203 — never a Badge); the linked-accounts roster lists unlinked crew
too with an "X of Y linked" summary; set-once config is collapsible (text inputs, not live dropdowns);
signing-secret show/hide/copy/regenerate; recent activity from `logActivity`; unlink via `Dialog`.
Config schema in `src/lib/validations/discord-integration.ts`.

## Status: v1 server + admin complete
All six build-order steps land with unit + full-pipeline integration coverage (test plan #1–#7).
Verified: app `tsc` + `next build` clean (the build catches Next route-type checks `tsc --noEmit`
misses), 2015 unit + 265 integration + 35 bot tests green, ESLint clean. Remaining for a live rollout
is bot RUNTIME wiring (gateway gateway-intents, the poll loop, modal UX) and the v2 deferrals
(`/asset checkout|checkin`, `/incident`, role-mapping, live-dropdown admin UI, a `/reconcile` command).

See the full reviewed plan + test plan in `docs/designs/discord-bot-*.md`.
