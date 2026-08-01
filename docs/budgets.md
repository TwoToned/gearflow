<!-- Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5) -->

# Budget & threshold registry (POLICY.md R-0.4)

This repo **accepts the POLICY.md §13 threshold defaults**, with the following registered
overrides and project-specific (§13B) values.

> Moved here from `README.md` on 2026-08-01 — this is the same registry, unchanged. Code
> comments and docs that cite "README.md budget registry" mean this table.

| Threshold | Value | Rationale |
|---|---|---|
| T-5 Coverage | **48% floor** (default 80%) | Honest current baseline (~49–50%) over the declared scope, **enforced in CI as a ratchet** (`test:coverage`); climbing toward 80%. |
| T-7 Core Web Vitals p75 | **default** (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) | Accept the §13 default. **Alerted in PostHog** at 80% of each bound (LCP 2000 ms / INP 160 ms / CLS 0.08) via the "CWV p75 — LCP/INP/CLS" insights + alerts on `$web_vitals`; bundle-size half of R-8.1.5 enforced in CI (`bundle-ratchet`, blocking). |
| T-8 Route JS/CSS budget | **default** (≤ 170 KB soft, 300 KB hard) | Accept the §13 default. JS: **enforced in CI as a blocking regression ratchet** against the entry route (`bundle-ratchet.mjs`, R-8.1.5) — currently ~280 KB, under the 300 KB hard cap but over the 170 KB soft target (accepted gap, not yet worth a dedicated reduction project; the ratchet blocks it from growing further). CSS: **enforced in CI as a blocking 50 KB gzip cap** (`size-limit`, `.size-limit.json`, R-8.7.5) — currently ~29 KB, well under. |
| T-9 Interactive query latency | **default** (p95 < 100 ms; > 1 s = incident) | Accept the §13 default for interactive request paths. Instrumented (`src/lib/prisma-query-timing.ts`, R-8.3.2/#623) — emits `slow_query` past 100 ms, flags `incident` past 1 s. **Alerted in PostHog**: "slow_query p95 above 1000ms" fires if the p95 duration of already-slow queries crosses the 1 s incident line. |
| T-P1 Audit-log retention | **2 years** | Activity log (`activityLogs`) retained 24 months for operational/dispute history. |
| T-P2 PII retention | **Active relationship + 12 months** *(confirmed 2026-07-22)* | Client/crew/user PII kept for the active business relationship, purged 12 months after account/org deletion. Deletion path tracked in R-8.12.2. |
| T-P3 Backup retention | **90 days** | Daily Convex export retained 90 days (`.github/workflows/convex-backup.yml`). |
| T-P4 Monthly cost budget (metered) | **Maps $15 · Resend $15 · Convex plan cap** *(confirmed 2026-07-22)* | Ceilings for the metered vendors. **Usage tracked on both Resend send paths** (2026-07-23 #764, extended 2026-07-24 #831): a `vendor_usage` PostHog event fires per billable Resend send — the direct path (`src/lib/email.ts`) and the Convex-scheduled path (`convex/emailActions.ts`'s `deliver`, via `convex/lib/vendorUsage.ts` since `convex/` can't import the Next-only PostHog client) — and per Maps Autocomplete/Place Details request (`src/components/ui/address-input.tsx`). The "Vendor usage (T-P4)" monthly-review insight (owner Jayden Nawotka) and **80%-alerting are both NOT yet wired** — covered by the dated §15 exception in `docs/exceptions.md` (R-9.12), pending live event volume and either a persistent monthly counter or a PostHog query-capable key (only the write-only ingestion key is configured); target lines worked out in `src/lib/vendor-cost-tracking.ts` (Resend 2,400 sends/mo, Maps $12/mo) for whichever lands first. The PostHog plan's 5-alert cap (see `docs/convex-observability-runbook.md`) is also already full. See FEATUREDOCS/61. |
| T-P5 Max flaky-quarantine size | **10 tests** | Quarantine caps at 10; beyond that the suite is failing, not flaky. |
| T-P6 Per-endpoint p95 SLOs | **300 ms API · 1 s page** | Interactive-endpoint targets. Instrumented (`src/lib/convex-op-timing.ts`, R-9.11/R-8.9.6/#623) — emits `convex_op_latency` past 300 ms, flags `incident` past 1 s. **Alerted in PostHog**: "convex_op_latency p95 above 1000ms" fires if the p95 duration of already-slow ops crosses the 1 s incident line. **The agent-accessible API (#998) inherits this SLO for free**: both Convex clients the dispatcher uses (`src/lib/api/agent-client.ts`'s per-request agent client, `src/lib/convex-client.ts`'s service client used for the idempotency ledger + request log) are `withConvexOpTiming`-wrapped, same as every other Convex call site — no separate instrumentation needed. **MCP (#999) inherits it too, transitively**: every MCP tool call ends at the SAME `dispatch()` the REST layer uses, so there is no third client to instrument. **The OAuth adapter (#1003) inherits it the same way**: `/oauth/authorize`, `/api/v1/oauth/{register,token,revoke}` all call Convex through the same `getConvexClient()` service client — no fourth client, no separate instrumentation. |
| T-P7 Queue lag/age alert | **> 5 minutes** | Instrumented (`src/lib/queue-lag-timing.ts`, wired into the webhook delivery cron, R-9.10/#623) — emits `queue_lag` to PostHog past the 5-min threshold. **PostHog alert retired 2026-07-23** to free a slot for T-13 under the 5-alert plan cap (it had never fired) — the insight/event are unaffected, still measured and visible. See `docs/convex-observability-runbook.md` to restore it. |
| T-13 Crash-free sessions | **default** (≥ 99.5%) | Accept the §13 default. **Measured and alerted** via the "Crash-free sessions (T-13)" PostHog insight (`(1 - unique_session($exception) / unique_session($pageview)) * 100`, R-8.9.4/#776) — alert fires below 99.5%, created 2026-07-23 after retiring the T-P7 alert to free a slot under the plan's 5-alert cap. |
| T-P8 API/MCP per-key request-log retention | **30 days** *(Phase 2, #998)* | `apiRequestLog` rows are aged out by the daily `api-request-log-retention` cron (`convex/crons.ts` → `apiRequestLog.purgeOlderThan`, `REQUEST_LOG_RETENTION_MS` in `convex/apiRequestLog.ts`), bounded at 2000 rows/tick. Args are PII-redacted before they reach the table (R-8.12.4, `src/lib/api/request-log-redact.ts`) — this is a fixed retention window, not a continuous budget, so no R-9.2 80% alert applies (same as T-P1/T-P3's retention rows). |
| T-P9 Agent API rate limits | **agentRead 600/min (burst 200) · agentWrite 60/min (burst 20)** *(Phase 1, #997)* | Deliberately below the human `browserWrite` 300/min (T-9's table) so a runaway agent is throttled long before a human notices — numbers live once in `convex/lib/rateLimits.ts` (R-3.1), read by both the rate limiter and `/api/v1/whoami`. A rejection fires the `api.rate_limited` webhook event (FEATUREDOCS/58, Phase 8 #1004) and is visible in the per-key request log with `errorCode: "RateLimited"` — no separate PostHog 80%-threshold alert is wired yet (open gap, tracked here per R-9.2 rather than silently omitted). |

Values marked ⚠ *provisional* satisfy the R-0.4 registration requirement but carry business/legal
judgment — the owner should confirm them. Registration binds the value; several rules still require
the *enforcement* to be wired (alerting/monitoring), tracked as their own findings.

## Related

- [`POLICY.md`](../POLICY.md) §13 — the threshold defaults this table overrides.
- [`docs/exceptions.md`](./exceptions.md) — dated, expiring deviations (§15).
- [`docs/convex-observability-runbook.md`](./convex-observability-runbook.md) — the PostHog
  insights and alerts referenced above, and how to restore a retired alert.
