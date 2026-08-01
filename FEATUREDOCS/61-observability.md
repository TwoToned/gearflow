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

## Test Fake

`src/lib/posthog-fake.ts`'s `createFakePostHog()` is the deterministic, inspectable
counterpart to `captureServerException`/`captureServerEvent` for unit tests (POLICY.md
R-8.10.4) — an in-memory capture recorder, mirroring the `email-fake.ts` pattern. It is
not wired into `posthog-server.ts` via dependency injection; tests that need a fake import
it directly in place of the real functions.

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

Two Prisma/Convex-level extensions time every call and report crossings of the `docs/budgets.md`
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

**2026-07-25 round-3 audit finding (#862, R-8.9.3):** the LCP p75 and `convex_op_latency` p95
alerts had been firing continuously since 2026-07-22. Triaged via direct PostHog SQL against
both events rather than guessing — confirmed real (not low-sample noise), found two concrete,
fixed contributors (an uncached public iCal feed re-running its full Convex read chain on every
external poll; `RequirePermission` flashing a false "Access Denied" while its permissions query
loaded, on every one of its 56 gated routes), and a residual client-rendering-architecture /
infra-baseline-latency gap too large for one cycle, registered as a dated exception. Full
breakdown: `docs/convex-observability-runbook.md`'s "Current firing state" table and
`docs/exceptions.md`'s R-8.9.3 row.
`convex-op-timing.ts` additionally tags both the log line and the PostHog event with the ambient
`x-request-id` (above) when one is present — a de facto trace id correlating the Convex leg back
to the originating Next.js request (POLICY.md R-8.9.6). A true W3C `traceparent` propagated into
the Convex function body itself would need threading a trace id through every query/mutation's
args across all ~43 `*Writes.ts` domain modules — out of scope here.

**2026-07-26 follow-up (#802/#803/#804):** all three latency alerts were still breaching after
the round-3 fixes. Two shared-root-cause remediations landed: (1) the JWKS endpoint Convex
verifies every function-call token against (`/api/auth/jwks`) was an uncached per-request DB
read measuring 0.9–5.6s TTFB from us-east — now memoized in-process + served with
`Cache-Control` (`src/lib/jwks-route-cache.ts`, see FEATUREDOCS/54); (2) the public login
page's `getOrgLoginInfo` — whose `SsoProvider.findMany` was the sole T-9 `slow_query` p95
incident driver — is now behind a 60s in-process cache (`src/lib/org-login-info-cache.ts`,
see FEATUREDOCS/33). LCP (T-7, #802) is expected to recover downstream of the Convex-leg
fix per #802's own triage; re-check all three alerts after a few days of traffic.

## Vendor cost budget tracking (T-P4, R-9.12/#764, #831)

The `docs/budgets.md` R-0.4 registry registers a $15/mo ceiling each for Resend and Google
Maps (plus a Convex plan cap), but until #764 nothing measured usage against them — a Major
compliance gap (zero enforcement/alerting). `src/lib/vendor-cost-tracking.ts` adds the
`vendor_usage` PostHog event (`AnalyticsEvent.VendorUsage`, `{ vendor, operation, units }`) as
the per-unit signal for the top spend drivers:

- **Resend, direct send path** — `reportVendorUsage("resend", "send")` fires from
  `src/lib/email.ts`'s `sendEmail()` after every real (non-dev-mock) send.
- **Resend, Convex-scheduled send path** — `convex/emailActions.ts`'s `deliver` (the Node-runtime
  action `emails.enqueue` schedules) fires `reportConvexVendorUsage("resend", "send")` after
  every real (non-mock) confirmed send. This is a **separate** helper
  (`convex/lib/vendorUsage.ts`), not `src/lib/vendor-cost-tracking.ts` re-exported — Convex
  actions run in Convex Cloud's own deployment, a different runtime from `src/`, so they can't
  import `posthog-server.ts` (Next-only `posthog-node` singleton). It's a raw `fetch` POST to
  PostHog's `/capture/` HTTP API instead, mirroring `errorReporting.ts`'s pattern, emitting the
  same `vendor_usage` event name so both paths land in one insight. Until #831 this path was
  invisible to the tracked metric — a real send routed through the Convex-scheduled path (crew
  offers, timesheets, etc.) spent budget with zero visibility.
- **Google Maps** — `capture(AnalyticsEvent.VendorUsage, { vendor: "maps", operation: ... })`
  fires client-side from `src/components/ui/address-input.tsx` for the two billable Places API
  (New) operations it makes: `"autocomplete"` (`fetchAutocompleteSuggestions`) and
  `"place_details"` (`place.fetchFields`).

**What this does NOT do (and why):** compute a live $ total, auto-alert at 80%, or stand up
the "reviewed monthly with a named owner" insight yet. All three need a way to read usage back
over a monthly window — a persistent counter (out of scope: no Convex deploy credentials
available when #764 landed, and a new Postgres table would be scope creep beyond the
Better-Auth/audit models Postgres is limited to post-migration) or a PostHog **query-capable**
personal API key (the app only holds the public write-only ingestion key) — plus, for alerting
specifically, a freed slot under the PostHog plan's already fully-allocated 5-alert cap (see
`docs/convex-observability-runbook.md`). `vendor-cost-tracking.ts`'s doc comment carries the
target reference lines for whichever lands first — Resend 2,400 sends/mo (80% of a 3,000/mo
free-tier estimate), Maps $12/mo (80% of the $15 budget, priced off Places API Essentials list
pricing) — so the next engineer has concrete numbers instead of a blank slate.

Both the 80%-alert and the monthly-review insight/cadence are covered by the dated §15
exception in `docs/exceptions.md` (R-9.12, expires 2026-10-23) rather than being silently
unimplemented — as of this writing the `vendor_usage` event hasn't yet accumulated meaningful
volume in PostHog, so creating the "Vendor usage (T-P4)" insight now would ship an empty chart
nobody reviews. Once deployed and emitting live volume from both Resend paths, create the
insight (same precedent as the CWV/crash-free insights above — created only after confirming
live event volume, not speculatively before) for the named owner (Jayden Nawotka, matching
R-9.12) to review monthly, and extend/replace the exception accordingly.

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
`invokeCronRoute`'s `fetch` also carries an explicit 10s `AbortController` timeout (R-9.6/#763)
— previously an unbounded call, so a hung executor route could pin a Convex action's execution
budget indefinitely instead of failing fast into the reporting path above. `reportConvexJobError`
itself gained the same 10s timeout on its own outbound POST to PostHog (R-9.6/#830) — until then
it was the one remaining unbounded call in the cron-failure path, sitting right in the reporting
leg `invokeCronRoute`'s own timeout was added to protect.

Both Resend send paths' outbound calls also carry an explicit 10s timeout (R-9.6/#830): the SDK
exposes no `AbortSignal`/timeout option of its own, so `src/lib/email.ts` and
`convex/emailActions.ts` each wrap `resend.emails.send(...)` in a `withTimeout()` helper
(`src/lib/fetch-with-timeout.ts` / `convex/lib/promiseTimeout.ts` — duplicated, not imported,
same reason as `errorReporting.ts` above) that races the SDK call against a timer. This can't
cancel the underlying in-flight request the way an `AbortController` can, but it bounds how long
the caller waits instead of relying on the SDK's library-default (potentially infinite) behavior.
In `email.ts`'s `sendViaResend` (#828 added `retryWithBackoff` there), the timeout wraps each
individual attempt, not the whole retry loop — a timed-out attempt is just a normal retryable
failure, so a hung single attempt can't eat the entire retry budget.

**Scope note:** this covers the two cron executors, not the other 43 `*Writes.ts` domain
mutation modules. See `docs/convex-observability-runbook.md` for the optional blanket
function-level log-stream (needs interactive Convex dashboard access).

## Crash-free sessions (T-13)

A "Crash-free sessions (T-13)" PostHog insight (id `10376263`) computes
`(1 - unique_session($exception) / unique_session($pageview)) * 100` — the `docs/budgets.md` R-0.4
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
- v5 (#764): `vendor_usage` PostHog event added for Resend sends + Maps Autocomplete/Place
  Details requests — the first real signal against the T-P4 cost budget (previously
  registered with zero enforcement). Live $ computation and 80%-threshold alerting are
  deferred pending a persistent monthly counter or a query-capable PostHog key; see "Vendor
  cost budget tracking" above for the concrete target numbers already worked out.
- v6 (#829): `posthog-fake.ts` added — the PostHog server adapter had no fake/local
  implementation for tests, unlike `email-fake.ts`/`maps-fake.ts` (R-8.10.4 is a per-adapter
  clause).
- v7 (#830, #831): `errorReporting.ts`'s outbound PostHog POST gained the same 10s
  `AbortController` timeout `invokeCronRoute`'s fetch already had (R-9.6); both Resend SDK send
  paths (`src/lib/email.ts`, `convex/emailActions.ts`) wrapped in an explicit `withTimeout()`
  since the SDK exposes no timeout of its own — in `email.ts` this wraps each individual
  `retryWithBackoff` attempt (#828 added retry there), not the whole retry loop, so a timed-out
  attempt is just a normal retryable failure. `convex/emailActions.ts`'s `deliver` — the
  second, Convex-scheduled Resend send path — now reports T-P4 vendor usage too (previously
  invisible to the tracked metric), via a new Convex-native `reportConvexVendorUsage` helper
  (`convex/lib/vendorUsage.ts`, mirroring `errorReporting.ts`'s raw-fetch pattern since `convex/`
  can't import the Next-only PostHog client). The R-9.12 §15 exception (`docs/exceptions.md`)
  was extended to explicitly cover the "reviewed monthly with a named owner" clause alongside
  80%-alerting — both share the same "needs live event volume + a query-capable key or counter"
  blocker, and the `vendor_usage` event has no meaningful volume yet as of this landing.
