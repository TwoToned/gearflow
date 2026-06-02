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

**OAuth (optional, enabled when set):**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`

**Google Maps:**
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — API key with Maps JavaScript API + Places API (New) enabled

**Other:**
- `PASSKEY_RP_ID` — WebAuthn relying party ID (default: `localhost`)
- `PLATFORM_NAME` — Display name (default: `GearFlow`)
- `ADMIN_REGISTRATION_TOKEN` — Secret token for `/register/admin?token=...`

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
- **When adding new providers or scripts to the root layout**: place them inside `<GlobalErrorBoundary>` to ensure coverage
- **Never remove** `DomPatch` or `GlobalErrorBoundary` from `layout.tsx` — they are critical for navigation stability

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
7. `pm2 restart gearflow`

15-minute total timeout. Typical green run is ~5-8 minutes; longer means a migration or build hiccup. A failed `pm2 restart` leaves the previous build serving — rolling back means reverting the merge commit and letting the workflow redeploy.

### Custom deploy hooks
- **Pre-merge:** none (CI handles lint + typecheck + tests on the PR)
- **Deploy trigger:** automatic on push to `main` (no manual step)
- **Deploy status:** `gh run watch <run-id>` or poll `gh run view --json status,conclusion`
- **Health check:** GET `https://home.twotoned.com.au` returns 200 or 307 (root redirects to `/login`). Retry once after 5s if you get 502 — the runner can be cold-starting from the pm2 restart.
