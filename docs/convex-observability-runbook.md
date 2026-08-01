# Convex observability + kill-switch runbook

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Observability + kill switches for the public mutation surface** — every domain is
now browser-direct, so these are load-bearing. This is the operator's reference for
both.

## Kill-switches (built)

| Surface | Control | How |
|---|---|---|
| **Browser-direct mutations** (Phase 3) | `systemFlags` singleton + `assertWritesEnabled` | `scripts/toggle-write-killswitch.ts on "<reason>" [domains...]` — every public mutation that calls the guard rejects instantly. No redeploy. |
| **Org-wide API keys** | `orgSettings.apiKillSwitchAt` | Settings → API keys → kill-switch; checked on every API request (`src/lib/api-key.ts`). |
| **Server-routed native writes** | `NATIVE_*` env flags (Coolify) | Per-domain; flipping falls back to the (now frozen) Postgres path — a coarse, deploy-scoped control, not an instant brake. |

**The mutation kill-switch is the emergency brake for the (now fully shipped)
browser-direct write surface.** Convention: **every browser-direct (public)
mutation must call `assertWritesEnabled(ctx, "<domain>")` first**
(`convex/lib/writeGuard.ts`). Wired into every `*Writes.ts` domain module
today (43 files) — add the call to any new one as it's created. Flip:

```bash
docker exec <app> pnpm exec tsx scripts/toggle-write-killswitch.ts on  "incident #123"        # kill ALL browser writes
docker exec <app> pnpm exec tsx scripts/toggle-write-killswitch.ts on  "asset abuse" asset    # kill one domain
docker exec <app> pnpm exec tsx scripts/toggle-write-killswitch.ts off                          # restore
docker exec <app> pnpm exec tsx scripts/toggle-write-killswitch.ts status
```

## Observability

- **Function metrics (primary), owner: Jayden Nawotka.** The Convex dashboard
  (`dashboard.convex.dev/t/two-toned/gearflow-prod/useful-cuttlefish-334`) →
  Functions/Health gives per-function call volume, error rate, and latency
  percentiles for every query/mutation/action. This is the source of truth for the
  mutation-surface health signal.
- **Cron/job failure alerting (R-8.9.1) — wired and live.** `convex/lib/errorReporting.ts`'s
  `reportConvexJobError` forwards every `scheduledJobs.ts` cron-executor failure
  (`invokeCronRoute` — covers both `runNotificationEmails` and
  `runTestTagReminders`) to PostHog as a `$exception` event, before re-throwing so
  the Convex dashboard's own cron-run log still records it too. `POSTHOG_KEY` is
  set on the **Convex** deployment (2026-07-23; the same public write-only key
  `NEXT_PUBLIC_POSTHOG_KEY` uses; separate from the Next.js `.env`).
  **Scope note:** this covers the two durable cron executors, not every one of the
  43 `*Writes.ts` domain mutation modules — a blanket log-stream (below) still adds
  value for full function-level coverage.
- **Blanket function-level log stream (optional, still a manual step):** Convex
  Cloud → Settings → Integrations supports a **log stream** (Axiom/Datadog) +
  failure webhooks covering every function, not just the two crons above. Point a
  webhook at PostHog/Slack keyed on function errors for full-surface coverage. This
  needs interactive Convex dashboard access, so it's not doable headlessly — owner:
  Jayden Nawotka.
- **Domain anomaly signals already emitting alerts:**
  - **Auth-mirror drift** — `scripts/auth-mirror-reconcile.ts` (daily cron) emails +
    exits non-zero on any drift/parity break.
  - **WooCommerce order failures** — `wooCommerceOrderLogs` rows with status `FAILED`
    (query the table / dashboard).
  - **Webhook delivery stalls** — `webhookDeliveries` dead/failed rows.
- **Request correlation (R-8.9.5/R-8.9.6):** `middleware.ts` mints/forwards
  `x-request-id` on every branch (public/token routes included). It auto-threads
  into `logger.*` calls via an ambient `AsyncLocalStorage` (`src/lib/request-context.ts`,
  registered from `instrumentation.ts`) for any request run inside
  `withValidatedBody` (`src/lib/api-validation.ts`), and into `onRequestError`'s
  PostHog error context alongside a best-effort opaque actor id
  (`instrumentation.ts`). `src/lib/convex-op-timing.ts` reuses the same ambient
  request id as a de facto trace id on the `convex_op_latency` PostHog event and
  slow-op log line, correlating the Convex leg back to the originating Next.js
  request — a true W3C `traceparent` into the Convex function body itself would
  need threading a trace id through every query/mutation's args, which is out of
  scope here.
- **PostHog dashboards/insights/alerts, owner: Jayden Nawotka.** Covers the CWV
  (T-7), slow_query (T-9), convex_op_latency (T-P6), and crash-free-sessions
  (T-13) insights/alerts referenced from `docs/budgets.md`.
- **Vendor cost usage (T-P4, R-9.12/#764) — tracked, not yet alerted.** A
  `vendor_usage` PostHog event fires per billable Resend send and per Maps
  Autocomplete/Place Details request (`src/lib/vendor-cost-tracking.ts` +
  call sites). A "Vendor usage (T-P4)" insight is to be created once live event
  volume confirms (same precedent as the CWV insights above), for owner Jayden
  Nawotka to review monthly. No PostHog Alert object exists for it: computing a live 80%
  ratio needs either a persistent monthly counter (not built — no Convex
  deploy credentials when this landed) or a query-capable PostHog key (only
  the write-only ingestion key is configured), and the 5-alert cap below is
  already full regardless. See FEATUREDOCS/61 for the target threshold numbers
  already worked out for whichever lands first.

## Alert slots (5-alert plan cap)

The project's PostHog plan caps alerts at 5. Current allocation (2026-07-23):

| Alert | Threshold | Registered as |
|---|---|---|
| CWV combined ratio — INP+CLS | > 1.0 (consolidated, #656) | T-7 |
| LCP p75 | > 2000ms | T-7 |
| slow_query p95 | > 1000ms | T-9 |
| convex_op_latency p95 | > 1000ms | T-P6 |
| **Crash-free sessions** | **< 99.5%** | **T-13** |

**Retired 2026-07-23:** the T-P7 `queue_lag p95 above 300000ms` alert was deleted to free
the slot the T-13 alert now uses — it had never fired (zero incidents) and was the
narrowest/most internal of the five (webhook-delivery backlog vs. the others' active or
product-facing signals). The underlying `queue_lag` PostHog event and structured log line
(`src/lib/queue-lag-timing.ts`) are untouched — queue lag is still measured and visible,
just no longer auto-alerting. To restore it: create an alert on the existing
`"queue_lag p95 duration (T-P7, R-9.10, #623)"` insight, condition `absolute_value`, bounds
`{upper: 300000}`, type `absolute`, `TrendsAlertConfig` `series_index: 0` — after freeing
another slot or upgrading the plan.

### Current firing state (R-8.9.3, round-3 audit #862)

| Alert | Firing since | Root cause (triaged via PostHog SQL, 2026-07-25) | Next action | Owner |
|---|---|---|---|---|
| LCP p75 | 2026-07-22 | Real, not noise (4,388-sample `convex_op_latency` population + per-page web-vitals breakdown corroborate it). Worst pages: `/crew` 4830ms, `/warehouse/*` ~2.7-3.1s, `/dashboard` 3074ms — all fully-client-rendered dashboards (`"use client"`, no SSR/streaming) whose largest element waits on a chain of `useServerQuery`/Convex round-trips. Compounded by `RequirePermission` (56 call sites) flashing "Access Denied" — the false-negative default while `useCanDo`'s permission query is loading — before swapping to real content, a spurious late LCP candidate; **fixed** in #862 (renders nothing while loading instead). | The remaining gap — converting these client-rendered dashboards to SSR/streaming so first paint doesn't wait on a Convex round-trip — is bigger than one PR cycle; tracked as a dated exception (`docs/exceptions.md`, R-8.9.3) rather than left silently failing. | Jayden Nawotka |
| convex_op_latency p95 | 2026-07-22 | Real. Baseline per-op latency clusters ~480-520ms across nearly every query regardless of shape (network/infra round-trip to Convex Cloud, not a query bug) — since `reportIfSlowConvexOp` only ever emits past 300ms (`src/lib/convex-op-timing.ts`), that baseline alone sits inside the reported population. On top of it, `crewMembers:getByIcalToken` was the single worst hotspot (51% of its 202 samples over the 1000ms incident line, p95 1457ms, max 5616ms) — the public iCal feed route (`src/app/api/crew/calendar/[token]/route.ts`) had `Cache-Control: no-cache, no-store, must-revalidate`, so every external calendar-client poll re-ran the full getByIcalToken + assignments + shifts + per-project-lookup chain. **Fixed** in #862: `private, max-age=300` (calendar clients already poll on their own multi-minute+ cadence, so this is a safe, non-scope-creeping fix limited to this one feed route — the sibling no-cache token routes, e.g. `warehouse/display`, are live status views that must stay uncached). | Re-check the p95 after the cache fix has a few days of traffic; the residual ~500ms infra baseline (not `getByIcalToken`-specific) is covered by the same exception as the LCP row above. | Jayden Nawotka |

See `docs/exceptions.md` (R-8.9.3 row) for the dated exception covering the residual baseline
latency / SSR-streaming follow-up that didn't fit this cycle.

**2026-07-26 update (#802/#803/#804):** the round-3 "residual ~500ms infra baseline" has a
now-tested candidate root cause: `GET /api/auth/jwks` — which Convex's customJwt provider
fetches to verify the token on every function call — was an uncached, per-request DB read
measuring 0.9–5.6s TTFB from us-east (probed 2026-07-26; a bare `/` redirect on the same
origin is ~0.7s, so the endpoint adds work on top of an already-long origin RTT). Two fixes
landed: the JWKS response is memoized in-process + served with `Cache-Control`
(`src/lib/jwks-route-cache.ts`), and the public login page's `getOrgLoginInfo` (whose
`SsoProvider.findMany` was the only query over the T-9 incident line) is behind a 60s
in-process cache (`src/lib/org-login-info-cache.ts`). Re-check all three alerts (LCP p75,
`convex_op_latency` p95, `slow_query` p95) after a few days of traffic; if `convex_op_latency`
p95 is still >1s, the residual is genuine app↔Convex network distance and belongs to the
R-8.9.3 exception's SSR/streaming follow-up, plus an ops-side option: add a CDN cache rule
for `/api/auth/jwks` (Cloudflare does not edge-cache extensionless JSON by default even with
`Cache-Control`; a Cache Rule honoring the served `s-maxage=300` would let Convex's fetches
hit the us-east edge instead of the origin).

## Remaining ops steps (not code)

Optionally wire the Convex dashboard **log stream → PostHog/Slack** for full
function-level (not just cron) failure coverage — needs interactive dashboard
access. Everything else from the 2026-07-22 §8.9 audit (#776) is done.
