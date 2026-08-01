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

### Convex Dev in Worktrees

**Always use `pnpm exec convex` — never `npx convex`**, which runs a global CLI
copy that can't resolve `convex/server` from local `node_modules`, causing an
esbuild failure. `pnpm exec convex` uses the locally installed version.

**When Claude Code edits `convex/*.ts` files**, push the changes immediately after:
```bash
pnpm exec convex dev --once
```
This is a one-shot push to the shared dev deployment — no watcher, no URL rewriting.
Run it automatically after any Convex function change. `CONVEX_DEPLOY_KEY` must be
in `.env`.

**When a human dev wants a live watcher**, use a named preview deployment to avoid
conflicting with other worktrees or the shared dev deployment:

```bash
# Start Convex watcher for this branch (creates/reuses a preview deployment)
pnpm exec convex dev --preview-run $(git rev-parse --abbrev-ref HEAD)
```

This writes the preview deployment URL to `.env.local` as `NEXT_PUBLIC_CONVEX_URL`,
which the dev server picks up automatically. Run it in a separate terminal alongside
`pnpm dev`. The preview deployment name must not contain `/` — for worktree branches
like `feature/my-thing`, the branch name works fine as-is (Convex URL-encodes it).

`CONVEX_DEPLOY_KEY` must be set in `.env` or `.env.local` pointing to your Convex
Cloud project deploy key.

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
be checked against `organizationId`, or you have a cross-tenant read.

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
   essentially every remaining call site (169 → 1; the sole holdout,
   `globalSearch.search`, is a deliberate `agentAccess: "denied"` decision, not
   an oversight — see `docs/api-coverage.md`'s denied table), so a brand-new
   read starting on the bare guard is now the exception, not the norm.
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

### Mira (in-app assistant) — a first-party MCP consumer, not a special case
Mira answers a question by calling `dispatch()` — the SAME function REST/MCP use —
never a separate code path (`src/server/mira.ts`). It acts as the asking user via a
per-(org, user) `apiKeys` row it provisions itself (`miraKeys` table, secret
encrypted with `src/lib/crypto/secret-vault.ts`, the same vault trusted for Xero
tokens), using the `read_only_agent` preset — never a fixed "system" identity, so a
member can never get more access through Mira than their own role already grants.
The question → operation mapping (`src/lib/mira/intent-router.ts`) is a small
deterministic router today, not an LLM — see FEATUREDOCS/68 before wiring a new
Mira route or swapping in a real model.

### Discount: the AMOUNT is stored, the PERCENTAGE is derived
`projectLineItems.discount` / `projectGroups.discount` are always the **resolved
flat dollar amount** — recalc, allocation, invoicing and `lineTotal` read that
number and nothing else. `discountMode` (`"$" | "%"`, #1012) sits next to it and
records only how the operator *entered* it, so documents can print `-15%`
instead of `-$150.00`. Absent = `"$"` (every pre-#1012 row; no backfill).

The percentage itself is **never stored** — `discountCellText`
(`gearflow-table.ts`) / `discountEntryValue` recompute it from the stored dollar
amount against the row's own gross. Storing the typed `15` would let a document
contradict itself once the unit price changed (the dollar amount is frozen at
save). Don't "fix" that by adding a `discountValue` column.

`discountMode` must never outlive the amount it describes: every write path that
clears/zeroes `discount` clears the mode too (patchNative, patchManyNative,
updateGroupPriceNative, and each lifecycle-lock `defaultToZero` branch). The
mode union + both conversions live in `src/lib/discount-mode.ts` — a plain
module, so Convex mutations, Zod schemas, the seven add/edit forms and the PDF
renderer share one definition. `line-item-form-fields.tsx` re-exports them for
the forms; don't re-declare `"$" | "%"` anywhere else.

### ⚠️ Quote status is DERIVED — never branch on the stored column
A quote's `status` column is not the whole answer. `EXPIRED` is computed on read
(`validUntil < now && status === "SENT"`) and never stored, and the deprecated
`PUBLISHED` still appears on any row the #986 backfill hasn't reached. Always go
through `effectiveQuoteStatus()` / the `effectiveStatus` field the `convex/quotes.ts`
queries return (`convex/lib/quoteState.ts`) — a `q.status === "SENT"` test silently
treats expired quotes as live and pre-#986 rows as neither. Same reason `quotes` reads
go through `listProjectQuotes`/`requireQuoteInOrg`: `by_projectId` is global, so the
org check has to happen in the loader, not at the call site.

`projects.revision` is the one version counter (project v2 == quote v2 == the snapshot
taken at v2). It is server-owned — written only by `createNative` and
`quotesWrites.newVersionNative`, and stripped from client patches the same way
`PROJECT_MONEY_ANCHORS` are. See FEATUREDOCS/66.

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
FEATUREDOCS/69). Adding a tab means adding it to `VALID_TABS` in
`src/app/(app)/projects/[id]/page.tsx`, or a `?tab=` deep link to it silently
falls back to Overview. `Tabs` is controlled (`value`/`onValueChange`, not
`defaultValue`) because the Overview readiness checklist navigates you to the
tab that fixes a failing check — don't revert it to uncontrolled.

Overview owns the project's **at-a-glance** state: the readiness checklist, the
current quote + invoicing cards, the money strip, and the context rail
(Schedule/Location/Team/Activity) that used to be a page-wide sidebar. Every
other tab is **full width** — don't re-add a `DetailLayout`/`DetailSidebar`
wrapper around the tab set. The lifecycle stepper and lock strip stay ABOVE the
tabs: they change what you can do in every tab, so they're page-level context.

A readiness check that can't run reports `unknown`, never a pass — a dateless
project's gear check says "not checked" rather than a false all-clear, and
`unknown` never counts toward "all clear".

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

### Design System
Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, component patterns, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md.

### PDF generation — one pipeline, data-shape changes still need cross-cutting audits
**#790 redesign (2026-07-26):** ripped out the PDF customization engine (dual
render pipelines, stored per-org templates, section/block model, `{token}`
resolution, visibility conditions, brand templates, Convex `documentTemplates`/
`brandTemplates`/`sectionPresets`) — ~8,300 LOC deleted. There is now **one**
pipeline for the 5 project doc types: `document-layouts.ts` (fixed layout per
doc type, plain TS, no persistence) → `document-composer.ts` (net-new,
purpose-built pagination engine, a few hundred LOC) → `pdf-render.ts`. No
template designer of any kind exists or is planned. See
`docs/designs/pdf-system-redesign.md` and FEATUREDOCS/13 for the full
architecture. This also fixed a live truncation bug: the legacy fallback
builders were single-page only, so any default document longer than one page
silently dropped its tail — the new composer paginates every doc type by
default.

The PDF pipeline still has **independent consumers** of the `DocumentLineItem`
shape (down from 5 across 2 files pre-redesign to 3 across 2 files). Any
change to the shape (new field, new synthetic row type, new relationship
between parent and children) must be verified against ALL of them — fixing
one and shipping leaves silent bugs in the others:

1. **`gearflow-table.ts` rendering** — what gets drawn (bold, indented, etc.)
2. **`document-composer.ts`'s `calculateItemHeight`** — pagination space reservation (miss this → silent tail-drop)
3. **`document-composer.ts`'s `getFilteredParentItems`** — top-level status filter (miss this → items disappear from docket / return-sheet). `gearflow-table.ts`'s own top-level filter mirrors this and must stay in sync (documented cross-reference in both files).

A new **`LayoutBlock` kind** (`draftWatermark` was the first, #987) is a smaller but
equally silent audit: `estimateBlockHeight` must reserve its height (miss it → it draws
over the block below, or the tail drops) and `buildEntryFields` must emit its schema
(miss it → nothing renders). Both are exhaustive switches, so a missing arm fails the
build — keep the union closed. A block that belongs on EVERY page is page furniture
(`isPageFurniture`/`measurePageFurniture`), not a body block.

**Synthetic rows (e.g. `isGroupRow: true`) are footguns.** Their hard-coded fields (`status: "CONFIRMED"`, etc.) silently fail any filter that compares against them. Every status/filter site must special-case the synthetic row type, or compute the field dynamically from children.

**Parent/child kinds.** A line is a child when `isKitChild: true` (covers kit members, sub-hire group children, AND accessory children) — that flag is the structural "is a child" test the ~40 `isKitChild: false` DB filters depend on. `childKind` (`KIT | ACCESSORY`) is the *behaviour* discriminator. An **accessory parent** is NOT a kit (no `kitId`); detect it as "top-level line, no `kitId`, has `ACCESSORY` children" and treat it like a kit parent for child rendering (gearflow-table) AND height reservation (document-composer) — kit children, Project Group members, and accessories are all gated by the single `showKitChildren` flag (2026-07-27). Warehouse docs (packing-list/return-sheet/delivery-docket) leave it `true`, so accessories still always render there (inseparable, packers need every component); client-facing docs (quote/invoice) set it `false` (`clientFacingTable` in `document-layouts.ts`) so the client sees top-level line items only, not exploded kit/accessory sub-rows. See [FEATUREDOCS/48](./FEATUREDOCS/48-child-assets-accessories.md).

**Test coverage rule:** unit tests at the plugin layer alone are NOT enough. For any data-shape change, write at least one integration test that exercises the full pipeline (structureLineItems → calculateItemHeight → filter → plugin render) against a realistic fixture. The plugin-only harness in `src/lib/pdfme/plugins/test-utils.ts` is great for rendering assertions but misses the pipeline bugs. `document-composer.test.ts` is the standing regression harness — a 120+ item fixture per doc type asserting full parent-item index coverage across pages.

History: v0.8.1.0 added group-as-kit rendering. v0.8.1.1 fixed the height-calc miss (tail items dropped). v0.8.1.2 fixed the status-filter miss (groups invisible on dockets). Each was a separate user-impacting deploy that an upfront cross-cutting audit would have caught — the #790 redesign collapsed the dual-pipeline root cause of these into one.

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
