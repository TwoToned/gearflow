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
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "incident #123"        # kill ALL browser writes
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "asset abuse" asset    # kill one domain
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts off                          # restore
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts status
```

## Observability

- **Function metrics (primary), owner: Jayden Nawotka.** The Convex dashboard
  (`dashboard.convex.dev/t/two-toned/gearflow-prod/useful-cuttlefish-334`) →
  Functions/Health gives per-function call volume, error rate, and latency
  percentiles for every query/mutation/action. This is the source of truth for the
  mutation-surface health signal.
- **Cron/job failure alerting (R-8.9.1) — wired.** `convex/lib/errorReporting.ts`'s
  `reportConvexJobError` forwards every `scheduledJobs.ts` cron-executor failure
  (`invokeCronRoute` — covers both `runNotificationEmails` and
  `runTestTagReminders`) to PostHog as a `$exception` event, before re-throwing so
  the Convex dashboard's own cron-run log still records it too. Requires
  `POSTHOG_KEY` set on the **Convex** deployment (`pnpm exec convex env set
  POSTHOG_KEY <phc_...>` — the same public write-only key `NEXT_PUBLIC_POSTHOG_KEY`
  uses; separate from the Next.js `.env`). Inert until that's set.
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
  (T-7), slow_query (T-9), convex_op_latency (T-P6), queue_lag (T-P7), and
  crash-free-sessions (T-13) insights/alerts referenced from README.md's budget
  registry.

## Remaining ops steps (not code)

1. Set `POSTHOG_KEY` on the Convex deployment so the cron-failure forwarding above
   actually sends (currently inert — no key set yet).
2. Optionally wire the Convex dashboard **log stream → PostHog/Slack** for
   full function-level (not just cron) failure coverage — needs interactive
   dashboard access.
3. **Crash-free-sessions alert (T-13) is blocked on PostHog's 5-alert plan cap** —
   the insight ("Crash-free sessions (T-13)", id 10376263) is created and ready,
   but the project's PostHog plan already has 5/5 alert slots used (CWV combined,
   LCP, slow_query, convex_op_latency, queue_lag). Either upgrade the plan or
   retire/consolidate an existing alert to free a slot, then create the alert:
   condition `absolute_value`, bounds `{lower: 99.5}`, type `absolute`,
   `TrendsAlertConfig` `series_index: 0` (the formula series).
