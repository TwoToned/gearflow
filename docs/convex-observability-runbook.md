# Convex observability + kill-switch runbook

**Observability + kill switches for the public mutation surface** — every domain is
now browser-direct, so these are load-bearing. This is the operator's reference for
both.

## Kill-switches (built)

| Surface | Control | How |
|---|---|---|
| **Browser-direct mutations** (Phase 3) | `systemFlags` singleton + `assertWritesEnabled` | `scripts/toggle-write-killswitch.ts on "<reason>" [domains...]` — every public mutation that calls the guard rejects instantly. No redeploy. |
| **Org-wide API keys** | `orgSettings.apiKillSwitchAt` | Settings → API keys → kill-switch; checked on every API request (`src/lib/api-key.ts`). |
| **Server-routed native writes** | `NATIVE_*` env flags (Coolify) | Per-domain; flipping falls back to the (now frozen) Postgres path — a coarse, deploy-scoped control, not an instant brake. |

**The mutation kill-switch is the Phase-3 emergency brake.** Convention: **every
browser-direct (public) mutation must call `assertWritesEnabled(ctx, "<domain>")`
first** (`convex/lib/writeGuard.ts`). Wired today into the two live browser-direct
mutations (`assetWrites.updateNotesNative`, `dashboardCounters.reconcileIfStale`);
add the call to each new one as Phase 3 lands. Flip:

```bash
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "incident #123"        # kill ALL browser writes
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts on  "asset abuse" asset    # kill one domain
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts off                          # restore
docker exec <app> npx tsx scripts/toggle-write-killswitch.ts status
```

## Observability

- **Function metrics (primary):** the Convex dashboard
  (`dashboard.convex.dev/t/two-toned/gearflow-prod/useful-cuttlefish-334`) →
  Functions/Health gives per-function call volume, error rate, and latency
  percentiles for every query/mutation/action. This is the source of truth for the
  mutation-surface health signal.
- **Failure alerting (to wire in the dashboard):** Convex Cloud → Settings →
  Integrations supports a **log stream** (Axiom/Datadog) + failure webhooks. Point a
  webhook at Sentry/Slack keyed on function errors so a spike pages an operator. The
  app already has `SENTRY_DSN` for the Next.js side; the Convex-side stream is the
  remaining dashboard-config step (needs Convex dashboard access — not doable
  headlessly from CI).
- **Domain anomaly signals already emitting alerts:**
  - **Auth-mirror drift** — `scripts/auth-mirror-reconcile.ts` (daily cron) emails +
    exits non-zero on any drift/parity break.
  - **WooCommerce order failures** — `wooCommerceOrderLogs` rows with status `FAILED`
    (query the table / dashboard).
  - **Webhook delivery stalls** — `webhookDeliveries` dead/failed rows.

## Remaining ops step (not code)

Wire the Convex dashboard **log stream → Sentry/Slack** + a failure-rate alert
threshold. Everything code-side (kill-switch, the guard convention, the domain
alerts) is in place; the external alert sink is a one-time dashboard configuration.
