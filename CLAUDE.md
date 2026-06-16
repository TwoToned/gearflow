# CLAUDE.md

## Documentation Structure

- **`ARCHITECTURE.md`** — High-level overview with links to all feature docs
- **`FEATUREDOCS/`** — Individual markdown files for each feature/system
- **`PROMPT.md`** — Full product spec
- **`docs/ROADMAP.md`** — Prioritised roadmap: phases, sequencing, effort
- **`docs/designs/`** — Per-initiative design docs (one per major feature/program)

**When making changes**: Read the relevant `FEATUREDOCS/` file(s) for the feature you're touching. Update them after. Don't read everything — just what's relevant. The [Integration Checklist](./FEATUREDOCS/29-integration-checklist.md) tells you what to wire up for new features.

## Branching

All new features and non-trivial changes must go on a dedicated branch. Never commit feature work directly to `main`.

## Commits

Make atomic commits — one logical change per commit. The more commits the merrier. Prefer many small, focused commits over fewer large ones. Each commit should be independently understandable and revertable.

## Feature Documentation

Every feature change **must** update the relevant `FEATUREDOCS/` file. If the feature doesn't have one yet, create a new numbered markdown file (e.g. `FEATUREDOCS/30-my-feature.md`) and add it to the table in `ARCHITECTURE.md`.

## Commands

```bash
npm run dev          # Dev server (Turbopack, Next.js 16 default)
npm run build        # Production build + type check
npm start            # Start production server
npm run lint         # ESLint
npm test             # Run all unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npx prisma generate  # Regenerate Prisma client (after schema changes)
npx prisma migrate dev --name <name>  # Create + apply migration
```

### Worktree Setup

Git worktrees don't share `node_modules/` or `.env` with the main repo. Run this to bootstrap a new worktree:

```bash
# Copy .env from main repo (adjust path if needed)
cp /Users/jayden/code/ttp-assetmanagement/.env .

# Install dependencies
npm install --legacy-peer-deps

# Generate Prisma client
npx prisma generate
```

After this, `npm run dev`, `npm test`, and `npm run build` will all work.

### Convex Dev in Worktrees

**Always use `pnpm exec convex` — never `npx convex`.** `npx convex` runs a global
CLI copy that can't resolve `convex/server` from local `node_modules`, causing an
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
`npm run dev`. The preview deployment name must not contain `/` — for worktree branches
like `feature/my-thing`, the branch name works fine as-is (Convex URL-encodes it).

`CONVEX_DEPLOY_KEY` must be set in `.env` or `.env.local` pointing to your Convex
Cloud project deploy key.

### DB Setup (first time)
```bash
# Ensure DATABASE_URL is set in .env, then:
npx prisma migrate dev   # Apply all migrations + generate client
```

## Environment Variables

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — Auth signing secret
- `BETTER_AUTH_URL` — App base URL (used for auth callbacks)
- `NEXT_PUBLIC_APP_URL` — Public app URL (e.g. `http://localhost:3000`)

**Email (Resend):**
- `RESEND_API_KEY` — Resend API key (dev logs to console if unset)
- `EMAIL_FROM` — Sender address (default: `GearFlow <noreply@gearflow.app>`)

**File Storage (S3):**
- `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET` (default: `gearflow-uploads`)
- `S3_ENDPOINT` — Custom endpoint (optional, for S3-compatible providers)

**Google Maps:**
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — API key with Maps JavaScript API + Places API (New) enabled

**Other:**
- `PASSKEY_RP_ID` — WebAuthn relying party ID (default: `localhost`)
- `PLATFORM_NAME` — Display name (default: `GearFlow`)
- `ADMIN_REGISTRATION_TOKEN` — Secret token for `/register/admin?token=...`

**DB connection hardening (optional, safe defaults):** layered onto the runtime
`DATABASE_URL` in `src/lib/db-url.ts` (NOT onto `prisma migrate`, so backfills
aren't killed). Anything you put in the URL itself wins.
- `DB_STATEMENT_TIMEOUT_MS` — per-query server-side cap (default `30000`). The key
  stability guard: stops one slow query from holding a pooled connection and
  stalling the whole app. `0` disables (not advised).
- `DB_POOL_TIMEOUT_S` — wait for a free pooled connection before erroring (default `10`).
- `DB_CONNECTION_LIMIT` — max pooled connections (default: Prisma's `cpus * 2 + 1`).

## Critical Conventions

### shadcn/ui v4 — `render` prop, NOT `asChild`
```tsx
<DialogTrigger render={<Button />}>Open</DialogTrigger>
<DropdownMenuTrigger render={<Button />}>Menu</DropdownMenuTrigger>
<SidebarMenuButton render={<Link href="/foo" />}>Link</SidebarMenuButton>
```

### Prisma v6
- Import from `@/generated/prisma/client` (NOT `@/generated/prisma`)
- After schema changes: `npx prisma migrate dev` → `npx prisma generate` → restart dev
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

### DOM Safety (removeChild Fix)
- `DomPatch` (in root layout) monkey-patches `removeChild`/`insertBefore` to silently ignore calls where the target node is not a child — prevents the React 19 "Cannot read properties of null" TypeError
- `GlobalErrorBoundary` (in root layout) catches any remaining DOM manipulation errors and auto-recovers
- `OverlayLockReset` (in root layout) self-heals the "whole page becomes unclickable until refresh" bug: Base UI/Floating UI marks the rest of the page inert (`data-base-ui-inert` + `inert`/`aria-hidden`/`pointer-events:none` + a full-screen `[role="presentation"]` backdrop) while a modal overlay is open; React 19 sometimes orphans those locks when the overlay unmounts during navigation. A guarded watchdog clears orphaned locks **only when no overlay is open** (`src/components/overlay-lock-reset.tsx`, tested in `overlay-lock-reset.test.ts`)
- **When adding new providers or scripts to the root layout**: place them inside `<GlobalErrorBoundary>` to ensure coverage
- **Never remove** `DomPatch`, `GlobalErrorBoundary`, or `OverlayLockReset` from `layout.tsx` — they are critical for navigation stability
- **New dropdown/menu UI is Base UI (shadcn v4):** `DropdownMenuItem` fires `onClick` (NOT Radix's `onSelect`), and `DropdownMenuLabel` must be wrapped in `<DropdownMenuGroup>` (it's a `GroupLabel` and throws otherwise). Test menus by actually OPENING them, not just rendering the closed trigger.

### Select — ALWAYS pass explicit label children to `SelectValue`
`SelectValue` in shadcn/ui v4 **cannot** resolve labels from portal-rendered `SelectItem` children. Without explicit children, it shows the raw `value` (e.g. an ID or enum key) instead of the human-readable label. **Every `<SelectValue>` must have explicit children**:
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

### PDF generation — data-shape changes need cross-cutting audits
The PDF pipeline has **five independent consumers** of the `DocumentLineItem` shape. Any change to the shape (new field, new synthetic row type, new relationship between parent and children) must be verified against ALL of them — fixing one and shipping leaves silent bugs in the others:

1. **`gearflow-table.ts` rendering** — what gets drawn (bold, indented, etc.)
2. **`section-renderer.ts` `calculateItemHeight`** — pagination space reservation (miss this → silent tail-drop)
3. **`section-renderer.ts` `getFilteredParentItems`** — top-level status filter (miss this → items disappear from docket / return-sheet)
4. **`gearflow-table.ts` top-level filter** — plugin-level status filter (mirrors #3, must stay in sync)
5. **`gearflow-table.ts` `buildDeliveryDocketGroups`** + plugin docket bucketing — custom kit-promotion logic

**Synthetic rows (e.g. `isGroupRow: true`) are footguns.** Their hard-coded fields (`status: "CONFIRMED"`, etc.) silently fail any filter that compares against them. Every status/filter site must special-case the synthetic row type, or compute the field dynamically from children.

**Parent/child kinds.** A line is a child when `isKitChild: true` (covers kit members, sub-hire group children, AND accessory children) — that flag is the structural "is a child" test the ~40 `isKitChild: false` DB filters depend on. `childKind` (`KIT | ACCESSORY`) is the *behaviour* discriminator. An **accessory parent** is NOT a kit (no `kitId`); detect it as "top-level line, no `kitId`, has `ACCESSORY` children" and treat it like a kit parent for child rendering (gearflow-table) AND height reservation (section-renderer) — accessories always render (inseparable, not gated by `showKitChildren`). See [FEATUREDOCS/48](./FEATUREDOCS/48-child-assets-accessories.md).

**Test coverage rule:** unit tests at the plugin layer alone are NOT enough. For any data-shape change, write at least one integration test that exercises the full pipeline (structureLineItems → calculateItemHeight → filter → plugin render) against a realistic fixture. The plugin-only harness in `src/lib/pdfme/plugins/test-utils.ts` is great for rendering assertions but misses the pipeline bugs.

History: v0.8.1.0 added group-as-kit rendering. v0.8.1.1 fixed the height-calc miss (tail items dropped). v0.8.1.2 fixed the status-filter miss (groups invisible on dockets). Each was a separate user-impacting deploy that an upfront cross-cutting audit would have caught.

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
- `@react-pdf/renderer` — Helvetica only, no Unicode symbols
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

## Deploy Configuration (configured by /setup-deploy)

- **Platform:** Self-hosted (GitHub Actions on a self-hosted runner)
- **Production URL:** https://home.twotoned.com.au
- **Deploy workflow:** `.github/workflows/main.yml` ("Deploy GearFlow") — triggers on push to `main`
- **Deploy status command:** poll the GitHub Actions run via `gh run list --workflow main.yml --branch main --limit 1 --json status,conclusion,headSha`
- **Merge method:** merge commit (matches existing git history; not squash)
- **Project type:** Next.js 16 web app with PostgreSQL + Prisma
- **Post-deploy health check:** `curl -s https://home.twotoned.com.au -o /dev/null -w "%{http_code}"` — expect 200 or 307 (root redirects to login). 502 on first hit can be a cold-start; retry after 5s before treating as a failure.

### Deploy pipeline (self-hosted, sequential)
1. `git pull origin main` in `$APP_DIR`
2. `npm ci --ignore-scripts --legacy-peer-deps`
3. `npx prisma generate`
4. `npm test` (full vitest suite runs again on the runner)
5. `npx prisma migrate deploy`
6. `npm run build`
7. `pm2 restart gearflow` then `pm2 startOrReload ecosystem.config.js --only gearflow-discord-bot` + `pm2 save` (the Discord bot runs as its own pm2 process — see `docs/operations/discord-bot.md`)

15-minute total timeout. Typical green run is ~5-8 minutes; longer means a migration or build hiccup. A failed `pm2 restart` leaves the previous build serving — rolling back means reverting the merge commit and letting the workflow redeploy.

### Custom deploy hooks
- **Pre-merge:** none (CI handles lint + typecheck + tests on the PR)
- **Deploy trigger:** automatic on push to `main` (no manual step)
- **Deploy status:** `gh run watch <run-id>` or poll `gh run view --json status,conclusion`
- **Health check:** GET `https://home.twotoned.com.au` returns 200 or 307 (root redirects to `/login`). Retry once after 5s if you get 502 — the runner can be cold-starting from the pm2 restart.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## PR Preview Deployments (Coolify)

Each PR automatically gets a preview deployment via `.github/workflows/preview-deploy.yml`.
Cleanup runs on PR close via `.github/workflows/preview-cleanup.yml`.

**What gets deployed per PR:**
- Coolify app at `https://pr-<number>.preview.lab.rvlt.app`
- Convex functions deployed to the **shared dev deployment** (not isolated per PR)
- Shared dev Postgres (Prisma migrations applied by the workflow before triggering Coolify)

**Auth bridge — "lying about the domain":**
All PR preview apps set `BETTER_AUTH_URL=https://preview.lab.rvlt.app` regardless of their
actual URL. The shared Convex dev deployment trusts that fixed issuer. Session cookies still
scope to the real PR domain (Better Auth uses the request host, not `BETTER_AUTH_URL`). OAuth
and passkeys don't work in previews — that's fine.

**One-time Convex dev deployment setup** (set these in the Convex dashboard for the dev deployment):
```
CONVEX_AUTH_ISSUER   = https://preview.lab.rvlt.app
CONVEX_AUTH_JWKS_URL = https://preview.lab.rvlt.app/api/auth/jwks
```

**One-time Coolify setup:**
1. Always-on app at `preview.lab.rvlt.app` (main branch) — serves `/api/auth/jwks` as the JWKS host.
   Must use the same `BETTER_AUTH_SECRET` as all PR previews (`PREVIEW_BETTER_AUTH_SECRET`).
2. Create a "Previews" project in Coolify and note its UUID
3. Connect GitHub repo as a source in Coolify (Sources → GitHub App or PAT)
4. Wildcard DNS: `*.preview.lab.rvlt.app` → Coolify server IP
5. Wildcard SSL cert in Coolify for `*.preview.lab.rvlt.app`
6. Adjust the API endpoint in `preview-deploy.yml` (`private-github-app`, `private-github-token`,
   or `public`) to match how your GitHub source is configured in Coolify

**GitHub secrets required:**
- `CONVEX_DEPLOY_KEY` — already set (same key used in main.yml)
- `COOLIFY_TOKEN` — Coolify API bearer token (Coolify → Settings → API Keys)
- `PREVIEW_DATABASE_URL` — Shared dev Postgres connection string (used by GitHub Actions for migrations)
- `PREVIEW_DATABASE_URL_INTERNAL` — Same DB, internal Coolify network URL (used by the running app)
- `PREVIEW_BETTER_AUTH_SECRET` — Must match the always-on `preview.lab.rvlt.app` app

**GitHub variables required (Settings → Variables → Repository):**
- `COOLIFY_BASE_URL` — Coolify instance URL, e.g. `https://coolify.yourserver.com`
- `COOLIFY_SERVER_UUID` — Server UUID from Coolify
- `COOLIFY_PROJECT_UUID` — UUID of the "Previews" project in Coolify
- `CONVEX_DEV_URL` — Shared dev Convex URL, e.g. `https://groovy-koala-475.convex.cloud`
