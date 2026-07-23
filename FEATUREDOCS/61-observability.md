# Observability: Analytics + Error Tracking (PostHog)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Single provider for product analytics, Core Web Vitals, and error tracking. PostHog replaced
Sentry entirely (#650) — Sentry captured errors only; PostHog covers both without a second
vendor SDK to keep PII-hardened.

## Client

`src/components/providers/posthog-provider.tsx` dynamically imports `posthog-js` (own async
chunk, not entry First Load JS) and initializes it only if `NEXT_PUBLIC_POSTHOG_KEY` is set —
inert (no-op) in dev/local without it. PII-hardened for an internal, PII-heavy app:

- `autocapture: false`, `capture_pageview: false` — no blanket click/input/pageview capture.
  Pageviews are sent manually (cuid-only path, never query strings).
- `disable_session_recording: true` — no replay.
- `mask_all_text` / `mask_all_element_attributes` — belt-and-braces.
- `person_profiles: "identified_only"`.
- `sanitize_properties` strips query strings from `$current_url`/`$referrer`/`$pathname`
  before any event leaves the browser.
- `capture_exceptions: true` — uncaught errors + unhandled promise rejections (stack only).

Emit events only through `src/lib/analytics.ts` (`capture()` + `AnalyticsEvent` enum) — the
single source of truth for event names, isomorphic and no-op-safe. Event properties must stay
cuid-only (R-8.12.4) — enforced by convention at emit sites, not by the SDK.

`src/lib/analytics.ts` also exposes `identify()`/`resetAnalyticsIdentity()`, called from
`src/components/providers/posthog-identify.tsx` (mounted once in `(app)/layout.tsx`, alongside
`OrgActivator`). It identifies the PostHog person as the **org-membership cuid**
(`RoleData.memberId` from `/api/current-role` — the Prisma `Member.id`, not the raw Better Auth
user id or any name/email) once a session + org resolve, and resets on sign-out so a shared
device (e.g. the warehouse floor PWA) doesn't carry the previous member's identity into the next
session (POLICY.md R-8.9.4 — errors/sessions must carry an opaque internal user ID).

## Request correlation (`x-request-id`)

`src/middleware.ts` mints/reuses an `x-request-id` on **every** branch — including the
public/token early-returns (`/api/calendar/*`, `/api/crew/respond/*`, `/api/cron/*`, etc.) and
the login-redirect response, not just the authenticated path. It's forwarded both as a response
header and into the downstream request headers.

Rather than threading a `requestId` argument through every `logger.*` call site,
`src/lib/request-context.ts` exposes an ambient `AsyncLocalStorage` (mirroring
`request-actor.ts`'s `ActorContext` seam) — `runWithRequestId()` / `getAmbientRequestId()`.
`src/lib/logger.ts` reads the ambient value automatically via a getter registered from
`instrumentation.ts` at process start (kept as a **registered function**, not a static import,
because `logger.ts` is isomorphic — imported by client components — and `request-context.ts`
pulls in `node:async_hooks`, which can't land in the browser bundle).

Wired at two entry points today:
- **`src/lib/api-validation.ts`'s `withValidatedBody`** wraps handler execution in
  `runWithRequestId`, so any `logger.*` call a JSON-body API route makes auto-carries the
  correlation id.
- **`instrumentation.ts`'s `onRequestError`** reads `x-request-id` directly off the error
  request and passes it (plus a best-effort opaque actor id from `getSession()`) into
  `captureServerException`'s PostHog context.

**Scope note:** this covers the JSON-body API route surface and the error-reporting path, not
every session-based server action or GET route — there's no single choke point for those today
(the same gap `runWithActor`'s `ActorContext` has for the non-API-key path). Extend by wrapping
another entry point in `runWithRequestId` if a gap surfaces.

## Server

`src/lib/posthog-server.ts` — a `posthog-node` singleton authenticated with the same public
`phc_` key (no runtime secret). `captureServerException()` never throws and captures against a
fixed `"server"` distinctId (no user PII). `instrumentation.ts`'s `onRequestError` and
`src/lib/process-safety.ts`'s uncaught-exception/unhandled-rejection net both report through
it. Dynamically imported so it never loads in the edge runtime (posthog-node is Node-only).

## Sourcemaps (readable stack traces)

`next.config.ts` wraps the Next config with `withPostHogConfig` from `@posthog/nextjs-config`
— **outermost wrapper**, required, or its build hooks are silently dropped (see the code
comment / github.com/PostHog/posthog-js/issues/3572).

`sourcemaps.enabled` is gated on `POSTHOG_SOURCEMAPS_REQUIRED`, a flag only the production
`Dockerfile` sets (hardcoded `true`, not passed from local dev or the PR-validation `Build`
job in `ci.yml`). When it's on, the plugin throws synchronously at config-resolution time if
`POSTHOG_CLI_TOKEN` / `POSTHOG_CLI_ENV_ID` are missing — a hard build failure, not a silent
skip (R-8.9.2). `POSTHOG_CLI_TOKEN` is passed to the Docker build as a **BuildKit secret
mount** (not a build-arg) so the write-scoped personal API key never lands in an image layer;
`POSTHOG_CLI_ENV_ID` and `POSTHOG_RELEASE_VERSION` (`github.sha`) are ordinary build-args.

## Latency budgets (T-9 query timing, T-P6 per-endpoint SLOs)

Two Prisma/Convex-level extensions time every call and report crossings of the README.md
R-0.4 budget registry thresholds through `captureServerEvent()` (`src/lib/posthog-server.ts`,
a general-purpose sibling of `captureServerException`). Both share the same two-tier severity
shape (structured log always; PostHog event only past the "slow" line; `incident: true` past
a second, higher line) and are never allowed to throw or alter the wrapped call's result:

- **`src/lib/prisma-query-timing.ts`** (`withQueryTiming`, wired into the `prisma` singleton in
  `src/lib/prisma.ts`) — times every Prisma query via a Client Extension. `> 100ms` (T-9
  interactive-path p95) emits `slow_query`; `> 1000ms` escalates to an incident.
- **`src/lib/convex-op-timing.ts`** (`withConvexOpTiming`, wired into the singleton in
  `src/lib/convex-client.ts`) — times every `query`/`mutation` the app server sends to Convex
  via `getFunctionName()` (`convex/server`) for the op name. `> 300ms` (T-P6 "API" p95 target)
  emits `convex_op_latency`; `> 1000ms` escalates to an incident. This measures the Convex leg
  only — a server action making several sequential Convex calls (or Convex + Prisma work) can
  still miss the end-to-end budget with every individual call under 300ms; there is no
  request-wide wrapper today (would need either an OTEL pipeline or per-action instrumentation
  across ~30 `src/server/*.ts` files — out of scope here, revisit if the per-call signal proves
  insufficient).

Both events feed p95 alerts in PostHog once real traffic is flowing (same pattern as the CWV
alerts in R-8.1.5 — created only after confirming live event volume, not speculatively before).
`convex-op-timing.ts` additionally tags both the log line and the PostHog event with the ambient
`x-request-id` (above) when one is present — a de facto trace id correlating the Convex leg back
to the originating Next.js request (POLICY.md R-8.9.6). A true W3C `traceparent` propagated into
the Convex function body itself would need threading a trace id through every query/mutation's
args across all ~43 `*Writes.ts` domain modules — out of scope here.

## Convex job/cron error forwarding

Convex function/cron errors used to land only in the Convex dashboard — never forwarded
anywhere (POLICY.md R-8.9.1). `convex/lib/errorReporting.ts`'s `reportConvexJobError()` is a raw
`fetch` POST to PostHog's `/capture/` HTTP API (not the `posthog-node` SDK — Convex actions run
in Convex Cloud's own deployment, a separate runtime from `src/`, so they can't import
`posthog-server.ts`). Wired into `convex/scheduledJobs.ts`'s `invokeCronRoute` — the single
funnel both durable cron executors (`runNotificationEmails`, `runTestTagReminders`) go through —
so a failure is reported to PostHog as a `$exception` event before the original error is
re-thrown (Convex's own cron-run log still records it too; reporting is best-effort and never
masks the real failure). Requires `POSTHOG_KEY` set on the **Convex** deployment (`pnpm exec
convex env set POSTHOG_KEY <phc_...>` — separate from the Next.js `.env`); inert until set.

**Scope note:** this covers the two cron executors, not the other 43 `*Writes.ts` domain
mutation modules. See `docs/convex-observability-runbook.md` for the optional blanket
function-level log-stream (needs interactive Convex dashboard access).

## Crash-free sessions (T-13)

A "Crash-free sessions (T-13)" PostHog insight (id `10376263`) computes
`(1 - unique_session($exception) / unique_session($pageview)) * 100` — the README.md R-0.4
budget registry's ≥99.5% floor, with a paired alert (fires below 99.5%). Created 2026-07-23
after retiring the never-fired T-P7 `queue_lag` alert to free a slot under the project's
5-alert PostHog plan cap — see `docs/convex-observability-runbook.md` for the full slot
allocation and how to restore the queue_lag alert.

## Env vars

See `CLAUDE.md` → Environment Variables → Analytics + error tracking.

## Migration history

- v1: PostHog SDK wired alongside Sentry (analytics + Web Vitals only).
- v2: PostHog Error Tracking added, capturing alongside Sentry (additive, safe rollback).
- v3: Sentry fully removed — `@sentry/nextjs`, `sentry.*.config.ts`,
  `instrumentation-client.ts` (Sentry-only, no PostHog equivalent needed), and all
  `SENTRY_*`/`NEXT_PUBLIC_SENTRY_*` env vars deleted. Sourcemap upload wired into the deploy
  build to close out #650.
- v4 (this doc, #776): `x-request-id` correlation fixed to cover every middleware branch and
  auto-thread into `logger.*`/`onRequestError`; `posthog.identify()` wired to the org-membership
  cuid with sign-out reset; Convex cron/job failures forwarded to PostHog (`POSTHOG_KEY` set on
  the Convex deployment 2026-07-23); Convex-op telemetry correlated with the originating request
  id; crash-free-sessions (T-13) insight + alert created, after retiring the never-fired T-P7
  `queue_lag` alert to free a slot under the PostHog plan's 5-alert cap.
