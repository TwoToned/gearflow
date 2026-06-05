# Discord Bot — v2 / Follow-ups

**Status:** planning. v1 is live in production (v0.13.0.1).
**Companion docs:** `FEATUREDOCS/49-discord-integration.md`, `docs/designs/discord-bot-HANDOFF.md`, `docs/designs/discord-bot-plan-and-review.md`, `docs/designs/discord-bot-test-plan.md`.

## Where v1 left off

v1 ships a working bot: `/link` enrollment, `/asset lookup`, `/project info|crew|doc`, `/asset fault → DamageEvent`, automatic per-project channels with crew permission sync, status-driven create/archive lifecycle. The bot runs in-process via `instrumentation.ts`; the standalone bot service was deleted in v0.12.0.0. All Discord configuration (bot token, app id, guild id, categories, status rules, behavior toggles) lives in the `DiscordIntegration` row; there is no `.env` for Discord. Admin saves auto-restart the bot in-process; status pill polls every 10s.

The intent set was reduced to `[Guilds]` only in v0.13.0.1 (the privileged `GuildMembers` intent was rejected at login because the Developer Portal toggle isn't on, and we don't actually use full-member-list features). **This decision blocks v2 role-mapping until we add the intent back AND admins flip the toggle** — see "Role-mapping matrix" below.

## v2 ordering principles

1. **Verify v1 in the real world before building v2.** Section 1 of the v2 list is real-world smoke testing on a live Discord server with real crew. Most of what looks like "v1 done" is actually "v1 unit-tested + CI-passing"; nothing is proven against a real Discord gateway until a real user runs `/link` and a real project flips to CONFIRMED.
2. **Operability before features.** A failed-to-start activity log and a doctor command are 30-minute changes that save hours of SSH-into-pm2 debugging. Do them before any new command.
3. **Cluster commands by their dependencies.** `/asset checkout|checkin` and `/reconcile` need a channel allowlist; `/incident` doesn't. Build the allowlist primitive once.
4. **Role-mapping last** — it requires the `GuildMembers` intent back, which requires a Developer Portal change AND an operator runbook update. Don't take that dependency until the value is clear.

---

## 1. Real-world verification

### 1.1 End-to-end smoke test with a real bot token

**Why:** CI proves the code compiles and the unit tests pass. It does not prove the bot can actually connect to Discord with the credentials configured in the admin UI, nor that the `/api/admin/discord/deploy-commands` route successfully pushes the slash command registry. The v0.13.0.1 intent hotfix is the most recent reminder of how easy it is for a problem to be invisible until you try to login.

**Approach:**
1. In Discord Developer Portal: create a fresh bot or reuse the existing one. Confirm the **token**, **application id**, and a target **guild id** (test server, not customer-facing).
2. Generate an invite URL with scopes `bot applications.commands` and permission bits for Manage Channels + Send Messages + Read Message History + Manage Roles (Manage Roles needed for permission overwrites on per-project channels). Invite to test guild.
3. In GearFlow at `/settings/discord`: paste the token (encrypted on save), app id, and guild id. Save. Wait ~5s. Confirm status pill flips green.
4. Click "Deploy slash commands". Confirm the activity log row appears with the command list. In Discord, `/asset lookup` should now appear in the slash command picker.
5. Tail `pm2 logs gearflow-out.log` — should see `[discord-bot] logged in as <bot name>#<discrim>` and no errors.

**Touch points:** none in code. Pure ops verification.

**Open questions:** none. Do this first; it gates everything else.

### 1.2 Channel lifecycle drill

**Why:** The status-driven create/archive rules (`channelCreateOnStatuses`, `channelArchiveOnStatuses`) are wired via the outbox + `channel-sync` service. The integration tests cover the data shape, but not the actual Discord side effects.

**Approach:**
1. Create a test project. Status: `ENQUIRY`. Confirm no Discord channel is created (per default `channelCreateOnStatuses: [CONFIRMED]`).
2. Flip status → `CONFIRMED`. Within a few seconds (next outbox poll), a channel should appear in the configured project category, named per the slug convention (`<project-code>-<slug>`).
3. Assign a crew member who has linked Discord. Confirm they get the permission overwrite (can see + send in the channel).
4. Assign a crew member who has NOT linked. Save. Later, link their account via `/link`. Confirm retroactive permission grant lands within one outbox cycle.
5. Flip status → `COMPLETED`. Confirm the channel moves to the configured archive category (NOT deleted — archived).

**Touch points:** `src/lib/services/channel-sync.ts`, `src/server/projects.ts` (status-change outbox emit), the polling loop in `bot-process.ts`.

**Open questions:**
- What's the user-visible failure mode if Manage Channels permission is missing? Currently I believe the bot just logs an error and the channel never appears. The admin sees nothing. → This is a candidate for item 2.1 (failed activity log).

### 1.3 `/link` flow with a real crew member

**Why:** The hardened anti-hijack token binding (token bound to Discord ID at issue time) and the constant "if that email is on file" response have unit tests but no real-world validation. Email deliverability through Resend in prod also unverified for this specific template.

**Approach:**
1. In Discord, the bot DMs the crew member after their first `/link <email>` interaction (or replies ephemerally in the channel — confirm which).
2. Crew clicks the magic link. Confirm `/discord/verify` page renders the confirmation, the `DiscordAccountLink` row is created, and the admin roster updates "X of Y linked".
3. Repeat the same `/link <email>` from a DIFFERENT Discord account to confirm the hijack path is closed (token issued to user A should not be redeemable when user B clicks it).

**Touch points:** `src/lib/services/discord-link-service.ts`, `src/app/discord/verify/page.tsx`, the email template.

### 1.4 `/asset fault` from a phone

**Why:** Mobile is the actual use case — a tech finds a busted item on site and reports it without opening the app. The modal-vs-buttons UX decision was made in v1 (modal). Real-device testing exposes layout issues that desktop testing misses.

**Approach:**
1. From the iOS / Android Discord client, run `/asset fault assetTag:<tag>`.
2. Confirm the modal opens, the severity picker is usable, and the photo attach button works.
3. Submit. Confirm a `DamageEvent` row is created with reporter, severity, photo S3 URL, and the description.
4. With "Hold for repair" checked, confirm the asset status flips to `IN_MAINTENANCE` (the guarded `updateMany` in `asset-fault-service.ts`).
5. With "Hold for repair" unchecked, confirm the asset status is unchanged.

**Touch points:** `src/lib/discord/commands/fault.ts`, `src/lib/services/asset-fault-service.ts`.

---

## 2. Operability gaps

### 2.1 Rewrite the operator docs for the in-process model

**Why:** The old `apps/discord-bot/README.md` described a standalone Node service with `DISCORD_BOT_TOKEN` in `.env` and `npm run start`. That entire model was deleted. Someone reading the old README today would be misled in every paragraph.

**Approach:** New file at `docs/operations/discord-bot.md`. Covers:
- Discord Developer Portal setup (create app, generate token, invite URL with correct scopes + permission bits, why "Server Members Intent" is OFF and when it'd need to be ON)
- The admin page workflow (paste token → save → "Deploy slash commands" → confirm online)
- The in-process lifecycle (`instrumentation.ts` boots the bot; admin save calls `restartBot()`; `bot-process.ts` is the single owner of the discord.js Client; `globalThis` singleton survives Next hot reloads)
- Troubleshooting (where to find logs, common errors, how to identify which org's bot is failing)

**Touch points:** new doc; delete `apps/discord-bot/README.md` if anything left there (should already be gone after v0.12.0.0).

### 2.2 `discord.bot.failed_to_start` activity log row

**Why:** `bot-process.ts → startBot()` currently catches errors and `console.error`s them. The admin page's status pill goes red, but the admin has no way to learn WHY without SSHing into pm2. "Used disallowed intents" vs "ECONNREFUSED" vs "wrong token" look identical from the admin's perspective.

**Approach:**
- In `bot-process.ts`, on caught startup error, write an `activityLog` row with `entityType: "discord_integration"`, `action: "ERROR"`, `summary: "Bot failed to start: <error.message>"`, and `details: { error: error.message, code: error.code }`.
- The admin page already renders `recentActivity` from the integration's activity log entries — the new row appears there without further UI work.
- Stretch: render distinct types differently. UPDATE rows are blue, ERROR rows are red.

**Touch points:** `src/lib/discord/bot-process.ts`, possibly `src/app/(app)/settings/discord/page.tsx` (visual differentiation).

**Open questions:**
- How noisy is this if the bot is intentionally disabled (no token configured)? Need a guard so we don't write an ERROR row for "no token, nothing to start" — that's expected, not failure.

### 2.3 `npm run doctor` / in-admin "Diagnose" button

**Why:** After the smoke test in 1.1 there will be a runbook for "what to check when the bot's offline". Codify that into a tool. Bonus: it also serves as a v1 acceptance test we run after every deploy.

**Approach:** A POST endpoint `/api/admin/discord/diagnose` that:
1. Reads the integration row. Reports presence/absence of each field.
2. Decrypts the bot token (`secret-vault`); reports decryption success.
3. Calls Discord REST `/users/@me` with the token; reports HTTP status + bot user details.
4. Calls Discord REST `/guilds/<guildId>`; reports name + permission flags the bot has there.
5. Lists deployed slash commands via `/applications/<appId>/guilds/<guildId>/commands`.
6. Tries the configured project category via `/channels/<categoryId>`; confirms it's `GUILD_CATEGORY`.

Returns a structured report; UI renders as a checklist with green/red per item. No actual Discord state is mutated.

**Touch points:** new `src/app/api/admin/discord/diagnose/route.ts`; new "Diagnose" button on the admin page; possibly a new section in `src/lib/discord/diagnose.ts` (testable in isolation).

### 2.4 `GuildMembers` intent operator note

**Why:** We dropped it in v0.13.0.1. The single-ID `guild.members.fetch(id)` we use today works via REST. But v2 role-mapping (item 4.2) needs full member-list features. When that ships, we'll need to add the intent back AND tell the operator to flip the "Server Members Intent" toggle in the Developer Portal — without that toggle, the bot crash-loops the same way it did before the hotfix.

**Approach:** Just a section in `docs/operations/discord-bot.md` from item 2.1, with the explicit before/after intent change and the Developer Portal click path. Cross-reference from the role-mapping section when we write it.

---

## 3. v2 commands

### 3.1 `/asset checkout` + `/asset checkin`

**Why:** Move the warehouse flow into Discord so a tech can grab gear without opening the app. The pull-sheet workflow stays in GearFlow; this is for ad-hoc grabs.

**Approach:**
- `/asset checkout assetTag:<tag> project:<project-code>` → reserves the asset against that project's CHECKED_OUT line item. Must verify the actor has `assets:checkout` permission and the project is in a checkout-eligible status.
- `/asset checkin assetTag:<tag>` → returns the asset to inventory. Releases the line-item reservation.
- **Channel allowlist required.** This is sensitive — random crew in a wrong channel shouldn't be able to check out kit. Add a config field `checkoutAllowedChannelIds: string[]` to `DiscordIntegration`. The command refuses (ephemeral) if invoked outside an allowlisted channel.
- Reuse the existing `checkOutItems` / `checkInItems` server actions; do not duplicate the transaction logic.

**Touch points:** new `src/lib/discord/commands/asset-checkout.ts` + `asset-checkin.ts`; extend `DiscordIntegration` schema with `checkoutAllowedChannelIds`; extend admin page with the allowlist editor.

**Open questions:**
- Should the per-project channel auto-add itself to the allowlist when the project is `PREPPING` or `CHECKED_OUT`? Probably yes; an admin-curated set on top of an auto-allowlist would be confusing. Worth a CEO/eng-review pass.
- What about kits? Kit checkout in v1 is `checkOutKit` (atomic kit + contents). If a crew scans a kit's tag via `/asset checkout`, route to `checkOutKit` per the same logic as the warehouse page.

### 3.2 `/incident`

**Why:** Lighter than `/asset fault` — logs an incident against a project, not a specific asset. Use cases: "client was rude", "venue access denied", "ran out of gaff" — anything project-level that's worth a paper trail but doesn't fit the damage-event shape.

**Approach:**
- New `Incident` model: `{ id, organizationId, projectId, reportedById, severity (LOW|MEDIUM|HIGH), description, createdAt }`.
- Slash command: `/incident project:<code> severity:<...>` opens a modal for description + optional photo.
- Posts the incident to the project's channel (if `postIncidentsToProjectChannel: true`, default true — same shape as `postFaultsToProjectChannel`).
- Renders on the project's Activity tab in the app.

**Touch points:** new `Incident` model + migration; new command; new admin toggle; project Activity tab integration.

### 3.3 `/reconcile`

**Why:** Outbox events can be missed (clock skew, pod restart mid-publish, polling lag). A nuclear option to force the bot to re-sync everything from current DB state is valuable for "the channel is missing two people who are definitely on the project".

**Approach:**
- `/reconcile project:<code>` (admin-only — check actor's permission against `orgSettings:update`).
- Bot calls a new `reconcileProjectChannel(projectId)` service that: ensures the channel exists, computes the expected member set from `ProjectAssignment` + `DiscordAccountLink`, computes the actual set from `channel.permissionOverwrites`, applies the delta.
- Same logic as the channel-sync consumer but invoked on-demand against current state instead of an outbox event.

**Touch points:** new `src/lib/discord/commands/reconcile.ts`; new `src/lib/services/channel-reconcile.ts` (extract from the outbox consumer for reuse).

**Open questions:**
- Should `/reconcile` (no args) reconcile ALL projects in the configured create-statuses? Probably yes, with a confirm prompt because it could hammer Discord rate limits on a big org. Add a 5-project batch + 2s delay between batches.

---

## 4. v2 admin UX

### 4.1 Live Discord dropdowns

**Why:** Text inputs for guild / category / channel IDs work but are footguns. Operators paste wrong IDs, or paste the channel name instead of the ID, or include leading/trailing whitespace. A live dropdown reading from Discord REST eliminates the class.

**Approach:**
- New endpoint `/api/admin/discord/guild-tree` (server-only — Bearer-authed at the Better Auth session layer, NOT exposed to the bot). Decrypts the bot token, calls Discord REST `/guilds/<guildId>/channels`, returns `{ categories: [{id, name}], textChannels: [{id, name, parentId}] }`.
- Admin page replaces the text inputs for `projectCategoryId`, `archiveCategoryId`, `alertChannelId`, `auditChannelId` with shadcn `Select` components fed by the tree.
- Falls back to text input if the bot token isn't configured yet (chicken-and-egg).

**Touch points:** new API route; replace four `<Input>` instances with `<Select>` (remembering the `SelectValue` children gotcha from the project CLAUDE.md).

**Open questions:**
- How fresh does the tree need to be? Cache for 5min? Refetch on every page load? Probably refetch with `useQuery` + 60s `staleTime`.
- The `guildId` field itself should stay text input (you can only know your guild id from copying it out of Discord — there's no parent to enumerate from).

### 4.2 Role-mapping matrix

**Why:** Today, a crew member's GearFlow `Member.role` is set on the GearFlow admin side. Discord role assignments are entirely separate. v2 idea: let admins declare "if the Discord user has the `@Lead Tech` role in our guild, treat them as `manager` in GearFlow when they invoke a slash command".

**Approach:** Two design questions to settle BEFORE coding:
1. **Override or augment?** If the GearFlow role says `viewer` and the Discord role says `manager`, does Discord win? Or does the higher-permission role win? Or do we take the union of permissions? My initial leaning: Discord role only *augments*, never *reduces* — so the effective permission is `max(gearflowRole, mappedDiscordRole)`. Prevents a misconfigured Discord role from accidentally locking out a real admin.
2. **Where does the mapping live?** New `DiscordRoleMapping` model `{ id, organizationId, discordRoleId, discordRoleName, gearflowRole, createdAt }`. Admin UI renders a matrix: rows = Discord roles (fetched live from `/guilds/<guildId>/roles`), columns = GearFlow role enum, radio cells.

**Hard dependency:** Need the `GuildMembers` privileged intent back (`Discord.Client.GuildMember` access requires it). That requires:
- Re-add `GatewayIntentBits.GuildMembers` in `bot-process.ts`.
- Tell operators (in `docs/operations/discord-bot.md`) to flip "Server Members Intent" ON in the Developer Portal for their bot.
- Add the doctor command (2.3) check: "is GuildMembers intent enabled in our client AND in the Developer Portal?"

**Touch points:** `DiscordRoleMapping` model + migration; admin role-matrix UI; `resolveDiscordActor` extension that consults the mapping when a Discord user's gearflow role is computed; `bot-process.ts` intent set; operator docs.

**Open questions:**
- What happens when an admin removes a mapping while a session is in flight? The bot fetches the actor per-interaction (no caching), so the next interaction picks up the change. Fine.

---

## 5. v2 architecture

### 5.1 Bot's reverse API

**Why:** Today, all flows are user-initiated via slash commands. There's value in app→Discord flows beyond auto-posting embeds: e.g. an admin clicks "Send for approval" on a quote, the bot DMs the approver with an embed + Accept/Reject buttons, the button press updates the quote status.

**Approach sketch:** Discord supports interaction-bearing embeds (message components: buttons, select menus). The bot listens for `Events.InteractionCreate` for component interactions, dispatches to a handler registry keyed by `customId`. The handler runs a service action and updates the embed.

**Open questions:**
- This is a big surface. Worth a separate design doc once we have a concrete first use case driving it. Don't pre-build; pull when needed.

### 5.2 Multi-org / shared bot

**Why:** Each org has its own bot token today. That's fine for a few orgs; at scale (50+ orgs), each bot consumes a Discord application slot, an invite URL, and an operator click to set up. A shared bot would be one application invited to N guilds.

**Open questions:**
- Discord's gateway rate limit is **120 requests per 60s per bot connection**. A shared bot multiplexing 100 orgs would hit this on any peak event. So shared-bot needs sharding (built into discord.js), which adds operational complexity.
- Per-org is simpler now and the right call until we feel actual pain. Documenting the trade-off here so we don't reconsider it without evidence.

---

## Build order recommendation

When you pick this up:

1. **Section 1 first** — verify what we shipped actually works. If anything breaks, it becomes a v1.1 hotfix, not v2 work.
2. **Section 2 second** — operability. ~half a day of focused work, makes everything subsequent easier.
3. **3.2 `/incident`** as a warm-up — smallest new command, no allowlist dependency, exercises the now-real outbox pipeline.
4. **3.1 `/asset checkout|checkin`** + the channel allowlist primitive.
5. **4.1 live dropdowns** — visible polish win for the admin page.
6. **3.3 `/reconcile`** — fold in once you have a real "channel desync" report to motivate it.
7. **4.2 role-mapping** — defer until there's a customer ask. It pulls the `GuildMembers` intent dependency along with it; not worth that cost speculatively.
8. **5.x** — only when a concrete use case demands them.
