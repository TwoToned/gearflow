# CLAUDE.md

<!-- Owner: Jayden Nawotka · Last reviewed: 2026-07-18 (review quarterly — POLICY.md R-5.5) -->

## ⚖️ Governing policy — POLICY.md is the bible

**[`POLICY.md`](./POLICY.md)** (Codebase Management & Hygiene Policy) is the **authoritative
standard for this repo**. It uses RFC-2119 language (MUST / SHOULD / MAY) and numbered
rules (`R-<section>.<n>`, thresholds `T-*`). When anything in this file, a FEATUREDOC, or a
review comment conflicts with POLICY.md, **POLICY.md wins** — flag the conflict, don't
silently diverge.

**Profile: `WEB`** (production web/app service — deployed at flow.rvlt.app). This binds the
R-0.2 applicability matrix. Active §8 categories: **8.1 Frontend, 8.2 Language/type, 8.3
Backend/DB, 8.4 Auth, 8.6 Forms, 8.7 UI/styling, 8.8 Testing, 8.9 Observability, 8.10
Integrations, 8.11 Web security, 8.12 Privacy.** **§8.5 Billing = N/A** (no payment provider;
pricing/quotes are internal, not processed payments).

**Two modes (POLICY.md §0):**
- **BUILD mode** — writing code (you or a human): every *applicable* `MUST` is a **hard,
  pre-emission constraint**. Code that violates an applicable MUST is defective and may not
  merge, even if it works (R-14.4). On conflict, restructure to comply or surface it and
  request a §15 exception — **never silently violate**.
- **AUDIT mode** — checking the repo: walk every applicable rule, record
  PASS / FAIL / ADVISORY / N/A / EXCEPTION with cited evidence. Reports land in
  **`docs/audits/`** (R-14.2).

**Rules that bite most often here** (not a substitute for reading POLICY.md):
- **DRY / single source of truth** (R-3.1, R-8.2.4, R-8.6.1): one authoritative definition per
  business rule, data shape, permission, price, token. A second hand-maintained copy is a
  defect even if in sync — matches the PDF-consumer + estimator-sync footguns below.
- **Server is the authority** (R-9.3, R-8.4.2/8.4.3, R-8.5.3): authz, prices, validation are
  server-side; client is UX only. No monetary amount originates from the client.
- **Trust boundaries schema-validated** (R-8.2.3, R-8.6.2): every HTTP body / form / webhook /
  env / vendor response parsed through Zod with the type inferred from the schema.
- **Cross-tenant reads** (see the `by_cuid`/`organizationId` note below) are R-8.4.3 IDOR
  Criticals — every doc fetched by global index MUST be org-checked.
- **Docs update in the same PR** (R-5.2/R-5.3/R-5.8): behaviour/interface changes update the
  affected FEATUREDOCS **and this file** in the same PR; stale docs are defects equal to stale
  code. This is already project law (see "Feature Documentation" below) — POLICY.md makes it a
  gate.
- **Deviations need a written, expiring exception** (§15) in `docs/exceptions.md`. "We don't do
  X" is not an exception; a scoped, owned, dated one is.

**Repo-specific budgets & thresholds** (R-0.4) and the exception register (R-15.2) live in
`docs/exceptions.md` / a threshold table once registered; until then the §13 defaults apply.

## Documentation Structure

- **`ARCHITECTURE.md`** — High-level overview with links to all feature docs
- **`FEATUREDOCS/`** — Individual markdown files for each feature/system
- **`PROMPT.md`** — Full product spec
- **`docs/ROADMAP.md`** — Prioritised roadmap: phases, sequencing, effort
- **`docs/designs/`** — Per-initiative design docs (one per major feature/program)
- **`docs/glossary.md`** — Core domain terms and documented aliases (POLICY.md R-3.10)

**When making changes**: Read the relevant `FEATUREDOCS/` file(s) for the feature you're touching. Update them after. Don't read everything — just what's relevant. The [Integration Checklist](./FEATUREDOCS/29-integration-checklist.md) tells you what to wire up for new features.

## Branching

All new features and non-trivial changes must go on a dedicated branch. Never commit feature work directly to `main`.

## Commits

Make atomic commits — one logical change per commit. The more commits the merrier. Prefer many small, focused commits over fewer large ones. Each commit should be independently understandable and revertable.

## Feature Documentation

Every feature change **must** update the relevant `FEATUREDOCS/` file. If the feature doesn't have one yet, create a new numbered markdown file (e.g. `FEATUREDOCS/30-my-feature.md`) and add it to the table in `ARCHITECTURE.md`.

## Commands

**This repo is pnpm-only** (single committed `pnpm-lock.yaml`; CI installs `--frozen-lockfile`).
Use `pnpm` / `pnpm exec` — never `npm`/`npx` (npm would drift the lockfile). See also the Convex
note below: **always `pnpm exec convex`, never `npx convex`.**

```bash
pnpm dev             # Dev server (Turbopack, Next.js 16 default)
pnpm build           # Production build + type check
pnpm start           # Start production server
pnpm lint            # ESLint
pnpm test            # Run all unit tests
pnpm test:watch      # Run tests in watch mode
pnpm test:coverage   # Run tests with coverage report
pnpm exec prisma generate  # Regenerate Prisma client (after schema changes)
pnpm exec prisma migrate dev --name <name>  # Create + apply migration
pnpm run api:registry       # Regenerate the API/MCP contract registry + coverage table
pnpm run api:registry:check # Verify it is current (the CI gate)
pnpm run api:docs           # Regenerate OpenAPI 3.1 + llms.txt
pnpm run api:mcp            # Regenerate the MCP tool manifest (src/lib/api/mcp-manifest.generated.ts)
pnpm run mcp:stdio-proxy    # Local stdio↔HTTP bridge to /api/v1/mcp (decision 4, #999)
```

### Regenerating the lockfile — fresh installs fail where yours doesn't
Re-resolving the whole tree (`pnpm update --depth Infinity`, `pnpm install --fix-lockfile`)
can rewrite the lockfile **without `hasBin: true`** on dozens of packages. Your own
`node_modules` already has the bin links, so everything passes locally; CI's fresh
`--frozen-lockfile` install then never links them and `next dev` dies with
`Error: Binary posthog-cli not found` (this broke both E2E jobs on a security-bump PR).
For a security bump prefer plain `pnpm install` after editing `package.json` /
`pnpm-workspace.yaml` overrides, then check the lockfile lost nothing:
`git diff origin/main -- pnpm-lock.yaml | grep '^[-+].*hasBin'` — a removed line is only
legitimate when that package's version changed, and is then paired with a `+` line for
the new version's entry. To be sure, `git worktree add` the commit,
`pnpm install --frozen-lockfile` there and run `pnpm dev`.

### Worktree Setup

Git worktrees don't share `node_modules/` or `.env` with the main repo. Run this to bootstrap a new worktree:

```bash
# Copy .env from the main gearflow checkout (adjust path if needed)
cp /path/to/gearflow/.env .

# Install dependencies
pnpm install

# Generate Prisma client
pnpm exec prisma generate
```

After this, `pnpm dev`, `pnpm test`, and `pnpm build` will all work.

### Convex in Worktrees & agent sessions

**Always use `pnpm exec convex` — never `npx convex`**, which runs a global CLI
copy that can't resolve `convex/server` from local `node_modules`, causing an
esbuild failure. `pnpm exec convex` uses the locally installed version.

**Default: do NOT push. Editing `convex/*.ts` needs no deployment.** The test
suite runs Convex functions in-memory (`convex-test`, 164 files) and
`convex/_generated/` is committed, so lint, typecheck, `pnpm build` and
`pnpm test` all pass with no Convex credentials at all — which is exactly what
`ci.yml` does (`NEXT_PUBLIC_CONVEX_URL: https://dummy-e2e.convex.cloud`).
Verify a Convex change with `pnpm test`, not by pushing it somewhere.

`pnpm build` is the one that's picky, and about Postgres rather than Convex:
page-data collection reaches the database, so a `DATABASE_URL` pointing at a
remote it can't reach fails the build with a bare `Failed to collect page data
for /_not-found` that names Prisma but not the cause. A dummy
(`postgresql://dummy:dummy@localhost:5432/dummy`, what `ci.yml` uses) builds
clean; a live remote URL from a sandbox often doesn't.

This matters most when several agent sessions / worktrees run at once: a push is
shared mutable state. `convex dev --once` targets the **shared dev deployment**
that the PR previews run against, so two branches pushing divergent schemas
race, last write wins, and one session's half-finished schema breaks the
previews and every other session. Never wire a Convex push into an automatic
post-edit step.

**Adding a new `convex/*.ts` module** is the one case that touches `_generated/`,
and `convex codegen` refuses to run without a configured deployment
(`✖ No CONVEX_DEPLOYMENT set`). Hand-edit `convex/_generated/api.d.ts` instead —
a new module is exactly two mechanical lines (`import type * as x from "../x.js";`
and `x: typeof x;` in the `fullApi` map). Editing functions *inside* an existing
module changes nothing generated.

**When you genuinely need a live backend** (running the app, clicking through a
flow), take your own preview deployment — never the shared dev one:

```bash
pnpm exec convex deploy --preview-name "$(git rev-parse --abbrev-ref HEAD)"
```

Branch names are unique per worktree, so each session gets its own isolated
deployment; re-running reuses it rather than recreating it. To build against it
in one shot:

```bash
pnpm exec convex deploy --preview-name "$(git rev-parse --abbrev-ref HEAD)" \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm build'
```

`CONVEX_DEPLOY_KEY` must be a **preview** deploy key (Convex dashboard → Project
Settings → Deploy keys → Preview). By Convex's key scoping, a preview key reaches
only preview deployments, never prod or the shared dev one — that scoping, not
anyone's discipline, is what makes it safe for unattended sessions to share one
credential. Never hand a session a prod key, and never run a bare
`pnpm exec convex deploy` (no `--preview-name`): with a prod key in the
environment that deploys to production. Do **not** set
`CONVEX_DEPLOYMENT`: it pins every session to a single deployment and re-creates
the collision a preview key exists to prevent.

Three things that are easy to get wrong:
- `convex dev` has **no** preview flags. `--preview-run` is a *seed function
  name* on `convex deploy`, not a deployment name; the name flags are
  `--preview-name` / `--preview-create`.
- Preview deployments do **not** inherit the prod or dev deployment's environment
  variables; they get the project-level defaults. `CONVEX_AUTH_ISSUER` /
  `CONVEX_AUTH_JWKS_URL` are set as project defaults (verified 2026-09-16: a
  fresh preview came up carrying both), which is what keeps auth alive on a
  preview — `convex/auth.config.ts` reads them at push time. Clear those defaults
  and every new preview is born with auth dead.
- Previews auto-delete 5 days after creation (14 on paid plans) and count toward
  the team's deployment limit — relevant if you keep many worktrees alive.

### DB Setup (first time)
```bash
# Ensure DATABASE_URL is set in .env, then:
pnpm exec prisma migrate dev   # Apply all migrations + generate client
```

## Environment Variables

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — Auth signing secret
- `BETTER_AUTH_URL` — App base URL (used for auth callbacks)
- `NEXT_PUBLIC_APP_URL` — Public app URL (e.g. `http://localhost:3000`)

**Email (Resend):**
- `RESEND_API_KEY` — Resend API key (dev logs to console if unset)
- `EMAIL_FROM` — Sender address (default: `RVLT Flow <flow@rvlt.app>`)

**File Storage:** Uploaded file bytes are stored in **Convex file storage** (`_storage`),
not S3/MinIO. `src/lib/storage.ts` keeps the old `uploadToS3`/`deleteFromS3` API names
for compatibility but routes through `convex/files.ts` → `ctx.storage`. The legacy S3
env vars are no longer read. `UPLOAD_MAX_SIZE_MB` (default 50) caps upload size.

**Google Maps:**
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — API key with Maps JavaScript API + Places API (New) enabled

**Analytics + error tracking (PostHog, optional):**
- `NEXT_PUBLIC_POSTHOG_KEY` — public write-only ingestion key (`phc_…`); analytics +
  exception capture are inert if unset. Must be the `NEXT_PUBLIC_` copy so it's inlined
  into the browser bundle.
- `NEXT_PUBLIC_POSTHOG_HOST` — ingest host (default `https://us.i.posthog.com`)
- `POSTHOG_CLI_TOKEN` / `POSTHOG_CLI_ENV_ID` — sourcemap upload for readable error-tracking
  stack traces (`next.config.ts`, `@posthog/nextjs-config`). **Deploy pipeline only** — not
  needed for local dev (`pnpm dev`/`pnpm build` never require them). The real deploy build
  (Dockerfile) hardcodes `POSTHOG_SOURCEMAPS_REQUIRED=true`, so a missing token/env-id there
  fails the build loudly rather than silently skipping the upload (R-8.9.2).
- Registered budgets/SLOs (`docs/budgets.md` registry, R-0.4) are alerted through PostHog
  where the underlying event exists today — Core Web Vitals (T-7) has three p75 alerts
  ("CWV p75 — LCP/INP/CLS" insights, R-8.1.5). The provider is PII-hardened (no
  autocapture/replay; cuid-only event props) — see `docs/pii-inventory.md`.

**Other:**
- `PASSKEY_RP_ID` — WebAuthn relying party ID (default: `localhost`)
- `PLATFORM_NAME` — Display name (default: `RVLT Flow`)
- `SITE_ADMIN_SECRET_TOKEN` / `SITE_ADMIN_REGISTRATION_ENABLED` — gate the
  `/api/admin-register/{verify,promote}` site-admin self-registration routes
  (`NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED` mirrors the enabled flag client-side)

**Convex (backend):**
- `CONVEX_DEPLOY_KEY` — Convex Cloud deploy key (CLI pushes, `convex dev`/`convex deploy`)
- `NEXT_PUBLIC_CONVEX_URL` — Convex deployment URL the app connects to
- `CONVEX_AUTH_ISSUER` / `CONVEX_AUTH_JWKS_URL` — Better Auth issuer Convex trusts for JWTs

**Xero integration (WS1 #940, optional):**
- `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` — Xero developer app OAuth2 credentials.
  Unset = the "Connect Xero" action throws a clear error at click-time rather than
  gating app boot (no org may ever connect Xero — a valid steady state).
- `XERO_REDIRECT_URI` — OAuth2 callback URL registered with the Xero app. Defaults
  to `${NEXT_PUBLIC_APP_URL}/api/integrations/xero/callback` when unset.

**Web push (subscriptions #1244, FEATUREDOCS/50; no feature currently sends a push):**
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public half of the VAPID key pair, inlined into the
  browser bundle (not a secret — it's how a push service identifies the sending
  application). Unset = the account notifications page's push toggle stays hidden
  (`usePushSubscription`'s `support` never becomes actionable without it).
- `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — server-only; read by `src/lib/web-push.ts`
  (`node:crypto` RFC 8291/8292 sender — no `web-push` dependency). All three unset = no
  push is ever sent.
- Generate a pair with `pnpm run vapid:generate` (`scripts/generate-vapid-keys.mts` —
  plain Node `crypto`, no new dependency). Rotating invalidates every existing
  browser subscription; do it rarely.

**DB connection hardening (optional, safe defaults):** layered onto the runtime
`DATABASE_URL` in `src/lib/db-url.ts` (NOT onto `prisma migrate`, so backfills
aren't killed). Anything you put in the URL itself wins.
- `DB_STATEMENT_TIMEOUT_MS` — per-query server-side cap (default `30000`). The key
  stability guard: stops one slow query from holding a pooled connection and
  stalling the whole app. `0` disables (not advised).
- `DB_POOL_TIMEOUT_S` — wait for a free pooled connection before erroring (default `10`).
- `DB_CONNECTION_LIMIT` — max pooled connections (default: Prisma's `cpus * 2 + 1`).

## Critical Conventions

### Composition: Radix overlays use `asChild`, Base UI shells use `render`
The RVLT rebrand left the UI library **mixed**, and the two families compose
differently — using the wrong prop is a silent no-op:

- **Overlay primitives are Radix** (`@radix-ui/react-*`): `Dialog`, `Sheet`,
  `DropdownMenu`, `Popover`, `Select`, `Tooltip`. Compose triggers with **`asChild`**:
  ```tsx
  <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
  <DropdownMenuTrigger asChild><Button>Menu</Button></DropdownMenuTrigger>
  ```
- **Sidebar + Breadcrumb are Base UI** (`@base-ui/react` `useRender`): compose with
  the **`render`** prop:
  ```tsx
  <SidebarMenuButton render={<Link href="/foo" />}>Link</SidebarMenuButton>
  <BreadcrumbLink render={<Link href="/foo" />}>Crumb</BreadcrumbLink>
  ```

**⚠️ `Tooltip` needs a `TooltipProvider` ancestor.** There is **no global provider** —
every consumer wraps its own. Omit it and the page throws at render time:
`Error: Tooltip must be used within TooltipProvider`. Typecheck, lint and `next build`
all pass on the broken form; it only fails when a user opens the thing.
```tsx
<TooltipProvider>
  <Tooltip>
    {/* Trigger renders a <button> by default — don't nest another one inside it. */}
    <TooltipTrigger aria-label="Explain"><Info /></TooltipTrigger>
    <TooltipContent>…</TooltipContent>
  </Tooltip>
</TooltipProvider>
```
Cover new overlay UI with a jsdom smoke test that actually *renders* it — see
`src/components/assets/__tests__/model-roi-tab.smoke.test.tsx`, which reproduces this
exact crash.

**⚠️ NEVER put a Base UI overlay (popover/menu) inside a Radix modal `Dialog`.** A
Radix modal Dialog sets `pointer-events: none` on `document.body`; a Base UI popup
portals to `<body>` as a sibling, inherits the lock, and every click is swallowed
(this broke crew/model/supplier pickers in forms). Searchable pickers
(`combobox-picker.tsx`, `tag-input.tsx`) are built on **Radix** Popover for exactly
this reason — don't revert them to `@base-ui/react/popover`. See FEATUREDOCS/07.

### ⚠️ Never regenerate `convex/schema.ts` over itself
`scripts/generate-convex-schema.cjs` is a **scaffolding** tool, not a source of truth.
The checked-in schema has diverged on purpose: hand-added `searchIndex`/composite
indexes the generator never emits, plus every Convex table whose Prisma model has
since been dropped (Postgres now only holds Better-Auth + audit models — the
generator parses Prisma 1:1, so it would emit a small fraction of the checked-in
schema). Running it over the file silently deletes live tables and every search
index. To add a table: generate into a scratch dir, diff, hand-merge the stanza.

Related: `by_cuid` and `by_modelId` are **global** Convex indexes, and `requireOrgRead`
authorises the *caller's* org, not the *row's*. Any doc fetched by cuid or modelId must
be checked against `organizationId`, or you have a cross-tenant read. **This is no
longer a rule you have to remember — it's live-checked (#1076, A6, "the phase gate"):**
`scripts/xtenant-bycuid-ratchet.mjs` statically ratchets every public `query`/`mutation`
containing a `withIndex("by_cuid", ...)` read with no org-check indicator anywhere in its
body (baseline currently 0 — CI fails on the first new one), and
`convex/xtenantExhaustive.test.ts` drives `src/lib/api/registry.generated.ts` to prove it
at runtime: every org-scoped operation rejects a caller whose own org doesn't match the
requested `orgId`/`organizationId` (~500 operations, not a sample), and every `listBy*`
query is proven, by seeding a same-FK row in two orgs, to exclude the foreign one. Both
sweeps are registry-driven, so a new operation joins automatically — nothing to add to a
list. See `convex/xtenantHardening.test.ts` for the original hand-written representative
cases these generalise.

### The agent (API/MCP) auth kind — three rules when touching `convex/*.ts`

The API mints a short-lived **AGENT token** shaped like a user token plus an `akid`
claim (`src/lib/api/agent-token.ts`), so `getAuthContext` has three kinds:
`service` / `user` / `agent`. An agent behaves as a user everywhere and additionally
passes `requireAgentScope` (the key's scopes ∩ the user's live RBAC). See
[FEATUREDOCS/56](./FEATUREDOCS/56-api-mcp.md) and
`docs/designs/api-mcp-reimplementation.md`.

1. **Never give `requireService` an agent escape hatch.** An agent token failing it
   is what makes the 602 service-gated functions structurally unreachable from the
   API rather than merely undocumented. `convex/agentServiceUnreachable.test.ts`
   invokes every one of them and asserts it rejects.
2. **`auth.kind !== "user"` is now a bug in most places.** Use `isMemberAuth(auth)`
   for "a real end-user identity" — an `!== "user"` check silently locks agents out
   of a surface that was meant to include them (or, worse, reads as an intentional
   deny when it isn't). The genuinely agent-only branches are the two resource-less
   read guards, which fail closed on purpose (decision 2).
3. **A new read should use `requireOrgReadFor(ctx, orgId, resource)`**, not
   `requireOrgRead`. The resource-less guard has nothing to intersect a key's scopes
   against, so it rejects agents. Phase 5's coverage sweep (`#1001`) migrated
   essentially every remaining call site (169 → 1; the holdouts are the ⌘K
   palette's two cross-resource reads, `globalSearch.search` and
   `paletteRecents.resolve` (UX Phase 11), each a deliberate
   `agentAccess: "denied"` decision, not an oversight — see
   `docs/api-coverage.md`'s denied table), so a brand-new read starting on the
   bare guard is now the exception, not the norm. **`requireOrgReadFor` does
   not check a human's ROLE** (org match + agent scope only): a read that must
   hide what the role can't open adds `callerMayRead(ctx, orgId, resource)`
   (`convex/lib/auth.ts`, the non-throwing form of `requireOrgPermission(…,
   "read")` — never a second permission table), as global search does per
   result type (`convex/lib/searchResultResource.ts`).
   Personal-scope surfaces use `requireSelfScope`. Colocate an `agentOps`
   annotation (`convex/lib/agentOps.ts`) — `{ summary, danger, mcpTier }`, or
   `{ agentAccess: "denied", reason }` for a deliberate denial — next to any
   guard you touch; the registry generator merges it in and fails the build on
   an unreasoned denial.

**Privileged args are CI-gated.** A new mutation argument matching
`/^(allow|force|skip|override|ignore|bypass)/` or named `justification` fails the
build unless it has a policy row in `src/lib/api/privileged-args.ts` — these are the
only ways a legitimately-permitted caller can soften a gate, so each one is
classified deliberately. `assertBulkSizeOk(ctx, count)` is async and ctx-taking for
the same reason: the cap (50 agent / 500 human) has to come from the verified
identity, not a caller-supplied hint.

**Danger classification is CI-gated too (Phase 4, #1000).** Every agent-reachable
mutation needs a `danger: "low" | "medium" | "high"` entry in its module's colocated
`agentOps` export (`convex/lib/agentOps.ts` has the type; see `convex/lineItemWrites.ts`
for the pattern) or `pnpm run api:registry` fails the build the same way an unclassified
privileged arg does. `high` (stock-affecting, irreversible, lock-softening, delete/
archive, financial issue/void, warehouse movement, bulk-destructive) makes the API
dispatcher require `confirm: true` before the call reaches Convex at all
(`src/lib/api/dispatcher.ts`'s confirmation gate) — a `medium`/`low` op that ALSO
supplies a privileged arg whose own policy `danger` is `"high"` (e.g. a non-empty
`justification`) escalates for THAT call without reclassifying the operation. A new
`apiKeys.noFinancials` flag force-redacts cost/margin fields (never the model's own
sell rates — those stay visible, an agent needs them to quote/book) regardless of the
acting user's role — see `convex/lib/auth.ts` `isAgentNoFinancials`, applied per read
site (there is no generic "cost field" registry; each query decides what's cost-shaped).
A read whose ENTIRE payload is financial (`projectCosts.operationalCosts`) returns the
all-zero `EMPTY` shape instead, since there's no non-financial subset of fields to redact.

### The API dispatcher (`src/lib/api/dispatcher.ts`) — one call site, closed by default

`POST /api/v1/ops/{operation}` is the ONE route that reaches every agent-reachable
Convex function (`GET /api/v1/{operations,whoami,openapi.json}`, the curated REST
aliases in `src/lib/api/alias.ts`, and the **MCP server** at `/api/v1/mcp`
(`src/lib/api/mcp/*`, #999) all sit on top of it or the same registry). Do not
add a second hand-written route that calls Convex directly with an agent token — an
operation absent from `src/lib/api/registry.generated.ts` (regenerate with
`pnpm run api:registry`, never hand-edit) is a 404 by construction, and a bespoke
route would bypass that. If a new curated alias is warranted, add it to
`src/lib/api/alias.ts` calling `dispatchAlias()`, not a standalone Convex call — the
point is that REST and the dispatcher cannot drift because one literally calls the
other. Same rule for a new curated MCP tool: add it to
`src/lib/api/mcp/curated-tool-defs.ts` (name it, point it at an existing registry
operation, write the prose) and regenerate — a curated tool never calls Convex or
`dispatch()` directly, `src/lib/api/mcp/build-server.ts`'s router does that for
every tool uniformly. After any change under `src/lib/api/registry.generated.ts`'s
inputs (a new `*Native` mutation, a guard change, a new read migrated to
`requireOrgReadFor`), run `pnpm run api:registry && pnpm run api:docs && pnpm run
api:mcp` and commit all three — CI gates staleness on each independently.

**Stability tiers are derived, never declared** (Phase 8, #1004): an operation is
`stability: "stable"` iff it's wrapped by a curated MCP tool
(`src/lib/api/mcp/curated-tool-defs.ts`) — the same table `pnpm run api:mcp`
already reads — so adding a curated tool automatically promotes its operation to
the additive-only tier, nothing else to edit. `src/lib/api/stable-contract.generated.ts`
is a ratcheting baseline (like the reachability floor in `docs/api-coverage.md`):
`pnpm run api:registry` refuses to run at all if a stable operation would lose a
field, disappear, or get demoted — that's gate 6 in `scripts/generate-api-registry.mts`,
proved with a deliberate-violation test in `src/lib/api/registry.test.ts`. A real
breaking change to a stable operation needs a `/v2`, not an edit to that file.

### MCP OAuth 2.1 (`src/lib/api/oauth/*`, #1003) — a pure adapter, not a second auth system
An OAuth-issued access token IS an `apiKeys` row (`origin: "oauth"`) — the token endpoint
(`src/app/api/v1/oauth/token/route.ts`) mints one with `mintOAuthGrant`
(`src/lib/api/oauth/grant.ts`) using the same raw-secret/SHA-256-hash shape
`generateApiKey()` uses, so it authenticates through `getApiKeyActorContext` →
`mintAgentToken` completely unchanged. **Never add a second token-verification path for
OAuth tokens** — if it needs to reach the dispatcher, it goes through the identical bearer
flow every manually-minted key does. The consent screen (`/oauth/authorize`,
`src/server/oauth-authorize.ts`) narrows the requested `scope` to the consenting user's
LIVE role via `narrowScopesToRole` (`src/lib/api/oauth/rbac-scopes.ts`), which reads
`permissionsCore`'s `RESOURCES`/`rolePermissions` directly — do not add a parallel
"scope grantable by role" table. Refresh-token rotation (`apiKeys.rotateOAuthTokens`) and
authorization-code redemption (`oauthAuthorizationCodes.redeem`) are both single-use with
NO grace window, verified inside one Convex transaction so a concurrent replay of the
same (now-superseded) credential always loses the race — do not add a grace window to
either, unlike the manual-key `rotate` mutation's deliberate one.

### Mira (in-app assistant) — a real LLM tool-calling loop, still one dispatch() consumer
Mira answers a question with a real LLM tool-calling loop (OpenRouter by default, or any
OpenAI-compatible endpoint an org points her at instead via `miraOrgSettings.baseUrl` —
each org brings its OWN API key + model + optional base URL, `/settings/mira`,
`src/server/mira-settings.ts`) that calls `dispatch()` — the SAME function REST/MCP use
— never a separate code path (`src/server/mira.ts`, `src/lib/mira/agent-loop.ts`,
`src/lib/mira/llm-client.ts`). It acts as the asking user via a per-(org, user)
`apiKeys` row it provisions itself (`miraKeys` table, secret encrypted with
`src/lib/crypto/secret-vault.ts`, the same vault trusted for Xero tokens and each org's
LLM API key) — never a fixed "system" identity, so a member can never get more
access through Mira than their own role already grants. Which preset it provisions
(`read_only_agent` vs `full_agent`) is an admin-controlled org setting
(`miraOrgSettings.writeAccessEnabled`, default off) — flipping it revokes every
member's cached Mira key so the change takes effect immediately. The model is NEVER
given a `confirm` parameter (`src/lib/mira/tool-defs.ts`): a `danger:"high"` tool call
always stops and asks a human to click Confirm in the chat UI
(`confirmMiraPendingAction`), which replays the exact stored call server-side — the LLM
can explain what it's about to do, but cannot approve it itself. See FEATUREDOCS/68
before wiring a new Mira tool or changing the confirmation flow.

### ⚠️ $0 is a PRICE, not a flag — ROI exclusion is its own field
`projectLineItems.excludeFromRoi` (#1249, FEATUREDOCS/57) is the ONE way a line is
kept out of revenue allocation by hand. A `lineTotal` of `0` means only "this costs
nothing" — it weighs exactly like an unpriced `"—"` line, falling through to the
rate → cost legs of `weightOf`. **Never reintroduce "$0 means excluded."** That rule
read a deliberate free line and an empty price box as the same thing, and empty is
the common case: inside a Project Group the BUNDLE price is the charge, so members
are routinely left blank, and all that gear silently reported $0 ROI.

The other half of that bug: a blank `<input type="number">` submits `""`, and
`z.coerce.number()` turns `""` into a real `0`. `blankableNumber`
(`src/lib/validations/line-item.ts`) is what keeps blank meaning blank — use it for
any new optional money field rather than a bare `z.coerce.number().optional()`,
which cannot express "left empty". (`taxRateField` is knowingly still on the old
shape; its comment says why.)

Same rule server-side: a mutation that auto-prices must guard on the model actually
having a rate (`dailyRate != null || weeklyRate != null`) before calling
`computeBlendedCharge` — with both null it returns `0`, which would write a
price-looking $0 plus a `priceBreakdown` that makes it look auto-priced. See
`addLineItemSmartNative` and `groupTemplatesWrites.applyNative`.


### Timesheets: crew pay is DERIVED and manager-gated; Query… is not `notes`
Timesheet rate/total (D49) are derived in `convex/lib/timeEntryMoney.ts` from the
pay cascade `resolveRate` — a day rate once per person per day, a flat rate once per
person per assignment (a job-less FLAT entry: once per person per day), nothing
resolved = blank — and never stored. The entry that CARRIES a shared charge is the
most advanced one (EXPORTED > APPROVED > SUBMITTED > DISPUTED/DRAFT), then the
earliest; never "the earliest" alone, or a later draft steals it. Every read that
returns crew pay (`crewTimeEntries.allEntries`, `crewAvailability.plannerData`,
`crewAssignments.{membersForAssignment,projectCrew,list,getById,listByProject,listByServiceIds}`,
`crewDashboard.{pickerList,pendingTimeEntries,activeAssignmentsSummary,pendingOffers,upcomingShifts}`,
`crewMembers.{list,listPage,getById}`, `crew.memberDetail`,
`crewRoles.{list,listForSettings,getById}`) gates it on `canSeeCrewPay`
(`convex/lib/crewPayVisibility.ts`), which decides with THE one rule,
`crewPayVisible` (`convex/lib/crewPayRule.ts`: manager+ AND the job-cost line —
`invoice:read` and not a `noFinancials` key; the pay line implies the job-cost
line, so a key scoped without `invoice` can't rebuild a job's cost from the
services' `costTotal` and the calls' `estimatedCost`). A server action reads Convex with the SERVICE identity (which always sees
pay), so every one that returns crew pay decides for its real caller with
`callerSeesCrewPay()` (`src/lib/crew-pay-caller.ts`, the same `crewPayVisible`; an
API-key actor counts as noFinancials — fail closed): `exportTimesheetCSV`,
`getProjectServices` (`redactServiceCrewPay` strips each call's `estimatedCost` /
`rateOverride` / `resolvedRate` and the service's own `costTotal`, so Logistics
renders no row cost/margin cell) and the timeline PDF route (`?showCost` prints
service costs only with pay).

**Two money lines, never one** (owner ruling 2026-11-24, "anyone with invoice read"):
- **Individual pay** — a person's or role's rate, a call's cost, a service's own
  crew-rolled `costTotal` (`MEMBER_RATE_FIELDS` / `ROLE_RATE_FIELDS` /
  `SERVICE_CREW_COST_FIELDS`, `convex/lib/crewPayFields.ts`) — needs the PAY line
  above (`canSeeCrewPay` / `callerSeesCrewPay` / `crewPayRedactor`).
- **Job cost** — the project's `serviceCostTotal` / `labourCostTotal` / `margin`
  (`JOB_COST_FIELDS`), the services summary's cost total, `projectCosts.operationalCosts`
  and `crewAssignments.projectLabourCost` (the same number as `labourCostTotal`) —
  needs `invoice:read` and not a `noFinancials` key: ONE rule, `jobCostVisible`
  (`crewPayRule.ts`, next to `crewPayVisible`), decided by `canSeeJobCost` /
  `jobCostRedactor` in Convex (via `callerMayRead`, so a key's scope counts) and
  `callerSeesJobCost` / `withoutJobCost` / `jobCostSortAllowed` in server actions.
  Never inline an `invoice:read` check. Every built-in role holds `invoice:read`
  (warehouse and viewer included), so in practice only a key without the invoice
  scope and a `noFinancials` key lose it. Sites: `projects.*`, `projectDetail.bundle`
  (job page, MCP `get_project`, Mira), `warehouseDetail.bundle`, the project entry
  of snapshot reads (`projectLocksRead`, which also always strips a crew call's
  `responseToken`), `getProject(s)` / `getTemplates` / `getProjectServicesSummary`.

Both are ABSENT (never zeroed) for a caller who fails them, so nothing can be
back-solved; a hidden field is not a sort key either; a whole-payload read returns
its all-zero shape (`operationalCosts`' EMPTY, a stable contract). The UI renders
what the server sent: Finance's margin + Costs and the quote revision viewer's
Margin by presence (`null` counts as absent — `mapProject` maps absent to `null`),
Logistics' `Show cost` by `logisticsCostView` (footer = job cost, row cells = pay).
The activity log still WRITES money in its field diffs (the audit needs them) but
every read (`activityLog.{list,listByEntity,recentForProject,exportRows}`, and the
CSV action for its real caller) drops each change row by its line
(`activityMoneyRedactor`, `convex/lib/activityPay.ts`). A helper that returns a
full assignment row with no authz of its own is a plain module, never a
`"use server"` export (`src/lib/crew-assignment-email-data.ts`). Writes follow the
pay line: below it a service save keeps each call's stored rate inputs
(`crewRateInputs` in `convex/projectServicesWrites.ts`) and the service's stored
`costTotal`, and a create ignores a supplied one. Never write a third "who sees
money" check; add a new money-bearing read to the right list, and don't hide a
column client-side. A crew member's `icalToken` (the
public calendar feed's bearer secret) leaves Convex only through `memberRowRedactor`
(`convex/lib/crewMemberRedaction.ts`): to the member themself or `crew:update`, on a
user session, never an API key; never return it from a service-token server action
(`getIcalSettings` deliberately doesn't). Query… (D47, enum stays `DISPUTED`) stores its reason on
`crewTimeEntries.queryReason`, never `notes` (the crew member's own text). Submit /
approve / query log one activity row per entry with the prior state, and their ONE
Undo, `revertNative`, takes only ids + the forward stamp (no transition, no prior
status) and reads which transition ran and the prior state back from those rows —
never accept either from the client. Query clears the approval stamp and its
revert restores it. Log time's Undo is ONE atomic `undoCreateManyNative({ ids,
stamp })` that refuses if any entry moved on — never a loop of deletes.
FEATUREDOCS/31.

### The crew planner — one call-verb table, mail has no Undo
Which planner verb a crew call offers (Offer / Confirm / Cancel) comes from ONE
table, `convex/lib/crewCallTransitions.ts` (`canCrewCall`): the server gates
(`confirmManyNative`, `cancelManyNative`, `sendCrewOffers`) and the planner menus
read it, so add a status there, not in a menu. `sendCrewOffers` refuses a call
that is not PENDING/OFFERED (it would knock a yes back to OFFERED). Offer and
Cancel email the crew: confirm first, toast with no Undo; `Confirm n`'s Undo is
`unconfirmManyNative(result)` with the forward result unchanged. A bulk offer's
gate is atomic (`crewAssignments.markOfferedIfOfferable`); crew mail goes out in
batches of `MAX_CREW_MAIL_BATCH`. The week starts on the ORG's week start
(`useOrgWeekStartsOn`); a multi-day service is checked on every day it covers.
The planner reads `plannerData` / `openCalls` as live subscriptions keyed on the URL week;
editing a call stays on the job's Logistics tab (`updateNative` is a full
replace). FEATUREDOCS/31 "Crew Planner".

### Discount: the AMOUNT is stored, the PERCENTAGE is derived
`projectLineItems.discount` / `projectGroups.discount` are always the **resolved
flat dollar amount** — recalc, allocation, invoicing and `lineTotal` read that
number and nothing else. `discountMode` (`"$" | "%"`, #1012) sits next to it and
records only how the operator *entered* it, so documents can print `-15%`
instead of `-$150.00`. Absent = `"$"` (every pre-#1012 row; no backfill).

The percentage itself is **never stored** — `discountCellText`
(`src/lib/pdfme/line-item-format.ts`) / `discountEntryValue` recompute it from
the stored dollar amount against the row's own gross. Storing the typed `15`
would let a document contradict itself once the unit price changed (the dollar
amount is frozen at save). Don't "fix" that by adding a `discountValue` column.

`discountMode` must never outlive the amount it describes: every write path that
clears/zeroes `discount` clears the mode too (patchNative, patchManyNative,
updateGroupPriceNative, and each lifecycle-lock `defaultToZero` branch). The
mode union + both conversions live in `src/lib/discount-mode.ts` — a plain
module, so Convex mutations, Zod schemas, the seven add/edit forms and the PDF
renderer share one definition. `line-item-form-fields.tsx` re-exports them for
the forms; don't re-declare `"$" | "%"` anywhere else.

### Category price rollup: the SECTION subtotal is derived, the per-line prices are hidden
`projectCategories.pricingDisplay` (`"ITEMISED" | "ROLLUP"`, absent = `ITEMISED`,
no backfill) decides whether a category prints a price per line or one price for
the whole section with every line still listed (quantities intact, money columns
blank). It is **not** a priced Project Group: a group HIDES its contents behind a
typed bundle price; a rolled-up category SHOWS all its contents and DERIVES the
one price as `sum(lineTotal)` over its members. Never store that subtotal — it is
not a `PROJECT_MONEY_ANCHOR`, which is exactly why recalc/allocation/revenue need
no changes (rollup regroups, it never reprices). Same reasoning as `discountMode`
above: a second copy of a total the line items already determine would
contradict the document the moment a price changed.

`revealPriceInRollup` (on `projectLineItems` AND `projectGroups`) opts ONE row
back into printing its own price. A revealed row is still **counted in the
section subtotal** — the header is the category's total, not the remainder,
which is why it prints with a label. The flag is consulted ONLY inside a rollup,
so a stale `true` after switching back to `ITEMISED` changes nothing; `false` is
stored as an absent field so "hidden" has one representation.

The union, the per-row hidden/revealed decision and the subtotal arithmetic live
in `src/lib/category-pricing-display.ts` — a plain module shared by the Zod
schemas, the document pipeline, the equipment tab and the finance snapshot.
Renderers read the DERIVED `priceHidden`/`rollupCategory` that
`structureLineItems` stamps, never the stored fields, and those are stamped only
in collapse mode (a warehouse doc expands groups, so summing a bucket would
double-count). `buildFinanceLines` folds a rolled-up category into one
`sourceType: "CATEGORY"` invoice line. See FEATUREDOCS/74.

Its sibling, `projectLineItems.showInGroupOnDocs` ("group child disclosure"),
lets a Project Group — which otherwise collapses to ONE row and drops
everything inside it — list selected members under that row with description +
quantity. Collapse mode attaches `disclosedGroupChildren(members)`
(`src/lib/group-child-disclosure.ts`), each stamped the SAME derived
`priceHidden` (one flag for "this row prints no money", not two), and
`undefined` when none are disclosed so an untouched group keeps its exact
pre-feature shape. A disclosed member **never** prints a price and gets no
per-member override: the group's bundle price IS the charge, so printing a
member's own figure too would put two contradictory numbers for the same gear
on one document — which is also why `buildFinanceLines` needs no counterpart
(the group still bills as one line). Kit parents are excluded, and expand
(warehouse) mode ignores the flag entirely — packers need the full list.

### People lists and records (UX Phase 13) — one renderer, derived facts, server-side exact Undos
`/crew`, `/clients`, `/suppliers` are three configs (`src/lib/list-views/people.ts`) of ONE `PeopleList`
(`src/components/people/`) over `ListPage`; the crew manager dashboard and the client / supplier stat tiles
are gone (their numbers are strip counts). Reads are `convex/peopleLists.ts`; everything derived is a pure
`convex/lib/{crewListFacts,clientListFacts,orderHireState}.ts` function, **never stored**: crew status
(Unconfirmed > On a job > Available, "this week" = the next 7 days, undated live calls included), client open
jobs / quoted / outstanding, an order's `On hire` / `Returned` (from `returnedDate`; `returnDueDate` is the
supplier's date and `Extend hire` never touches a sub-hire's `hireEnd`). A pay or money field is **absent,
never zero, never a sort key** below its line (`canSeeCrewPay` for the crew rate; `canSeeJobCost` for client
quoted / outstanding / lifetime and supplier spend, cost, margin). **Every People bulk write has a SERVER-side
exact Undo** built on `convex/lib/fieldEditUndo` (`peopleBulkWrites.{addTagMany,setActiveMany,undoMany}Native`,
`crewAssignmentsWrites.undoCreateManyNative`): ids only, author + server window + once + compare-and-set, keeps
and names anything that changed since. `Assign to job` creates unsent PENDING calls; its Undo deletes only
calls still exactly as created, never via `bulkDeleteNative` (that cascades to shifts and time entries).
**Client Merge** (`convex/clientMergeWrites.ts`) moves jobs, their `projectVersions.clientId` (a plan field
Make live projects back, so skipping it silently reverts the job), invoices, contacts (never primary), media
and work-item links; NOT activity history, stored PDFs or either Xero mapping; its Undo reverses exactly the
recorded ids still where the merge left them. Record pages share `RecordShell` (DetailHeader, `?tab=` with an
Overview fallback, a rail on every tab but Overview). **Supplier Contacts / Documents and an order's Files**
(B3, FEATUREDOCS/22): three small tables; an add is undone by DETACHING the row (an Undo never deletes a stored
file), removing a document or order file deletes its bytes and is a confirmed verb with no Undo, and a
document's expiry state is derived on read, never stored. A People list that reads a capped set reads it
newest-first and shows a figure that the cap could have cut as `at least $X`, never a confident total.

### Project status advances itself — add a TRIGGER, never a second patch site
`convex/lib/projectAutoStatus.ts` is the ONE place a job's status moves as a side
effect of other work (#1160, FEATUREDOCS/76): quote sent → `QUOTED`, first item
packed → `PREPPING`, last packed item off the dock → `CHECKED_OUT`, last item back
→ `RETURNED`. The returns station's old private `maybeAutoAdvanceProject` is gone —
it calls in here. Three rules when you touch this:

1. **Never hand-roll another "patch `projects.status` as a side effect".** Add a
   row to `AUTO_STATUS_RULES` and call `maybeAutoAdvanceProjectStatus` ONCE at the
   end of the mutation that did the real work — never inside a per-item loop, and
   never before the writes it inspects have landed.
2. **Never automate a move INTO `COMPLETED`/`INVOICED`.** Closing a job out is a
   human's call. `CONFIRMED` has exactly ONE sanctioned rule — `PAYMENT_SETTLED`
   (#1236): in this business payment IS the confirmation. It is safe only because
   it re-checks the accepted-quote gate (failing CLOSED — it has nobody to collect
   a justification from) and takes the same whole-project snapshot
   `updateStatusNative` does. A table-level test pins it as the only rule that may
   reach `CONFIRMED`, so a second can't inherit the exception by accident.
3. **A new switch key goes on BOTH sides.** The rule table's `settingKey` lives in
   `convex/lib/projectAutoStatus.ts`; `AUTO_STATUS_KEYS` + labels + toast copy live
   in `src/lib/project-status-automation.ts` (convex can't import from `src/`).
   `convex/projectAutoStatus.test.ts` asserts parity — absent = ON, so the stored
   blob only ever records an opt-OUT.

"Everything deployed" is a POSITIVE test — **no deployable row still has ordered
quantity in the warehouse** (`stillInBuilding`), not "nothing is still `PACKED`".
The absence-of-a-PACKED-marker version was wrong twice: a partially deployed bulk
line rolls up to `{ status: CHECKED_OUT, prepStatus: PACKED }` on its FIRST unit
out (`deriveOrderLineStatus` is a `some`), and never-prepped gear has no
`prepStatus` at all — so one deployed item flipped a job with everything else
still on the shelf, permanently (the `from` set stops matching, so it can't
self-correct).

Deployable mirrors the warehouse page's own `equipmentItems` filter: `type ??
"EQUIPMENT"` is `EQUIPMENT`, not a container row, not a sub-hire GROUP wrapper.
Scoping by type is what keeps services / labour / transport / MISC / sale lines —
which sit at `CONFIRMED` for the life of the job — from pinning it at `PREPPING`.

Both warehouse triggers also accept `AWAITING_PAYMENT` as a `from`: physical work
is the second way out of the money phase, for orgs that reconcile payments in Xero
and never write a `payments` row. See FEATUREDOCS/76.

### The floor — the column is DERIVED, Undo is EXACT, the pull sheet is ONE list
`/warehouse` (the floor, FEATUREDOCS/12) has three rules that look relaxable and aren't:

1. **A job's floor column is derived by `warehouseStage()`** (`convex/lib/warehouseStage.ts`)
   from its unit counts. Never store it, never let a card be dragged between
   columns, and never re-derive it client-side — `warehouseList.bundle` returns it.
2. **A Returning-mode Undo reverses exactly its own write.** Asset/kit returns go
   through the announced `checkInItems`/`checkInKit`; a bulk-tag return's Undo is
   `returnsWrites.unreturnBulkNative` with the `returnedUnitIds` that call handed
   back (parent AND accessory units, from a before/after snapshot). Never "fix" a
   missing Undo by calling `unreturnItems` on the line: it flips every RETURNED unit
   on the line and its accessories, including another scan's or packer's. A partial
   bulk return has no exact reverse, so its Undo is absent (`exactUndo: false`).
3. **The pull sheet dialog and the pull-slip PDF read ONE list**:
   `projectDocumentData(…, "packing-list")` grouped by `filterAndGroupItems` under
   `PULL_LIST_TABLE_CONFIG` (`src/lib/pdfme/pull-list.ts`). Don't give the sheet its
   own line-item builder again.

`projects.packerUserId` is server-owned (only `setPackerNative` writes it; it is not
in `projectWriteFields`). The floor's state is its URL (`?mode=`, `scope`, filter
words), parsed by the one Zod schema in `src/lib/warehouse-floor.ts`.

### ⚠️ `AWAITING_PAYMENT` is ONE status — the sub-steps are DERIVED
The money phase (#1236, FEATUREDOCS/77) sits between `QUOTED` and `CONFIRMED`:
the client has agreed and/or an invoice is out, but the money hasn't landed.
**Never add "deposit invoice sent" or "deposit paid" as statuses.** Both are
already facts on rows that own them — an `invoices` row at `ISSUED`, and
`invoices.paymentStatus`, itself derived from `payments` — so a copy on the
project would be a second source of truth for whether the client's money landed
(R-3.1), and the two WILL disagree the first time a payment is voided.
`src/lib/project-payment-progress.ts` computes the three sub-steps on read;
`<PaymentProgressStrip>` renders them under the job header's progress line, only at
`AWAITING_PAYMENT`.

Two things about it that look wrong and aren't:
- **Its lock tier is `OPEN`, not `FINANCE_LOCKED`.** #988's quote-sent input
  already locks the pricing of anything that came through a quote, and a
  status-driven lock here makes `newVersionNative`'s `bypassQuoteLock` (which
  resolves from STATUS alone) unable to reach its own exit — a client asking for
  a change after approving could never be re-quoted. The residual gap (an invoice
  issued with no quote behind it locks nothing) is PRE-EXISTING and belongs in
  `resolveLockTier` as a third input with its own void-and-reissue exit.
- **It IS in `HARD_PROJECT_STATUSES`.** The gear is held from the moment the job
  is agreed. So the two same-named `isConfirmedOrLater` helpers now disagree for
  this one status: `availabilityCore.ts`'s (stock) says true,
  `projectLocks.ts`'s (money) says false. They ask different questions.

### ⚠️ Quote status is DERIVED — never branch on the stored column
A quote's `status` column is not the whole answer. `EXPIRED` is computed on read
(`validUntil < now && status === "SENT"`) and never stored, and the deprecated
`PUBLISHED` still appears on any row the #986 backfill hasn't reached. Always go
through `effectiveQuoteStatus()` / the `effectiveStatus` field the `convex/quotes.ts`
queries return (`convex/lib/quoteState.ts`) — a `q.status === "SENT"` test silently
treats expired quotes as live and pre-#986 rows as neither. Same reason `quotes` reads
go through `listProjectQuotes`/`requireQuoteInOrg`: `by_projectId` is global, so the
org check has to happen in the loader, not at the call site.

`projects.revision` is the ALLOCATOR — the highest version number ever handed out
(project v2 == quote v2 == the snapshot taken at v2). `projects.liveRevision`
(#1080/#1085) is the separate pointer at the version currently projected onto the
live tables — absent ⇒ `revision`, via `projectLiveRevision()`. Both are
server-owned — written only by `createNative` and `quotesWrites.newVersionNative`
(the older `projectVersionsWrites.saveVersionNative`/`promoteRevisionNative`,
which used to also write them, were deleted in #1229 Phase 3 — superseded by
`convex/versions.ts`'s `createNative`/`makeLiveNative` on the real,
Phase-1/2-introduced `projectVersions` table, FEATUREDOCS/78 — do not confuse the
two "createNative"s or the two version programs), and stripped from client
patches the same way `PROJECT_MONEY_ANCHORS` are. The invariant is "at most one
**live** DRAFT, always at `liveRevision`" — a non-live DRAFT is a legitimate
saved-but-never-sent version, not a bug; scan for "the draft" via `liveRevision`,
never a bare `DRAFT` status match. See FEATUREDOCS/66.

### ⚠️ A client-facing finance document is STORED BYTES — never a fresh render
A sent quote / issued invoice PDF is rendered **once** (`src/server/finance-documents.ts`)
and its Convex `_storage` id attached to the row (`quotes.pdfFileId` / `invoices.pdfFileId`,
via `convex/financeArtifacts.ts`). Downloads stream those bytes
(`/api/finance/{quote,invoice}/[id]/pdf`); there is deliberately **no regeneration
fallback anywhere**, because a route that can regenerate is a route that can hand the
client a different document under the same name (#987). Three rules follow:

1. **Never add a live-render path for `type=quote`/`type=invoice`.** `/api/documents/[projectId]`
   serves those only behind `preview=1`, which requires `invoice:read` and stamps a
   DRAFT PREVIEW — NOT SENT watermark on every page. The header's Documents ▾ is
   warehouse artifacts only; putting a finance doc back in it re-opens the rogue path.
2. **Never overwrite or delete an artifact.** `attach*Artifact` returns `attached: false`
   rather than replacing one, which is what makes the "generate" retry safe on a row whose
   render failed. A recalled/superseded/voided row keeps its document — the client may be
   holding that copy.
3. **A finance render takes its dates from the row**, never `now`
   (`buildDocumentData`'s `stampedDates`). Recomputing `quote_valid_until` at render time
   is what used to silently extend how long a quote was valid every time it was re-opened.

### The shell reads ONE table — `src/lib/nav.ts` (`NAV`)
The sidebar, the rail flyouts, the phone More sheet, the breadcrumb trail and the
palette `@` pages all read `NAV` (pure data; icons by key in `nav-icons.ts`). Add a
page = one row there (and `NOT_IN_NAV` for a deliberately unlisted route: the drift
test `nav.test.ts` fails on any static `(app)` route that is neither). Gating is
applied ONCE in `useNavItems()`; a gated item is absent, never greyed — don't re-check
a permission in a surface. The bottom bar is Home · Jobs · Scan · Warehouse · More
(`BOTTOM_NAV_KEYS`); everything else reaches a phone through More. A More row's
trailing count is a `count` source ON its NAV row (`src/lib/nav-counts.ts`), read by
`useNavCount` only while the sheet is open — never a count computed in the sheet, and
every `navCounts.get` source is role-checked on the server (`callerMayRead`). The org switcher
is the sidebar head (`useOrgSwitch` — ONE `setActive` closure, the Undo toast reuses
it); the user menu is personal. Top-bar titles come from `buildTrail`: a detail page
names its record via `<PageMeta title>`/`useBreadcrumbs`, never a raw id.

**ScanTarget registry:** the bottom-nav Scan is global chrome; what a scan MEANS is the
page's call. A page registers `useScanTarget(handler)` (`components/scanner/scan-target.tsx`)
and receives the decoded value; with none registered the shell does the one-shot
`scanLookup.resolve` lookup. Never mount a second camera or decoder for this — the shell
uses `CameraScannerDialog`, mounted only while open.

**The bell reads ONE feed (`useShellFeed`):** the derived scan (minus dismissals, via
`selectVisibleNotifications` in `src/lib/notification-feed.ts`, shared with
`/notifications`) merged with stored mentions. Mark all read's Undo calls the exact
reverse writes for the exact ids it touched (`markUnreadManyNative`, `undismissManyNative`).

### Off-inventory units — the counter is the truth, demand goes through `stockBackedQty`
"Prep as custom item" (FEATUREDOCS/12) lets a leftover unit of an overbooked serialised line stay on the line (price/docs unchanged) with no serial and no stock held. Three rules:

1. **`projectLineItems.offInventoryQuantity` is the ONE source of truth.** Do not add a per-unit "is custom" flag — the unit side is just a generic (asset-less, qty-1) `projectLineItemUnits` row, the same shape `prepUnit` creates for untagged lines. It is server-owned: only `warehouseOps.convertUnit*`, `deprepItemInner` (decrements with the deleted generic unit) and make-live's `carryRealityByLineage` (re-derives it with the carried units — `copyPlanGraph` deliberately does NOT clone it) write it (it is in `LINE_IMMUTABLE_ON_PATCH`); `patchNative` refuses edits that would desync it (model/type/asset change, quantity below custom + serial units). A custom unit is born prepped — never reintroduce a PENDING custom unit; the warehouse stage logic can't place one.
2. **Every stock-demand sum reads `stockBackedQty(line)` (`convex/lib/stockBackedQty.ts`), never raw `quantity`.** `convex/stockBackedQtyGuard.test.ts` lists the sites; a new availability/overbooking site goes on that list. Billing, PDFs, ROI and the warehouse "everything deployed" test (`projectAutoStatus`) keep the full `quantity` on purpose.
3. **A custom unit keeps the model's accessories.** Its share is per-parent rows on the existing accessory child lines keyed `parentUnitAssetId = customUnitScope(unitId)` (`custom:<unitId>`). Any new accessory cascade that scopes by `parentUnitAssetId` must treat that as a valid parent key, and anything that sums accessory demand per parent must add `offInventoryQuantity × per-parent` (`expandAccessoriesForAsset` does).
4. **A whole-line deploy must include prepped generic units on a mixed line** (`expandPrepUnitAssignments`) — otherwise the custom unit is stranded.

### Kit state is DERIVED, and a location's last movement has ONE writer
- **Never branch on a kit's stored `status === "INCOMPLETE"` yourself** (UX Phase 14, D75, FEATUREDOCS/09). A
  kit's Incomplete / Reserved / Available come from `convex/lib/kitState.ts` (`deriveKitState`, `loadKitStates`,
  `loadKitBookingGate`): a missing member (LOST / retired / absent asset, a bulk member short of the kit's
  quantity) OR the stored `INCOMPLETE` marker is Incomplete; a live booking on a confirmed-or-later job is
  Reserved. The marker is "reported missing": a MISSING kit return WRITES it (a bulk-only kit has nothing else to
  derive from) and only `kitWrites.markCompleteNative` clears it. The physical statuses (`CHECKED_OUT`,
  `IN_MAINTENANCE`, `RETIRED`) stay stored and win. Every "can this kit go on a job" gate uses
  `loadKitBookingGate` (Convex) or `kitsList.bookingGate` (server actions); never re-test the stored value.
  Check-out has its own gate on the same state (`checkoutKitPreflight` → `KIT_REPORTED_MISSING`), because the
  add-line gate cannot see a kit reported missing AFTER it was booked.
- **A list read that fans out per row draws from ONE `ReadBudget`** (`convex/lib/readBudget.ts`): a row the budget
  cannot cover returns `null` (printed as a dash) and the response sets `truncated`. A list's sort is an explicit
  allow-list with no generic field fallback, and a cost key from a caller who cannot see cost falls back to the
  default order ascending (asc and desc identical).
- **`locations.lastMovementAt` is written only by `convex/lib/locationMovement.ts`** (`stampLocationMovement`,
  `LocationMovements` for batches), on both ends of any write that sets, changes or clears an asset, bulk asset
  or kit `locationId`. A new write path that touches `locationId` MUST call it:
  `convex/locationMovementGuard.test.ts` discovers location writes and fails otherwise (add the new file to its
  `EXPECTED_DISCOVERED` map only after it stamps). An absent value prints `—`, never a guess.

### Custom accessories — free text, but still a real accessory child
A not-in-inventory accessory (`modelCustomAccessories` per model, `accessoryPlan.custom` per line,
FEATUREDOCS/48) is an ordinary ACCESSORY child line keyed by `customAccessoryKey` (no asset/bulkAsset).
Never give it a second code path: expansion/reconcile/rescale go through `resolveCustomAccessories`
(`convex/lib/fulfillment.ts`), its units are asset-less rows, and `includeAccessoryIds` identifies it
by child LINE id. A site that filters accessory children by `assetId ?? bulkAssetId` must fall back to
`child.id`, or custom accessories silently stop deploying under a narrowed ("Deploy Verified Only") call.

### Prisma v7
- Import from `@/generated/prisma/client` (NOT `@/generated/prisma`)
- After schema changes: `pnpm exec prisma migrate dev` → `pnpm exec prisma generate` → restart dev
- **Bulk-data migrations MUST end with `ANALYZE "<table>";`.** A large
  `INSERT`/`UPDATE`/`DELETE` leaves the planner on stale row-count statistics
  until autovacuum eventually catches up; until then it can pick pathological
  plans for hot queries, and one slow query saturates the connection pool and
  stalls the whole app intermittently (then "fixes itself" when autovacuum runs
  ANALYZE). See `20260605140000_analyze_project_line_item`. The runtime
  `statement_timeout` (above) bounds the blast radius, but fresh stats are the
  actual fix.

### Server Actions
- All in `src/server/` with `"use server"` directive
- Must call `serialize()` on all return values
- Write ops use `requirePermission(resource, action)`
- Read ops use `getOrgContext()` for org scoping
- All writes must call `logActivity()` for audit trail
- **NEVER re-export a type from a `"use server"` file** via `export type { X }`. Next's server-action transform catches the re-exported name in the export list and emits a runtime reference to it — but a type has no value, so SSR crashes with `ReferenceError: X is not defined` on module evaluation. Declare the type in a plain `src/lib/*` module and have consumers `import type` it from there directly. (Local `export interface X {}` / `export type X = ...` declarations are fine — only re-export specifiers break.)

### Forms & Validation
- Zod schemas in `src/lib/validations/` (CANNOT be in `"use server"` files)
- Use `z.input<typeof schema>` for form types (NOT `z.infer`)
- React Hook Form + `zodResolver()` + `useMutation()`
- Derive schema variants (an update/patch form of a base schema) with `.omit()`/
  `.pick()`/`.partial()` instead of re-declaring the shared fields — a second
  hand-maintained copy of the same bounds is a defect even in sync (R-8.6.3/R-3.1).
- **API routes that read a JSON body MUST use `withValidatedBody(schema, handler)`
  (`src/lib/api-validation.ts`)**, not a bare `request.json()` + manual `.parse()`.
  It's the structural counterpart to `readValidatedBody` (same file): a handler
  built with it physically cannot run without a schema, so a route that forgets to
  validate is a compile error, not a discipline lapse (R-8.6.4). Any pre-body checks
  (rate limiting, CSRF, auth) stay in the exported route function and call the
  wrapped handler once they pass — see `src/app/api/admin-register/promote/route.ts`
  for the pattern. Exception: a route that needs the **raw** body before parsing
  (e.g. HMAC-verifying a webhook signature) can't use the wrapper — validate with
  the underlying Zod schema directly after verification instead (see
  `src/app/api/integrations/woocommerce/webhook/route.ts`).
- **Convex mutations callable directly from the browser** (`convex/*Writes.ts`
  `*Native` mutations) must mirror their paired Zod schema's business constraints
  (string length, numeric bounds, array length caps) server-side too — the client
  Zod `.parse()` is bypassable by any caller with a valid session hitting the
  mutation directly. See "The write security bar" in
  `FEATUREDOCS/54-convex-data-layer.md` and `convex/lib/fieldGuards.ts`.

### DOM Safety (removeChild Fix)
- `DomPatch` (in root layout) monkey-patches `removeChild`/`insertBefore` to silently ignore calls where the target node is not a child — prevents the React 19 "Cannot read properties of null" TypeError
- `GlobalErrorBoundary` (in root layout) catches any remaining DOM manipulation errors and auto-recovers
- `OverlayLockReset` (in root layout) self-heals the "whole page becomes unclickable until refresh" bug: Base UI/Floating UI marks the rest of the page inert (`data-base-ui-inert` + `inert`/`aria-hidden`/`pointer-events:none` + a full-screen `[role="presentation"]` backdrop) while a modal overlay is open; React 19 sometimes orphans those locks when the overlay unmounts during navigation. A guarded watchdog clears orphaned locks **only when no overlay is open** (`src/components/overlay-lock-reset.tsx`, tested in `overlay-lock-reset.test.ts`). NOTE: this watchdog targets the legacy **Base UI** `data-base-ui-inert` markers. Radix overlays (now the default) manage their own `pointer-events:none` body lock via DismissableLayer and clear it on close, so they don't rely on this watchdog — the real Radix footgun is nesting a non-Radix popup inside a modal Dialog (see the composition note above).
- **When adding new providers or scripts to the root layout**: place them inside `<GlobalErrorBoundary>` to ensure coverage
- **Never remove** `DomPatch`, `GlobalErrorBoundary`, or `OverlayLockReset` from `layout.tsx` — they are critical for navigation stability
- **Dropdown/menu UI is Radix** (`@radix-ui/react-dropdown-menu`): `DropdownMenuItem` supports both `onSelect` and `onClick` (the codebase uses `onClick`). The codebase wraps `DropdownMenuLabel` in `<DropdownMenuGroup>` for consistency. Test menus by actually OPENING them, not just rendering the closed trigger.

### The project detail's tabs are CONTROLLED, and Overview is the landing tab
`/projects/[id]` opens on **Overview** — the project's home (#1061,
FEATUREDOCS/69). Adding a tab means adding its key to `JOB_TAB_KEYS` in
`src/lib/job-tabs.ts` (this was the page's `VALID_TABS`) AND a panel to the page's
`panels` map: a key with no panel is unavailable, so a `?tab=` deep link to it
silently falls back to Overview. A tab's label count and its tab-row primary come
from its owner through `src/components/projects/job-tab-sources.ts`, never
computed in the page. The tab strip is controlled (`TabStrip` `value`/
`onValueChange`) because the Overview readiness checklist navigates you to the
tab that fixes a failing check — don't make it uncontrolled.

Overview owns the project's **at-a-glance** state, as one calm column (§6b, UX
Phase 7, `overview/overview-tab.tsx`): readiness first (a verdict, the first
blocker in words with its one link, the rest as text rows that each link to the
tab that owns the fix; from Out onward a one-line state sentence with only
failing incidents and blocking discussions under it), then two quiet money
lines (quote · invoicing, rendering exactly what `deriveInvoicingState` and the
quote reads say), then When · Where · Who and Recent. **There is no tile strip
and no margin on Overview**: Equipment / Services / Crew / Total and margin live
on the tab that owns each (Equipment's footer + `Show margin`, Logistics'
footer + show cost, Finance's summary) — don't add tiles back. The readiness
rules are `src/lib/project-readiness-checks.ts` (every row carries its `fix`
target), their words `src/lib/job-readiness-verdict.ts`; double-booking is the
ONE-SHOT `reservationConflicts.projectConflicts` (never a subscription, R-8.3.3
exception), incidents are the bounded, newest-first count on
`projectReadiness.forProject` (never the org-wide `maintenanceRecords.list`), and
blocking discussions are the header's own `getProjectBlockingSummary`
subscription. A check whose input hasn't arrived (the blocking count loading,
the conflicts read not answered, a truncated incidents scan with none open) is
`unknown`, never dropped and never a pass — so the section can't read "Ready"
early. The money lines print to the cent, as the stored PDFs do. The job header
(`src/components/projects/job-header.tsx` on `DetailHeader`, UX Phase 7) stays
ABOVE the tabs: its progress line and lock glyph change what you can do in every
tab. The header's version lives in ⋯ (`Version ▸`) and under `V`, never as a chip
(D92). A header action that doesn't apply is absent, and each gate is the
server's own permission (`src/lib/job-header.ts`).

**Editing a job is a SHEET, not a page (UX Phase 9, D22).** `?edit=1` on the record
opens `JobEditSheet` (hosted once by `[id]/page.tsx`, on `FormSheet`); every entry
point builds its URL with `jobEditHref` (`src/lib/job-edit-url.ts`) or
`useOpenJobEdit()`, and `/projects/[id]/edit` is only a redirect. The field list is
ONE `ProjectFields` (`project-fields.tsx`, `projectSchema` order) shared with the
wizard; status is NOT a field (the header stepper owns it). A save sends only the
CHANGED fields through `buildProjectUpdate(parsed, { before })`: a full payload
puts `discountPercent`/`taxRate` in `set`/`clear`, and `updateNative` refuses ANY
touch of those on a pricing-locked job, so never go back to sending every field.
Moving the rental dates carries a set project window by the same calendar-day
offset (`shiftWindowWithRental`); a blank window stays blank.

**Templates are a dialog, not a page (UX Phase 9, D23).** `/projects/templates` and
`/projects/templates/new` only redirect to `?templates=1|new` on `/projects`; `projects/layout.tsx`
hosts the one `ManageTemplatesDialog` / `NewTemplateSheet`. A template's `Delete…` ARCHIVES it
(status `CANCELLED`, exact `fieldEditUndo` Undo from the audit ids the archive returns); only an
archived template can be deleted for real (`deleteTemplateNative` refuses otherwise, no Undo).
`Start from template ▾` applies through `applyTemplateNative` onto the wizard's EMPTY draft, which
runs `duplicateCore` (`projectWrites.ts`), the same deep copy `duplicateNative` runs: never write
a second copy of how a plan is copied. Its Undo reads its own audit row and refuses if any copied
row changed.

**The context sidebar (Schedule/Location/Team/Activity) renders on every tab
EXCEPT Overview** (#1063). Overview composes the schedule, location and team
facts into its own When · Where · Who columns (`overview/context-cards.tsx`) —
rendering both would show those facts twice on one tab. Those facts are shaped
once in `src/lib/project-context.ts` and shared by both renderings; if you add a
field, add it there, not in one renderer. **Recent is NOT the sidebar's
Activity**: Recent is the AUDIT LOG (`activityLog.recentForProject`, bounded,
newest four), while the sidebar's Activity is the collaboration feed
(`collaboration.listActivityEvents`). Don't describe them as the same content,
and never point Recent back at an unbounded read (`listByEntity` collects).

A readiness check covering the WORK (services: still `PLANNED`, or below
`crewCountRequired`) is separate from one covering the PEOPLE (crew assignments
awaiting a yes) — don't merge them back into one row.

A readiness check that can't run reports `unknown`, never a pass — a dateless
project's gear check says "not checked" rather than a false all-clear, and
`unknown` never counts toward "all clear".

### ⚠️ A Convex query's args are its SUBSCRIPTION KEY — never pass a fresh `Date.now()`
`convex-helpers`' `createQueryKey` JSON-stringifies the args into the cache key, and
`useQueries` tears the subscription down and restarts it whenever that key changes. So
a timestamp evaluated **inside** the query call re-keys on every render, the result
drops back to `undefined` the moment data arrives, and the query never settles:

```tsx
// BROKEN — stuck on "Loading…" forever (a `return null` loading branch never renders at all)
const cards = useAuthedQuery(api.dashboardLists.upcoming, { orgId, now: Date.now() });

// CORRECT
const now = useStableNow();            // @/hooks/use-stable-now — mount-time snapshot
const cards = useAuthedQuery(api.dashboardLists.upcoming, { orgId, now });
```

This shipped twice in #1245 (since-removed pages). It is
now a `no-restricted-syntax` **error** (`eslint.config.mjs`) on any `Date.now()` inside a
`use*Query*` call — `react-hooks/purity` only warned, which is how it got through. Any
other per-render-fresh value (`createId()`, `new Date()`) in query args is the same bug.
A surface that must genuinely tick needs its own interval and must keep that value OUT
of the args.

### The camera scanner is ONE WASM engine — never the platform `BarcodeDetector`
The in-app barcode scanner (`src/lib/barcode/`, `src/hooks/use-camera-scanner.ts`,
`src/components/scanner/`) reads QR, **Micro QR**, **rMQR**, Data Matrix, Aztec,
PDF417 and the common linear codes through ZXing-C++ WASM on **both** platforms.
Adding a "use the native `BarcodeDetector` where available" fast path is the one
change that is always wrong here: `micro_qr_code`/`rm_qr_code` aren't in the Shape
Detection API spec (so Chrome/Android's ML Kit backend can't read them either), and
WebKit has never shipped the API at all, so every browser on iOS needs WASM anyway.
Two decoders behind one button is exactly how the previous scanner came to behave
differently on the platform nobody tested — it was removed for "never working on
iPhone". See FEATUREDOCS/19 and `docs/designs/barcode-scanner-2d.md`.

Five things that look removable and aren't (all iOS; every browser there is WKWebView):
1. **`getUserMedia` only inside a user gesture** — from the dialog's open handler,
   never a mount effect. A non-gesture prompt rejects indistinguishably from a denial.
2. **`playsInline` + `muted` + an awaited `play()`**, set in JSX *and* imperatively on
   each start. Miss one → live track, black picture.
3. **`facingMode: { ideal: "environment" }`, no `deviceId`.** `exact` throws on any
   device without a rear camera; pre-permission `enumerateDevices()` returns blanks
   on iOS, so label-matching picks nothing.
4. **`stopStream` on EVERY teardown path** (close, unmount, visibilitychange, each
   early return in `start()`). One live capture at a time on iOS — a leaked track
   blocks the next `getUserMedia` app-wide.
5. **Release on hide, re-acquire on show.** iOS suspends capture when backgrounded
   and never resumes; a held track means a permanently black viewport.

Torch/zoom are feature-detected and **absent** on iOS rather than dead. The decoded
region is a native-resolution centre crop sized from the same `ROI_FRACTION` the
reticle uses — don't hand-tune one of the two. The `.wasm` is self-hosted in
`public/wasm/` (committed; `pnpm run wasm:sync:check` gates it), never the jsDelivr
default, or the scanner silently stops decoding on warehouse wifi.

**Any change to formats or reader options needs a round-trip test** in
`src/lib/barcode/decoder.test.ts` — encode a real symbol, render it to `ImageData`
the way the pump does, decode it back. The absence of exactly that test is how
"it doesn't work on iOS" shipped.

### UI vocabulary — words in `src/lib/vocabulary.ts`, intent in `status-colors.ts`
The UI says **Job** (code, routes, enums, Convex and API/MCP names stay `project`), **Home**
(`/dashboard`), **Schedule** (`/availability`), **Out** (`CHECKED_OUT`; the verb **Deploy**
stays), **Loose** (not in a case), **To pick · Prepped · Out · Returned · De-prepped · Closed**.
Module names and stage words come from `vocabulary.ts` (`MODULE_NAMES`, `GEAR_STAGE_LABELS`,
`OUT_LABEL`, `LOOSE_LABEL`); stage colours come from the one `gearStage` table in
`status-colors.ts` — never an inline `bg-*-soft` stage override. Convex-authored error and
activity text still says "project"/"deployed" (known residue). The phone breakpoint is
`PHONE_MAX` = 859 (`src/lib/breakpoints.ts`; Tailwind `md` = 860); the 72px tablet rail at
<= 1023px is a CSS (`max-lg`) swap in `app-sidebar.tsx`, ⌘B collapse is desktop-only.

### ActionMenu — one row menu, absent-not-disabled, builders in `src/lib/row-actions`
`ActionMenu` (`src/components/ui/action-menu.tsx`) is the ONLY row/overflow menu: a Radix
DropdownMenu on desktop, a 48px `BottomSheet` on phone (it replaced `row-actions-menu.tsx`,
deleted). It renders an `ActionMenuSpec` built by a pure per-row-kind function in
`src/lib/row-actions/` (`buildGearLineActions` is the first; the project and the warehouse
share it). Rules: an action that does not apply is **absent** from the spec, never
`disabled` (there is no such field); `danger` items go last and red and carry a `confirm`
(rendered with `Dialog`; there is no AlertDialog) unless their handler already opens its own
dialog; one sub-level via `children`; shortcuts (`kbd`) fire only while the desktop menu is
open. `trigger` swaps the default ⋯ for any element (`Documents ▾`, a lock glyph). The
dropdown is `modal={false}` so a confirm Dialog opening as it closes is not click-locked.
`ConfirmActionMenuItem` is legacy (R-4.4); don't use it in new menus.

### ListPage over LineRowList — the URL is the state
A list page (Jobs `src/components/projects/jobs-list.tsx`, Assets `src/components/assets/assets-list.tsx`)
is a config handed to `ListPage` (`src/components/ui/list-page.tsx`), which renders rows through
`LineRowList`, NOT `DataTable` (that stays for lists not yet migrated). Segment, filters, sort,
page, search and view are query params (`src/lib/list-url-state.ts`: defaults omitted, junk
dropped), so never mirror them into localStorage or component state; only `colVis` and the
Assets grid/table choice stay local. Never put `Date.now()` in the query args (date filters
resolve through `useStableNow`). A saved view on such a list stores `{ query }` (the query
string); `UrlSavedViewsMenu` converts old `{filters, sortBy}` rows on read, don't backfill them.
A row/bulk verb exists only if an existing mutation backs it; bulk writes are per-row gated, name
what they skipped and share ONE Undo closure (`announceListWrite`).

### Equipment tab (Phase 2a) — AddBar, one accessories editor, one shortfall mutation
The Equipment tab is `LineRowList` sections (`equipment-sections.tsx`); `AddBar` under the list **replaces the old
`Add ▾` menu** (Enter adds a gear/kit line with a blank price, the server auto-prices; sub-hire/custom/sale open the
existing dialog). **Accessories have ONE editor**, `EditAccessoryPlanDialog`: the row's ⋯ and the Edit Item dialog's
button both open it; never re-embed a picker in Edit Item. On phone a row tap opens `RowEditorSheet`
(`equipment-row-editor.tsx`), saved through the shared `computeRowSheetPayload` → ONE `patchNative`; anything
shown in desktop `cells` (discussion badge, serial indicator) must ALSO live in the sheet's `contextSlot`.
**Shortfall → sub-hire is ONE mutation**, `subHiresWrites.coverShortfallNative` (nested `ctx.runMutation`
sub-transactions: order + item + line trim, all-or-nothing); never reassemble it from client-side `create` / `addItem` /
quantity writes. Its Undo, `undoShortfallNative`, takes only order + item ids and re-derives everything from the
`subHireItems.coverage` record the cover wrote (refusing if the order is no longer DRAFT, other items joined, or the line
was edited); never add client-supplied restore quantities. `coverage` describes ONE cover, so no copy/duplicate path may
carry it. Rate reads (`getSupplierRateHistory`, `getSupplierModelRate`) need `subHire:read`; the row action needs
`subHire:create`. Both mutations are `danger: "high"`.

### Packing tab (Phase 8) — one `planInto`, a server-sourced Undo, a seal that locks the PLAN
`src/components/projects/packing-tab.tsx` plans which case each line travels in (FEATUREDOCS/83).
- **`usePackingPlan().planInto(ids, case | null)` is the ONLY caller of `setPlannedContainer`**: drag,
  bulk `Plan n into…`, the row ⋯ and the case's `Unpack` all use it, so they share what it skips (packed
  lines, lines in a sealed case, other versions) and its single Undo. Never add a second plan write site.
- **A plan Undo takes no client-supplied prior values, and runs once.** The forward
  `setPlannedContainerNative` writes one audit row per changed line (`PLAN_LINE`: previous + new case) and
  a batch header (`PLAN_BATCH`, id = the call's `auditId`); `restorePlannedContainersNative({ batchAuditId })`
  reads each line's previous case from those org-checked rows, restores only lines still as that write left
  them (not packed since, not in a sealed case), and writes an `undo:<batchAuditId>` marker so a stale Undo
  can never replay over a later plan (ABA). A no-op restore is never "Undone": a seal-only block throws
  `CASE_SEALED`, otherwise the toast says nothing was restored (`announceUndo`, `src/lib/packing-undo.ts`,
  the ONE result-to-toast). A case delete's Undo is ONE mutation (`undoDeleteContainerNative`: re-create in
  place from the delete's audit snapshot, then the same exact restore).
- **A seal (`projectContainers.sealedAt`) locks the PLAN only**: `assertContainerNotSealed`
  (`convex/lib/containerSeal.ts`, `CASE_SEALED`) guards plan-in, plan-out, rename, re-nest and delete of the
  case, AND (from the parent side) nesting a case into, taking one out of, or creating one inside a sealed
  case. It never blocks warehouse prep or unit moves (owner-decided). Show the server's own message (it
  names Unseal); don't hand-write a second copy.
- **"Packed" is ONE predicate** (`convex/lib/packedUnit.ts`: a non-cancelled unit with a `containerId`),
  read by the plan writes, the Make-live preview, `versionRowFacts`, readiness and the Packing tab, so
  `plannedCount` and `Packing n/m` agree.
- **Unplanned (plan state) is not Loose (physical state)**: the dashed card is titled `UNPLANNED_LABEL`.
  The glyph rule (`planGlyph`) prints `Planned → LX-04` only when a packed line's plan disagrees with reality.
- `packingCounts(lines)` is the one derivation of the tab's `Packing n/m` (`usePackingTabCount`).

### Versions tab (Phase 8) — a tab, a sheet, one dialog, all driven from the version context
Versions is a job tab (`?tab=versions`; `V` and ⋯ › Version › Manage versions… open it), not a sheet.
- **The tab** (`versions/versions-tab.tsx`) is a dated list; its row ⋯ is `buildVersionRowActions`
  (`src/lib/row-actions/version-row.ts`: Open · Make vN live… · Compare with vN… · Rename… · Save a copy… ·
  Delete… red last, never on the live row). Facts come from ONE bounded read
  (`versionsPreview.versionRowFacts`: the newest 6 versions, `plannedCount` only for the newest 3, budgeted
  on TOTAL documents, `truncated`/`null` when a cap bites). Never add per-row queries.
- **Compare is a read-only SHEET** (`compare/compare-sheet.tsx`, a 92% bottom sheet on a phone), not a page
  mode: it renders `versionsRead.compareVersions` (no second diff) with both side pickers, the money bridge
  jump and the `n`/`p` stepper. **Make live is ONE dialog** (`versions/make-live-dialog.tsx`: counts-only
  preview that fails OPEN, Undo only when `conflicts.length === 0`, server-checked via `expectLiveVersionId` AND `undoOfAuditId`: it refuses if ANY newer make-live exists on the
  project, so A→B→A can't be fooled; the reverse flip's own conflicts are surfaced, never discarded).
  `VersionOverlays` hosts both once under `ProjectVersionProvider`; every entry point calls the context's
  `openCompare` / `openMakeLive`. Never mount a second copy.
- **Save as new version** is `useSaveVersion` (one write; its Undo is the GUARDED `versions.undoCreateNative`, which deletes the copy only while it is
  unedited, unquoted and not live, else `VERSION_CHANGED` and the copy is kept), shared by
  the tab primary, the row ⋯ and the header ⋯'s `New version from vN`. The tab-row primaries
  (`JOB_TAB_PRIMARY`: `+ Add case`, `Save as new version`) are outline on desktop; the phone gets a red
  sticky bar from the tab body.

### BulkBar and ScanStrip — two footguns
`BulkBar` (`src/components/ui/bulk-bar.tsx`, replaced `BulkActionBar`) is the ONE bulk
surface. On a phone it is **portaled to `<body>`** and pinned above the bottom nav:
the app-shell `<main>` keeps a lingering `transform` from its page-enter animation, so a
`fixed` bar left in place resolves against `<main>` and an inline one reflows the list on
every tap. Don't remove the portal. **Inside a modal Radix `Dialog`, pass `inDialog`** (Manage templates):
the body portal inherits the Dialog's `pointer-events: none` lock and every click is swallowed, so there the bar
stays in `DialogContent`, sticky, on every breakpoint. A verb with no `confirm` fires immediately (the
surface owns its own dialog, as the three legacy consumers' `BulkDeleteDialog` does).

`ScanStrip`'s `undo` MUST be `AnnouncedWrite.scanUndo` from `announceWarehouseWrite`,
passed through unchanged: it is the exact guarded closure the toast's Undo calls, so the
toast and the strip can never disagree about whether an undo fired. The strip calls it
once per click and adds no guard of its own; never derive a second reverse mutation.

### The warehouse job page — one scan pipeline, one stage row, no pick list, ≤ 800 lines
`/warehouse/[projectId]` is ONE card (stage row + `ScanDock` + `JobTable`), FEATUREDOCS/12.
- **`?stage=` is the selector; `?tab=` is an alias** (`stageFromParams` in `job/stage-card.tsx`:
  `pick-prep`→`pick`, `check-out`→`prepped`, `check-in`→`out`, `deprep`→`returned`). Old emails and
  bookmarks use `?tab=`: keep the alias; a new stage goes into `STAGE_KEYS` or its deep link falls back.
- **Every scan goes through `useWarehouseScan`.** Never add a stage-private scan input or a second
  lookup path. The Returned dock resolves on the SERVER (`lookupDeprepScan`, `warehouse:check_out`) and a
  scan de-preps ONE unit: a serial tag passes its `assetId` to `deprepItems` (never "one by count"), a bin
  tag only matches units with `bulkAssetId === bin`.
- **There is no localStorage pick list** (deleted; "picked" is To pick → Prepped). The scan sheet's
  "Remember for the next n" is job-scoped **in memory** (`warehouse-scan-memory.ts`), not `localStorage`
  and not shared across packers (that is a schema follow-up).
- **`prepItems` reports what THIS call packed** (`packedAccessoryUnits` per parent unit,
  `packedAccessoryLineIds`), never a re-read of line state; the deploy gate compares marked vs that set.
- **`page.tsx` must stay ≤ 800 lines** (`page-size.test.ts`, a real assertion, no ratchet): put logic in
  `components/warehouse/job/use-*` hooks and dialogs.
- Phone: `StageActionBar` + `JobRowSheet`; the pinned dock is `PinnedAboveBottomNav` (shared with `BulkBar`).

### Select — pass explicit label children to `SelectValue`
Radix `SelectValue` auto-mirrors the selected item's text, but the codebase
convention is to **pass explicit children anyway** (belt-and-braces): it guarantees
the human-readable label even when the selected `SelectItem` isn't currently mounted
(virtualised / async lists), where a bare `<SelectValue />` can fall back to the raw
`value` like an ID or enum key. Keep every `<SelectValue>` with explicit children:
```tsx
// BAD — shows raw value like "createdAt" or "CHECKED_OUT"
<SelectValue />
<SelectValue placeholder="Select..." />

// GOOD — shows resolved label
<SelectValue>{items.find(i => i.value === selected)?.label ?? selected}</SelectValue>
<SelectValue placeholder="Select...">{selected ? labelMap[selected] : "Select..."}</SelectValue>
```

### Non-blocking preview gates — one shape, reused (`useConfirmStatusGate` / `useDateMoveGate`)
"Would this write strand someone else's stuff?" is answered by a **one-shot
query before the write, never a blocking check inside it.** `useConfirmStatusGate`
(confirming a job) and `useDateMoveGate` (#1227, moving a confirmed job's dates)
share one shape: `request*(payload)` runs the preview; if it finds nothing, it
calls `onProceed(payload)` immediately with zero UI change; if it finds
something, it stashes `payload` on `pending` and shows a warn+confirm dialog
whose confirm button calls the ONE `onProceed(payload)` — never a second
mutation path. **Fails OPEN on any query error** — an advisory preview must
never block a real write. Copy this shape for the next one rather than
inventing a new one; the two dialogs (`ConfirmStatusImpactDialog`,
`DateMoveImpactDialog`) deliberately share the same warn-icon/copy grammar too
("this is a heads-up, not a block") so a user learns the pattern once.

### A second UI surface reuses the exact reverse trigger — never derives a new one
When a write's toast already offers Undo (`announceWarehouseWrite` →
`AnnouncedWrite.scanUndo`, `src/lib/warehouse-undo-toast.ts`), a second surface
that also wants to offer undo (the scan history strip, #1223) must be handed
that SAME closure, not re-implement "call the reverse mutation" itself. Two
independent reverse implementations for one write is how a double-undo or a
"did that already fire?" bug gets in — one guarded closure, shared, is the
only way the two surfaces can't disagree about whether the write was undone.

### An exact Undo reads its OWN forward audit row — ids only (Phase 16)
`checkRecordWrites.undoAdHocCheckNative` and `testTagRecordsWrites.undoCreateNative` (the
Scan page's Undo, FEATUREDOCS/37 and 14) take ids only. Everything they restore comes from
a snapshot the forward save wrote into its own audit row's `details` in the same
transaction (before/after values, the record and maintenance ids it created, and
`serverSavedAt`). Never add a caller-supplied "restore to" value. Both refuse as a whole,
changing nothing, unless:
- it is within `UNDO_WINDOW_MS` (`convex/lib/undoWindow.ts`) on the SERVER clock;
- the caller is the person who saved it, and it is the first undo;
- the record is still the asset's newest;
- nothing it touched has changed since.
An Undo NEVER deletes a stored file: it deletes only the records its save created, and
the photos stay (a file can be referenced from places no scan can enumerate). The save
still proves each photo is the actor's own fresh upload (`convex/lib/checkPhotos.ts`).
A new exact Undo copies this shape.

The Scan page's own two rules:
- Every input path ends in ONE `scan(tag)` (`src/components/scan/use-scan-session.ts`).
- A save hands its ONE `announceListWrite` closure to both the toast and Last scans.

### Design System
Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, component patterns, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md.

### PDF generation — two vendor pipelines, one per doc family
**#790 redesign (2026-07-26)** ripped out the old PDF customization engine
(dual render pipelines, stored per-org templates, section/block model,
`{token}` resolution, visibility conditions, brand templates, Convex
`documentTemplates`/`brandTemplates`/`sectionPresets`) — ~8,300 LOC deleted.
No template designer of any kind exists or is planned. See
`docs/designs/pdf-system-redesign.md` and FEATUREDOCS/13 for the full
architecture and migration history.

**The react-pdf migration (#1150-#1157, 2026-09-14)** then moved the 5
project document types (quote, invoice, packing-list, return-sheet,
delivery-docket) off the #790 redesign's own hand-rolled two-pass
estimate/draw pagination engine (`document-layouts.ts` →
`document-composer.ts` → `pdf-render.ts`, deleted) onto
**`@react-pdf/renderer`** (Yoga/flexbox automatic layout — no separate height
estimate to keep in sync with the render, structurally closing the tail-drop
bug class described below for good): `generatePdf()`
(`src/lib/pdfme/generate-pdf.ts`) now calls `renderReactPdfTemplate()`
(`src/lib/react-pdf/render.tsx`), the single call site for
`@react-pdf/renderer`'s render-producing exports (`no-restricted-imports` in
`eslint.config.mjs` enforces it, mirroring the pdfme rule below). Each doc
type is its own component tree under `src/lib/react-pdf/` (e.g.
`quote-document.tsx`) composing shared pieces from
`src/lib/react-pdf/components/`; `document-layouts.ts` still exists but only
as a minimal `ProjectDocumentType`/`expandProjectGroups` registry, not a
layout schema. **Call sheets and T&T reports were never part of this
migration** — they still render through **pdfme** (`@pdfme/generator`, single
call site `src/lib/pdfme/pdf-render.ts`) with their own plugins
(`src/lib/pdfme/plugins/`) and builders (`src/lib/pdfme/templates/*.ts`).

The 5-doc-type pipeline still has **independent consumers** of the
`DocumentLineItem` shape. Any change to the shape (new field, new synthetic
row type, new relationship between parent and children) must be verified
against ALL of them — fixing one and shipping leaves silent bugs in the
others:

1. **`src/lib/react-pdf/components/line-items-table.tsx` rendering** — what gets drawn (bold, indented, badges, per-unit expansion, etc.), from the model `buildLineItemsTableModel` builds in the pure `src/lib/react-pdf/line-items-table-model.ts` (sections, header + rolled-up price, row numbers, which children and grandchildren render, cell text), plus the formatting helpers from `src/lib/pdfme/line-item-format.ts` (`discountCellText`/`breakdownLabel`/`isSubhireIndicatorVisible`/`getAssetTag`).
2. **`filterAndGroupItems`'s status filter** (`src/lib/react-pdf/line-items-table-model.ts`; `line-items-table.tsx` re-exports it) — miss this → items disappear from docket / return-sheet.

The Equipment tab's **Client view** (UX 2b, `?view=client`) is NOT a third
consumer: `getEquipmentClientView` (`src/server/equipment-client-view.ts`)
runs the quote's own chain (`buildDocumentLineItemData` →
`enrichDocumentLineItems`/`buildBillableServiceRows` from
`src/lib/pdfme/document-line-items.ts` → `structureLineItems` →
`buildLineItemsTableModel(items, QUOTE_TABLE_CONFIG)`) and ships the PDF's
own cell text. Never give it a second derivation of what prints; the parity
gate (`src/components/projects/__tests__/equipment-client-view.parity*.test.tsx`)
fails if the view and the quote PDF disagree.

That's down from 4 consumers across 2 files (pre-#1157: `gearflow-table.ts`'s
render + its own top-level filter, plus `document-composer.ts`'s
`calculateItemHeight` + `getFilteredParentItems`) — react-pdf's automatic
pagination eliminates the height-reservation consumer entirely; there is no
`calculateItemHeight` equivalent because nothing pre-computes how much
vertical space a row needs.

**Synthetic rows (e.g. `isGroupRow: true`) are footguns.** Their hard-coded fields (`status: "CONFIRMED"`, etc.) silently fail any filter that compares against them. Every status/filter site must special-case the synthetic row type, or compute the field dynamically from children.

**Parent/child kinds.** A line is a child when `isKitChild: true` (covers kit members, sub-hire group children, AND accessory children) — that flag is the structural "is a child" test the ~40 `isKitChild: false` DB filters depend on. `childKind` (`KIT | ACCESSORY`) is the *behaviour* discriminator. An **accessory parent** is NOT a kit (no `kitId`); detect it as "top-level line, no `kitId`, has `ACCESSORY` children" and treat it like a kit parent for child rendering — kit children, Project Group members, and accessories are all gated by the single `showKitChildren` flag (2026-07-27, carried into each react-pdf doc component's own `tableConfig`). Warehouse docs (packing-list/return-sheet/delivery-docket) leave it `true`, so accessories still always render there (inseparable, packers need every component); client-facing docs (quote/invoice) set it `false` so the client sees top-level line items only, not exploded kit/accessory sub-rows. See [FEATUREDOCS/48](./FEATUREDOCS/48-child-assets-accessories.md).

**Test coverage rule:** unit tests at the plugin/component layer alone are NOT enough. For any data-shape change, write at least one integration test that exercises the full pipeline (Convex-doc reconstruction → `structureLineItems` → filter → render) against a realistic fixture — see `src/lib/pdfme/document-data-reconstruction.test.tsx` / `line-item-tree-attach.test.tsx` / `plugins/accessories-render.test.tsx`, which render through a real doc component and extract text via `renderPdfPages` (`src/lib/react-pdf/pdf-test-utils.ts`). `src/lib/react-pdf/regression.test.tsx` is the standing regression harness — pagination invariants (no tail-drop, group-header-once, header/footer page furniture, draft watermark) across all 5 doc types via `pdf-parse` text extraction.

History: v0.8.1.0 added group-as-kit rendering. v0.8.1.1 fixed a pdfme-era height-calc miss (tail items dropped). v0.8.1.2 fixed a pdfme-era status-filter miss (groups invisible on dockets). #1149 (2026-08-03) was a real-world recurrence of the same estimate/draw-divergence class on the #790 pipeline — the react-pdf migration (#1150-#1157) removed the two-pass architecture that made that bug class possible for the 5 project doc types; the same discipline (keep render and filter in sync — see the consumer list above) still applies to call sheets/T&T reports, which remain on pdfme.

### Convex Mutation Rules

**Always `throw new ConvexError(...)`, never `throw new Error(...)`** inside `convex/*.ts` mutation files.

Convex masks plain `Error` to a generic `InternalServerError` in production. The mirror helpers (`media-mirror.ts`, `crew-scheduling-mirror.ts`, `check-item-assignment-mirror.ts`, etc.) use a `removeIn`/`removeSafe` tolerance pattern that catches `/not found/i` — this only works if the thrown error is a `ConvexError`, whose payload passes through the production boundary intact.

```ts
import { v, ConvexError } from "convex/values";
// ...
if (!doc) throw new ConvexError("myTable not found: " + id);
```

**Always use `createIfMissing`, never `create`** when mirroring rows into Convex from `src/`.

Concurrent mirror calls or backfill overlap can produce two rows with the same `id`. The `by_cuid` index is non-unique, so both insert; then `.unique()` on that index throws a Convex system error → `InternalServerError`. `createIfMissing` is idempotent and safe.

This applies everywhere a Prisma row is first written to Convex: `src/lib/*-mirror.ts`, `src/server/*.ts`, `src/lib/org-import.ts`.

### Key Gotchas
- No `AlertDialog` — use `Dialog` with confirm/cancel buttons
- `DropdownMenuLabel` must be inside `DropdownMenuGroup`
- `pdfme` (`@pdfme/generator`) — Helvetica only, no Unicode symbols
- Server action dates arrive as strings — wrap with `new Date()`
- Kit join tables use `addedAt` (not `createdAt`)
- Safe areas: use inline `style` with `env()`, not Tailwind arbitrary values
- Project queries must add `isTemplate: false` to exclude templates

## Business-operations skill (`/rvlt-flow`)

`.claude/skills/rvlt-flow/` is the **operator-facing** counterpart to this file:
domain knowledge for *running* the hire business on Flow (job lifecycle,
availability math, job prep, money rules, the MCP tool surface), not for building
the product. Invoke it when a session is about jobs/gear/crew/invoices rather
than code — or when you need the authoritative operator-side reading of a domain
rule. It cites this repo's own sources (`convex/lib/projectAutoStatus.ts`,
`availabilityCore.ts`, `recalc.ts`, `src/lib/api/errors.ts`,
`src/lib/api/mcp/curated-tool-defs.ts`, the FEATUREDOCS), so a behaviour change
in any of those is a change to the skill in the same PR — same rule as a
FEATUREDOC (R-5.2/R-5.3).

## API/MCP consumer skill (`/rvlt-flow-api`)

`.claude/skills/rvlt-flow-api/` is the **integrator-facing** sibling: the wire
contract an external agent needs to connect to Flow over `/api/v1/mcp` or
`/api/v1/ops/{operation}` — connect recipes (OAuth, bearer, stdio proxy), the
envelope (`args`/`idempotencyKey`/`confirm`), scopes + presets, the confirm
gate, the error-code table, limits, the 21 curated tools with their args, and
`references/operations.md` mapping common jobs to non-curated operations. It
is written to be handed to Claude or any other agent **outside this repo**, so
it must stay self-contained (no repo-path cross-references in the body). Its
sources are `src/lib/api/{errors,dispatcher,arg-normalizer,whoami}.ts`,
`src/lib/api/mcp/curated-tool-defs.ts`, `src/lib/api-key-presets.ts`,
`convex/lib/rateLimits.ts` and the generated registry — a change to any of
those (a new error code, a preset change, a curated tool, a renamed arg) is a
change to this skill in the same PR, same rule as FEATUREDOCS/56.

## gstack

**Always use `/browse` from gstack for web browsing. Never use `mcp__Claude_in_Chrome__*` tools.**

### Available Skills
- `/office-hours` — YC-style office hours (startup or builder mode)
- `/plan-ceo-review` — CEO/founder-mode plan review
- `/plan-eng-review` — Engineering manager plan review
- `/plan-design-review` — Designer's eye plan review
- `/design-consultation` — Design system creation
- `/review` — Pre-landing PR review
- `/ship` — Ship workflow (merge, test, review, PR)
- `/browse` — Headless browser for testing and dogfooding
- `/qa` — QA test + fix bugs
- `/qa-only` — QA report only (no fixes)
- `/design-review` — Visual QA + fix
- `/setup-browser-cookies` — Import cookies from real browser
- `/retro` — Weekly engineering retrospective
- `/debug` — Systematic debugging with root cause investigation
- `/document-release` — Post-ship documentation update

### Troubleshooting
If gstack skills aren't working, rebuild:
```bash
cd .claude/skills/gstack && ./setup
```

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

## Deploy Configuration

- **Platform:** Docker image → GHCR → **Coolify** (NOT the old self-hosted pm2 box).
- **Production URL:** **https://flow.rvlt.app** (the old `home.twotoned.com.au` is dead — returns Cloudflare 530).
- **Deploy workflow:** `.github/workflows/build-image.yml` ("Build & Deploy (GHCR + Coolify)") — triggers on push to `main`.
- **Deploy status command:** `gh run list --workflow build-image.yml --branch main --limit 1 --json status,conclusion,headSha`
- **Merge method:** merge commit (matches existing git history; not squash).
- **Project type:** Next.js 16 web app + PostgreSQL/Prisma + Convex Cloud.
- **Post-deploy health check:** `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` — expect 200 or 307 (root redirects to login).

### Deploy pipeline (GHCR + Coolify)
The workflow (`build-image.yml`) does, in order:
1. `pnpm install --frozen-lockfile` (for the Convex CLI)
2. `pnpm exec convex deploy -y` — pushes Convex functions to **prod Convex Cloud** (`useful-cuttlefish-334`)
3. Log in to GHCR, `docker build` + push the app image
4. **Trigger Coolify deploy** via webhook (`curl` to `COOLIFY_DEPLOY_WEBHOOK`)

**Prisma migrations run at container START** (`docker-entrypoint.sh`), NOT in the runner — the runner can't reach the prod DB. (`migrate.yml` is a manual one-off migration workflow, not part of the normal deploy.)

### ⚠️ Coolify deploy is ASYNC
A green workflow run only means the image was pushed and the Coolify webhook **fired** — the "Trigger Coolify deploy" step succeeding does NOT mean the new container is live. Coolify pulls the image + restarts asynchronously (and runs migrations on boot). **Confirm a deploy by polling `https://flow.rvlt.app` for 200/307**, not by the workflow status alone. A failed container start leaves the previous image serving.

### Dev environment (static, `:dev` image)
`.github/workflows/build-image-dev.yml` builds `ghcr.io/twotoned/gearflow:dev` on every push to
`main` (and on manual `workflow_dispatch` from any branch), pushes Convex functions to the **dev**
deployment and fires the dev Coolify webhook. It exists because `NEXT_PUBLIC_*` are inlined at
build time — `:latest` carries the prod Convex URL, so a client on it talks to prod Convex with a
dev-issued token (`No auth provider found matching the given token`). Never point the dev
Coolify app at `:latest`.
- Repo **variables:** `DEV_NEXT_PUBLIC_APP_URL`, `DEV_NEXT_PUBLIC_CONVEX_URL`.
- Repo **secrets:** `CONVEX_DEPLOY_KEY_DEV` (a dev key — cannot reach prod), `COOLIFY_DEV_DEPLOY_WEBHOOK`
  (`COOLIFY_TOKEN` is shared with prod).
- The dev Convex deployment needs `CONVEX_AUTH_ISSUER` / `CONVEX_AUTH_JWKS_URL` set to the dev app
  origin, and Coolify's `BETTER_AUTH_URL` must equal that origin exactly.
- PostHog is deliberately unset (analytics inert) and sourcemap upload is off.

### Custom deploy hooks
- **Pre-merge:** none (CI — `ci.yml` — handles lint + typecheck + tests on the PR).
- **Deploy trigger:** automatic on push to `main`.
- **Deploy status:** `gh run watch <run-id>`, then poll the prod URL (async — see above).
- **Health check:** GET `https://flow.rvlt.app` returns 200 or 307 (root redirects to `/login`).

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`pnpm exec convex ai-files install`.

<!-- convex-ai-end -->
