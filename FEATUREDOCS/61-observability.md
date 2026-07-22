# Observability: Analytics + Error Tracking (PostHog)

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

## Env vars

See `CLAUDE.md` → Environment Variables → Analytics + error tracking.

## Migration history

- v1: PostHog SDK wired alongside Sentry (analytics + Web Vitals only).
- v2: PostHog Error Tracking added, capturing alongside Sentry (additive, safe rollback).
- v3 (this doc): Sentry fully removed — `@sentry/nextjs`, `sentry.*.config.ts`,
  `instrumentation-client.ts` (Sentry-only, no PostHog equivalent needed), and all
  `SENTRY_*`/`NEXT_PUBLIC_SENTRY_*` env vars deleted. Sourcemap upload wired into the deploy
  build to close out #650.
