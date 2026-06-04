# Discord Bot — Session Handoff

**If you're a fresh session: read this file first, then `FEATUREDOCS/48-discord-integration.md`.**
Everything below is committed to the `feat/discord-bot` branch — no prior session memory needed.

## Where you are
- **Branch:** `feat/discord-bot` (off current `main`, includes merge #131/#132).
- **This is a git worktree.** Run all work from this directory. Do NOT touch the main
  checkout (`/Users/jayden/code/ttp-assetmanagement`) — a parallel session uses it.
- **Verify the foundation is intact:**
  ```bash
  npm test          # full app suite — expect ~1985 passing (incl. 11 src/lib/discord tests)
  npx tsc --noEmit  # app typecheck — clean
  cd apps/discord-bot && npm test && npx tsc --noEmit   # bot package — 13 tests, clean
  ```
- If `node_modules`/`.env` are missing (fresh worktree), bootstrap per root `CLAUDE.md`:
  `cp <main>/.env .` → `npm install --legacy-peer-deps` → `npx prisma generate`. The bot
  package needs its own `cd apps/discord-bot && npm install`.

## What this is
A Discord bot for GearFlow (AV/theatre rental SaaS). Crew act on assets/projects and
get project channels from Discord. Bot is a standalone discord.js v14 service that holds
**no DB access** — it calls signed GearFlow endpoints. GearFlow is the source of truth.

It was designed via `/autoplan` (dual-voice CEO/Design/Eng/DX review). The full reviewed
plan with consensus tables + decision audit is in `docs/designs/discord-bot-plan-and-review.md`.
The test plan is `docs/designs/discord-bot-test-plan.md`.

## Locked decisions (do not re-litigate)
1. **Bot has zero DB access.** All reads/writes go through signed `src/app/api/discord/v1/*`
   routes that call shared `Core(orgId, actor, tx)` service fns so `requirePermission` +
   invariants + `logActivity` run exactly once.
2. **Per-org config** — `DiscordIntegration` table keyed `organizationId @unique` (mirrors
   `WooCommerceIntegration`). Guild ID lives on the row, not env.
3. **Transactional outbox** — `DiscordOutbox` written inside the same `$transaction` as the
   mutation. Bot polls `GET /api/discord/v1/outbox?since=<cursor>`. `/reconcile` is a drift
   backstop, not primary recovery.
4. **HMAC trust boundary** — per-org `signingSecret` signs `timestamp.body` (`src/lib/discord/hmac.ts`);
   global `DISCORD_BOT_TOKEN` Bearer gates the outbox pull.
5. **Machine-readable error envelope** — `src/lib/discord/api-errors.ts` (closed code union;
   bot mirrors it in `apps/discord-bot/src/errors.ts`, exhaustive `never` switch).
6. **Enrollment = email magic-link** (product decision), HARDENED — see runtime-killers.
7. **Channels KEPT in v1** (user override). Read-only commands first; defer
   checkout/checkin/incident/admin-dropdowns/role-mapping to v2.

## 3 runtime-killers the original plan would have shipped — must handle
1. **`requirePermission()` needs a Better Auth session** — a bot route has none. Extract
   logic into `src/lib/services/*` `Core(orgId, actor, tx)` called by BOTH the server
   action and the discord route. Naive reuse of the `"use server"` actions throws at runtime.
2. **`/link` token must bind the invoker's Discord ID at issue time** (`DiscordLinkToken.discordUserId`),
   or a leaked link lets an attacker attach their own Discord account to the victim.
3. **`DamageEvent.createdById` is a required `User` FK** — freelancer `CrewMember`s have no
   `User` and will 500 on `/asset fault`. Decide: gate on linked User / system service-User +
   `reportedByCrewMemberId` column / make nullable. Decide BEFORE coding `/asset fault`.

Other must-knows: no `OUT_OF_SERVICE` AssetStatus (map fault-hold → `IN_MAINTENANCE`);
`DamageSeverity` is MINOR/MAJOR/TOTAL (no "out of service" — that's a separate `holdForRepair`
flag); `packing-list` + `call-sheet` PDFs already exist via `generatePdf` (don't rebuild);
no generic Incident model (use `DamageEvent`); exclude `isTemplate:true` projects from channels.

## What already exists (done, tested)
- **Schema + migration** `prisma/migrations/20260604114413_discord_integration/` — `DiscordIntegration`,
  `DiscordOutbox`, `DiscordAccountLink`, `DiscordLinkToken`, `Project.discordChannelId`.
  NOTE: dev DB has pre-existing drift (unrelated); migration was hand-written to match Prisma
  output. CI `migrate deploy` consumes it. Don't `migrate dev`/reset the shared dev DB.
- **`src/lib/discord/api-errors.ts`** — error envelope + code union (+ tests).
- **`src/lib/discord/hmac.ts`** — sign/verify, replay window, no length-throw (+ tests).
- **`apps/discord-bot/`** — bot scaffold: `BotCommand`/`CommandContext` (framework-free,
  testable), `errors.ts` (code→copy map), `api-client.ts` (HMAC), `registry.ts` (fail-fast),
  `commands/asset-lookup.ts` (reference), `test-utils.ts` (`makeMockContext`), `runner.ts`
  (discord.js adapter, scaffold), `deploy-commands.ts`, `doctor.ts`, README (operator setup).

## Build order (next steps — from the eng review)
1. `Core(orgId, actor, tx)` service extraction + first `src/app/api/discord/v1/*` route +
   a route-auth wrapper (`withDiscordAuth` using `hmac.ts` + `api-errors.ts`) + `/outbox` GET.
2. Outbox emission hooks in `createProject` and crew-assignment writes (inside `$transaction`).
3. `/link` enrollment (hardened: constant ephemeral response, rate-limit per-Discord-user +
   per-email, org-scoped email resolve, single-use hash-at-rest token, Discord-ID-bound) +
   `/discord/verify` unauthenticated page.
4. Channel sync (create + permission overwrites; `discordChannelId` idempotency guard; grant
   access retroactively when a crew member links after assignment).
5. `/asset fault` → `DamageEvent` (resolve the `createdById` FK decision first).
6. Admin "Discord Integration" settings page (copy `src/app/(app)/settings/woocommerce/page.tsx`;
   connection-health card from `lastHeartbeatAt`, linked-accounts roster incl. unlinked, dot+text
   status per DESIGN.md §203 — NOT a Badge; renders from DB, never blocks on the bot).

## Conventions (from root CLAUDE.md)
Atomic commits; update `FEATUREDOCS/48` after changes; `"use server"` files call `serialize()`
+ `logActivity()`; never re-export types from server files; Prisma client from
`@/generated/prisma/client`; commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Loose end
My contracts commit also accidentally landed on `feat/move-and-add-actions` (parallel session
moved the checkout mid-task). You chose to leave that branch alone — harmless, identical files.
