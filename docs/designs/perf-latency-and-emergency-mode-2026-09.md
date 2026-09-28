# Latency, MCP keepalive cost & Emergency Mode — plan (2026-09)

> _Owner: Jayden Nawotka · Status: PROPOSED 2026-09-28 · Source data:
> [`docs/audits/2026-09-28-posthog-usage-performance-report.md`](../audits/2026-09-28-posthog-usage-performance-report.md)_

## Context that changes the diagnosis

Two facts supplied after the PostHog report reframe its two biggest findings:

1. **The app runs on a DigitalOcean VM in Sydney.** Users are in Sydney. So the
   ~670–700 ms floor under every captured Convex call is not "user distance"; it is the
   **Sydney ↔ Convex Cloud (US) round trip**, paid once per Convex call by the app server
   and again by every browser tab's `ConvexReactClient`. A page that awaits three Convex
   reads in sequence pays ~2 s before it can paint. That is the LCP problem.
2. **The 24/7 poller is the claude.ai MCP connector** for RVLT Flow. Its keepalive hits
   `/api/v1/mcp` every 4–5 minutes; the connector cadence is not ours to change. What IS
   ours: each keepalive currently costs **3 Convex round trips + 2 Postgres queries**
   before the MCP transport even sees the request (`getApiKeyActorContext` in
   `src/lib/api-key.ts`: `apiKeys:getByTokenHash` → `prisma.organization` +
   `prisma.user` + `orgSettings:getByOrg` → `apiKeys:touchLastUsed`). For `initialize`,
   `ping` and `tools/list` nothing after that touches Convex at all (the tool manifest is
   generated, `src/lib/api/mcp-manifest.generated.ts`). ~12k `getByTokenHash` calls a
   month and 48% of them over 1 s is the price of a protocol heartbeat.

Everything below is sized for a two-person internal tool. The bar is "the one person who
lives in it stops waiting", not a Core Web Vitals trophy.

## Workstreams

| WS | What | Size | Expected effect |
|---|---|---|---|
| **1** | MCP keepalive: cache the key → actor resolution, debounce `touchLastUsed` | S (1 PR) | `apiKeys:getByTokenHash` volume ÷ ~10; the T-P6 alert's dominant input gone |
| **2** | App-side latency on Convex Cloud: batch the sequential read chains, verify JWKS is edge-cached, find the `projects:getById` doubling | M (2–4 PRs) | LCP on `/dashboard`, `/projects/:id` down by the number of sequential Convex hops removed × ~600 ms |
| **3** | Self-hosted Convex in Sydney: spike → measure → go/no-go → migrate | Spike S, migration L | Floor drops from ~600 ms to ~5–20 ms per call, for the app AND the browser |
| **4** | Emergency mode: keep working with a banner when Convex is slow or down | M (3–4 PRs) | A job day survives a backend outage |
| **5** | Hygiene from the report (CLS bug, expired exception, Better Auth schema gate) | S | Alerts mean something again |

Order: **1 → 5 → 2 (batching only) → 3 spike → decide → then 4 or 3 migration**, whichever
the go/no-go says. WS4 does not depend on WS3, but its snapshot design changes shape if
Convex is on the same VM (see §4.6), so decide WS3 first.

---

## WS1 — MCP keepalive cost

### Design

`getApiKeyActorContext(rawToken)` gains an in-process **stale-while-revalidate cache**
keyed by `tokenHash`:

- Hit and fresh (< 60 s): return cached `ActorContext`, zero I/O.
- Hit and stale (60 s – 10 min): return cached, kick off a background revalidation.
- Miss or > 10 min: current path (one full resolution), then populate.
- Any failed revalidation **evicts** (fail closed on the next call).

`touchLastUsed` becomes a per-key debounce: at most one mutation per key per 5 minutes
(`lastUsedAt` is observability, its granularity does not matter).

### Why this is safe

Credential validity is re-checked **inside Convex on every guarded call**:
`requireAgentScope` re-reads the `apiKeys` row in the transaction
(`src/lib/api/agent-auth.ts` docblock). The cache therefore only extends the window in
which a revoked key can still get a `tools/list` or `ping` answered — never a data read
or write. The org kill switch (`orgSettings.apiKillSwitchAt`) is the one thing checked
only here; a 10-minute revocation lag on protocol-level calls is acceptable and gets
written into FEATUREDOCS/56 as a documented property. If it isn't, cap the stale window
at 60 s and accept one Convex hit per keepalive (still 1 instead of 3).

### Not in scope

Changing what the connector does, sessionful MCP transport, moving auth off Convex.

### Files

`src/lib/api-key.ts` (cache + debounce, ~60 lines), `src/lib/api-key.test.ts`
(fresh/stale/miss/evict-on-error/kill-switch-lag cases), `FEATUREDOCS/56-api-mcp.md`
(document the lag), `docs/budgets.md` T-P6 row (note the keepalive is no longer in the
p95 population).

### Exit

`apiKeys:getByTokenHash` daily count under ~50 (from 300–700) with the connector still
attached. T-P6 p95 re-read a week later.

---

## WS2 — App-side latency while on Convex Cloud

These pay off regardless of WS3, and are the only lever if WS3 is a no-go.

### 2.1 Find the `projects:getById` step change (investigate first, 1–2 h)

Volume went from ~100–380/day to 450–765/day on 2026-09-20 with fewer users. Read the
Convex dashboard's function callers for `projects:getById` and diff the 09-19/09-20 merge
batch (PRs #1269–#1280) for new server actions or `useServerQuery` hooks that fetch
project detail per render or per row. A per-row fetch in a list is the usual shape.
Fix is whatever that is; probably one file.

### 2.2 Batch the sequential read chains on the three pages that matter

`/dashboard` (LCP p75 5.0 s), `/projects/:id` (3.9 s), `/projects` (3.0 s). For each:

1. Trace the server-action chain (`src/server/*.ts`) and count **sequential** awaits on
   `getConvexClient()` calls. Each one is ~600 ms on the wire today.
2. Collapse to **one Convex query per page load** that returns everything the first
   paint needs (a `dashboard.bundle` / `projectDetail.bundle` query — the codebase already
   has the pattern in `overbooking:bundle` and `warehouseReturns.bundle`). Parallel
   `Promise.all` is second best (one RTT instead of N) where a bundle is awkward.
3. Keep the browser's reactive subscriptions for *updates*, but stop making the first
   paint wait on them — render the server bundle, let subscriptions hydrate behind it.

Measure with the existing Convex-dashboard method in
`docs/designs/perf-convex-measurement-baseline.md` (F3, F4 flows) plus the PostHog
`web_vital` LCP per route. Target: no page waits on more than **two** sequential Convex
round trips before its largest element paints.

### 2.3 Confirm the JWKS path is not adding a hop

Convex verifies every token against `https://flow.rvlt.app/api/auth/jwks`. The route is
memoised in-process (`src/lib/jwks-route-cache.ts`) and served with `Cache-Control`, but
the runbook notes Cloudflare does not edge-cache extensionless JSON by default. Add the
Cache Rule (honour `s-maxage=300`) and verify with a `curl -I` from a US host that the
response carries `cf-cache-status: HIT`. If Convex Cloud's own JWKS cache is already
absorbing this (likely — check the Convex dashboard's function-latency histogram: a
JWKS fetch shows as a bimodal p50), this is a five-minute no-op; do it anyway.

### 2.4 `SsoProvider.findMany` (slow_query alert)

57% of slow Prisma queries, p95 1.2 s, only query over the T-9 incident line. #803 cached
`getOrgLoginInfo` for 60 s, but `ssoProvider.findMany` is also issued from
`src/lib/auth.ts:95` (inside the Better Auth config, i.e. on the auth hot path),
`src/app/api/auth/sso/org-lookup/route.ts:30` and `src/server/sso.ts:90/457`. The
`auth.ts` one is the volume; give it the same 60 s cache. Small.

### Exit

`/dashboard` and `/projects/:id` LCP p75 under 2.5 s on Convex Cloud, measured over a
week of the primary user's traffic. If that's achieved, WS3 becomes optional; if the
residual is still the per-call floor, WS3 is the answer.

---

## WS3 — Self-hosted Convex in Sydney

### Why it's plausible here

The repo already runs the official self-hosted image
(`ghcr.io/get-convex/convex-backend`, `docker-compose.convex.yml`) for the E2E harness
and the backup-restore rehearsal, and the app reads `CONVEX_SELF_HOSTED_URL` /
`CONVEX_SELF_HOSTED_ADMIN_KEY` from `src/env.ts` already. The auth bridge
(`convex/auth.config.ts`) is a JWKS URL, which works identically. So the *code* change is
near zero; the work is ops.

### 3.1 Spike (1 day, no production impact) — this IS the comparison

1. Create a **separate** small droplet in SYD1 (or a second container on the existing VM
   via Coolify) running `convex-backend` with Postgres as its storage backend (the
   self-hosted image supports SQLite / Postgres / MySQL; Postgres reuses what the VM
   already runs) and DO Spaces (S3-compatible) for file storage, because
   `convex/files.ts` uses `_storage` for every uploaded file and PDF artifact.
2. `convex export` from prod cloud (the 03:00 UTC backup already does this,
   `.github/workflows/convex-backup.yml`) → `convex import` into the spike. The
   restore runbook (`docs/convex-backup-restore-runbook.md`) has done exactly this.
3. Push functions: `CONVEX_SELF_HOSTED_URL=… CONVEX_SELF_HOSTED_ADMIN_KEY=… pnpm exec
   convex deploy`. Set the deployment env vars (`CONVEX_AUTH_ISSUER`,
   `CONVEX_AUTH_JWKS_URL`, `POSTHOG_KEY`, `ENABLE_*_CRON` **off**).
4. Build the app once with `NEXT_PUBLIC_CONVEX_URL` pointing at the spike, run it on a
   second port, and drive the F1–F6 flows from `perf-convex-measurement-baseline.md`
   with a browser in Sydney. Record per-call latency from `convex_op_latency`'s log line
   (it prints every op over 300 ms; if nothing prints, that's the result) and the
   page LCPs.

**Go/no-go table** (fill from the spike):

| Measure | Cloud (today) | Self-hosted SYD (spike) | Go if |
|---|---:|---:|---|
| Convex query p50 from app server | ~690 ms | | < 50 ms |
| `/dashboard` LCP p75 | 5.0 s | | < 2 s without WS2 batching |
| `/projects/:id` LCP p75 | 3.9 s | | < 2 s |
| Browser subscription update latency (edit → other tab) | ~500 ms | | < 100 ms |
| Ops cost added | 0 | droplet $ + backups + upgrades | acceptable to owner |

### 3.2 What you take on if it's a go

- **Availability:** one VM (or two, if a sibling droplet) instead of Convex Cloud's
  managed HA. For two internal users on one site this is the same blast radius the app
  server already has; WS4 is the mitigation.
- **Backups:** the daily `convex export` workflow needs an admin key + URL instead of a
  deploy key, and the Postgres volume under Convex needs the same DO snapshot policy as
  the app's Postgres. Restore rehearsal already documented.
- **Upgrades:** pin the image digest (already the convention in the compose file), bump
  deliberately, `convex deploy` after. No auto-update.
- **Dashboard:** the self-hosted dashboard image, behind Coolify's auth, replaces
  `dashboard.convex.dev` for function metrics — the runbook's "primary observability"
  source moves with it.
- **Deploy pipeline:** `build-image.yml` step 2 (`convex deploy -y` with the prod key)
  becomes `convex deploy` with the self-hosted URL + admin key from secrets; `CLAUDE.md`'s
  preview-deployment section stays cloud (previews are fine in the US).

### 3.3 Cutover (if go) — one evening, reversible

1. Freeze writes with the existing kill switch (`scripts/toggle-write-killswitch.ts on
   "convex migration"`).
2. Final `convex export` → `convex import` into the Sydney deployment.
3. Flip `NEXT_PUBLIC_CONVEX_URL` in Coolify + rebuild; flip `CONVEX_SELF_HOSTED_URL`;
   deploy functions; enable crons on the new deployment; **disable** crons on cloud.
4. Smoke the F1–F6 flows, lift the kill switch.
5. Keep the cloud deployment untouched (read-only, crons off) for 14 days as the
   rollback: reverting is steps 3–4 in reverse plus an export/import of the delta.

### Decision rule

Run the spike **after** WS1 and WS2.1/2.2 have shipped and been measured for a week. If
WS2 alone gets the two pages under 2.5 s, self-hosting is a "nice to have" and can wait
for a quieter month. If the residual floor is still the dominant term, self-host.

---

## WS4 — Emergency mode ("keep working as much as possible, with a banner")

### 4.1 What it is

A **degraded operating mode** the app enters when the backend is slow or unreachable, or
when an operator flips it manually. In it:

- A persistent banner at the top of every page says what's wrong, since when, and what's
  disabled ("Flow is in emergency mode — the backend has been unreachable since 14:32.
  You can view today's jobs, pick lists and dockets. Changes are disabled.").
- Everything that can still work, does. Everything that can't fails **fast and
  clearly** instead of spinning.
- The surfaces a job day actually needs (what's on, what to pick, who's on it, where it
  goes, the docket to hand over) are served from a **local snapshot** on the VM, and the
  PWA keeps the last snapshot on the phone.

It is not: an offline-first rewrite, a write queue, or a second backend.

### 4.2 Two signals, one state

| Signal | Source | Survives Convex outage? |
|---|---|---|
| **Auto** | In-process circuit breaker around `getConvexClient()`: opens after 5 consecutive calls that time out (> 5 s) or fail with a transport error within 60 s; half-opens after 30 s; closes on 3 successes. Exposed at `GET /api/health` (`{ convex: "ok" \| "degraded" \| "down", since }`), unauthenticated, `Cache-Control: no-store`. | Yes — it's process memory. |
| **Manual** | `emergencyMode` flag stored in **Postgres** (a `siteSettings`-style row or a new tiny `platformFlags` table via Prisma), NOT in Convex — the store must be reachable when Convex isn't. Flipped by `scripts/toggle-emergency-mode.ts on "<reason>"` and a button on `/admin` (site-admin only, `src/app/(admin)/admin/page.tsx`). | Yes — Postgres is a separate service. |

The app is "in emergency mode" if **either** is set. `/api/health` returns the union so the
browser has one thing to poll. The breaker's state also goes to PostHog as a server
event (`emergency_mode_entered` / `_exited`) and one email via Resend to the owner — the
alert slot cap doesn't apply to an email.

### 4.3 The banner (client)

`<SystemStatusBanner>` mounted in `src/app/(app)/layout.tsx` above `<TopBar />`:

- Polls `/api/health` every 15 s (only while the tab is visible), and also watches the
  browser `ConvexReactClient` connection state so a **browser-side** Convex outage (the
  server can still reach Convex but the WebSocket from the phone can't) shows the same
  banner.
- Shows reason, start time, "what still works" list, a link to `/emergency` (§4.5), and
  a "Retry" that re-polls.
- Uses the existing design tokens; warn colour, not the brand red; not dismissible while
  the condition holds.

### 4.4 Fail fast, not spin

Today a Convex outage makes server actions throw the generic `InternalServerError` page
and makes `useQuery` hooks sit on `undefined` forever. In emergency mode:

- `getConvexClient()` wraps every call with a **hard 8 s timeout** (there is a 300 s
  outlier in the data — that's a hung page) and, while the breaker is open, **rejects
  immediately** with a typed `BackendUnavailableError` instead of trying.
- `GlobalErrorBoundary` (`src/app/layout.tsx`) recognises that error type and renders an
  inline "This needs the backend, which is unavailable — see today's jobs instead" card
  with a link to `/emergency`, not the generic crash screen.
- Mutations are blocked at the UI with the same card (client checks the health state
  before calling; server rejects with the same typed error as the backstop).
- Non-essential background work is skipped while the mode is on: Mira, follow-up
  reconciliation, webhook delivery, the API/MCP surface (returns 503 with
  `Retry-After: 60`), PostHog vitals capture. Convex crons can't be gated from the app
  during an outage and don't need to be — they just fail on their own schedule.

### 4.5 The snapshot: `/emergency`

A server-side job writes `/data/emergency/snapshot.json` **every 15 minutes** and on
demand (`scripts/build-emergency-snapshot.ts`, also callable from `/admin`):

- Projects with a date window touching **today −1 to +7 days** and status
  `CONFIRMED`…`CHECKED_OUT`: name, client + primary contact phone/email, venue address,
  load-in/out times, status, project manager.
- Their line items (structured through `structureLineItems`, expand mode, so kits and
  accessories are listed the way a packer needs them), prep status, assigned asset tags.
- Crew assignments for the window: name, role, phone, call time, status.
- Warehouse state: what's currently `CHECKED_OUT` and on which job.
- Org branding (for the PDFs) and the org's default location.

Alongside it, pre-rendered **PDFs** for each project in the window, using the existing
react-pdf pipeline (`src/lib/react-pdf/`): packing list, delivery docket, return sheet,
call sheet. These are warehouse artifacts, not finance documents, so the "stored bytes,
never re-render" rule for quotes/invoices does not apply; they are simply written to
`/data/emergency/pdf/<projectId>-<type>.pdf` and overwritten each run. No quote or
invoice is ever produced here.

`/emergency` (inside the authenticated app shell, so the login still gates it — Better
Auth is Postgres, it keeps working) renders **from the snapshot only**: a runsheet for
today/tomorrow, per-job pick list, crew list with phone numbers, and download links for
the PDFs. It never calls Convex, so it renders in the time it takes to read one file.
`/api/health` and `/emergency` are excluded from anything that would block on Convex
(middleware, `getOrgContext` fallbacks).

The snapshot is **org-scoped**: the job reads every org's window and writes one file per
org; `/emergency` serves the active org's. Today that's one org; the shape doesn't need to
change if a second appears.

Staleness is shown on the page ("Snapshot from 14:15, 47 minutes ago"). A snapshot older
than 6 hours shows a red note; it still renders.

### 4.6 The PWA keeps the last snapshot on the phone

`next-pwa` is already configured (`next.config.ts`, offline fallback `/offline`). Add a
runtime caching rule: `NetworkFirst` for `/emergency` and `/api/emergency/snapshot`,
`CacheFirst` for `/api/emergency/pdf/*`, max age 24 h. Then if the **VM itself** is down,
the phone still opens `/emergency` with the last snapshot it saw. The current
`/offline` page gains a link to it.

If WS3 lands Convex on the same VM, this is what covers a VM outage; if it doesn't, it
covers the Sydney → US link and Convex Cloud incidents. Either way the design is the
same; only the likely trigger changes.

### 4.7 Exiting

The breaker closes on its own; the manual flag is lifted by the same script/button. On
exit the banner shows "Backend restored at 15:02 — anything done on paper during the
outage needs entering" for 10 minutes and then goes away. Writes made from `/emergency`
are impossible (it has none), so there is no reconciliation logic — it's a human task and
the banner says so.

### 4.8 Tests

- Unit: breaker state machine (open/half-open/close, timeouts), health union logic,
  snapshot builder against a seeded org (the `convex-test` harness), PDF generation for
  the window (existing `pdf-test-utils`).
- Integration: `tests/` harness with Convex **stopped** — `/api/health` reports `down`
  within 60 s, `/emergency` renders from a pre-built snapshot, a server action returns
  the typed error, the banner appears (jsdom smoke).
- Manual drill (documented in a new `docs/emergency-mode-runbook.md`): flip the manual
  flag on a Friday afternoon, walk a pick list from `/emergency` on a phone, lift it.

### 4.9 Files (new unless noted)

`src/lib/backend-health.ts` (breaker + timeout wrapper; `src/lib/convex-client.ts` calls
it), `src/app/api/health/route.ts`, `src/components/layout/system-status-banner.tsx`,
`src/app/(app)/layout.tsx` (mount), `src/components/error-boundary.tsx` (typed
error card), `src/lib/emergency/snapshot.ts` + `scripts/build-emergency-snapshot.ts`,
`src/app/(app)/emergency/page.tsx`, `src/app/api/emergency/{snapshot,pdf}/route.ts`,
`prisma/schema.prisma` (+ migration for the flag), `scripts/toggle-emergency-mode.ts`,
`src/app/(admin)/admin/page.tsx` (button), `next.config.ts` (runtime caching),
`docs/emergency-mode-runbook.md`, `FEATUREDOCS/83-emergency-mode.md`, `ARCHITECTURE.md`.

### 4.10 Sequencing inside WS4

1. Breaker + timeout + `/api/health` + banner (the part that stops pages hanging).
2. Manual flag + admin button + script.
3. Snapshot job + `/emergency` page.
4. PDFs + PWA caching.
5. Runbook + drill.

Each is its own PR and useful on its own.

---

## WS5 — Hygiene from the report

| Item | Where | Size |
|---|---|---|
| CLS rounded to integer on the custom `web_vital` event | `src/components/providers/posthog-provider.tsx:112` — round ms metrics only, keep 3 decimals for CLS; test | 1 line + test |
| R-8.9.3 exception expired 2026-08-25 with alerts still red | `docs/exceptions.md` — renew with expiry tied to WS2/WS3 exit, scope "until the go/no-go" | doc |
| Better Auth schema drift caused the 09-16 incident (60 server errors, 2h20m) | CI gate: run Better Auth's schema generator against `prisma/schema.prisma` in `ci.yml`, fail on diff — the same "generated file is stale" gate the API registry already has | S |
| 4 error-tracking issues from 09-16 still "active" | Resolve in PostHog once the gate lands | click |
| No server-exception alert | PostHog: error-tracking alert on new server issues → email. Not an insight alert, so the 5-slot cap doesn't apply | click |
| Observability insights on no dashboard | One "Flow health" dashboard with the 8 insights | click |

## Not doing (and why)

- **SSR/streaming the client-rendered dashboards** as the fix for LCP. Sequencing pages
  behind a 600 ms-per-hop backend is the cost; changing where React renders doesn't
  remove the hops. WS2's batching or WS3's relocation does.
- **Offline write queue / sync.** Two users, one warehouse, paper works for an hour.
  Revisit if an outage actually happens and paper didn't.
- **Second app region / CDN in front of the app.** Users and app are already in the same
  city.
- **Changing the MCP connector's cadence.** Not ours.

## Open questions for the owner

1. Is a 10-minute revocation lag on MCP *protocol* calls (never data calls) acceptable
   for WS1, or cap at 60 s?
2. For WS3, sibling droplet or second container on the existing VM? (Sibling isolates
   the DB from an app-container restart; same-VM is cheaper and simpler.)
3. Which four documents does the warehouse actually reach for on a job day? §4.5 assumes
   packing list, delivery docket, return sheet, call sheet.
