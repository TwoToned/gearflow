# PostHog Usage & Performance Report

**Date:** 2026-09-28 · **Source:** PostHog project 520134 (flow.rvlt.app) via the PostHog MCP
(`query-web-overview`, `query-web-stats`, `query-web-vitals`, `query-trends`, `query-retention`,
`query-paths`, `query-error-tracking-issues-list`, `alerts-list`, and HogQL over `events`).
**Windows:** "30d" = 2026-08-29 → 2026-09-28 (partial); "prior 30d" = 2026-07-30 → 2026-08-29;
"7d" = 2026-09-21 → 2026-09-28. PostHog's project timezone is **UTC**, so day buckets straddle
two Sydney days. Test-account filtering was **off**. Budgets referenced are from
[`docs/budgets.md`](../budgets.md); alert slots from
[`docs/convex-observability-runbook.md`](../convex-observability-runbook.md).

> **Headline.** The app has **2 real recurring users** (one produces 88% of pageviews) plus
> a handful of one-off anonymous visits. Usage spiked in the week of 09-14 (872 pageviews,
> 6–30× the prior weeks) and fell 78% the week after. Reliability is fine: **0 client-side
> exceptions in 30 days, crash-free sessions 100%**, one 2h20m server-side incident on 09-16
> (Better Auth / Prisma schema drift after a deploy). Performance is the problem: **4 of the
> 5 PostHog alerts are firing** — LCP p75 2.85 s (7d: 4.4 s), `convex_op_latency` p95 1.38 s,
> `slow_query` p95 1.09 s, CWV combined ratio 1.75. The single worst server hot path is
> `apiKeys:getByTokenHash` (p50 ~1 s, 48% of calls over 1 s), driven by an API-key client
> polling every 4–5 minutes around the clock. One instrumentation bug found: the custom
> `web_vital` event rounds CLS to an integer, so its CLS values are all 0 or 1.

## 1. Usage

### 1.1 Audience

| Window | Persons | Distinct ids | Sessions | Pageviews |
|---|---:|---:|---:|---:|
| 30d | 4 | 6 | 128 | 1,236 |
| prior 30d | 4 | 6 | 87 | 526 |
| 7d | 2 | 3 | 28 | 203 |

- **Two recurring accounts** account for 99% of traffic: one identified member with **1,091
  pageviews / 92 sessions / active 19 of 30 days (88.3%)**, a second with 135 / 33 / 13 days
  (10.9%). Both have been active weekly since launch (2026-07-22).
- The other 4 distinct ids in the window are **anonymous single-session visits of 1–3
  pageviews** (08-31, 09-14, 09-16, 09-27) that never identified and never returned. Over 90
  days there are 18 persons, 15 of them one-pageview visitors from the 07-22 → 08-01 launch
  window.
- No bot traffic (all 1,235 pageviews `is_bot=false`, lib `web`). 99% AU; 12 views from SG/US
  are the same identified users.
- Devices: Desktop 89.5% / Mobile 10.5%; Chrome 92.5% / Mobile Safari 7.5%.

### 1.2 Volume over time (weekly, Monday start)

| Week of | Pageviews | Persons | Sessions |
|---|---:|---:|---:|
| 07-20 (launch) | 287 | 12 | 44 |
| 07-27 | 457 | 6 | 61 |
| 08-03 | 138 | 2 | 14 |
| 08-10 | 73 | 2 | 14 |
| 08-17 | 36 | 2 | 7 |
| 08-24 | 25 | 2 | 10 |
| 08-31 | 100 | 2 | 15 |
| 09-07 | 53 | 2 | 13 |
| **09-14** | **872** | 4 | 69 |
| 09-21 | 177 | 2 | 26 |

Daily peak was 190 pageviews on 09-18. Six of the last 30 days had **zero** pageviews
(09-04, 09-06, 09-08 → 09-10, 09-26). DAU never exceeded 3. Rolling WAU: 2 through 09-13,
4 for 09-16 → 09-20, back to 2 since 09-23.

Usage is 7 days a week (Fri highest at 249 pv, Sat lowest at 128) and peaks **16:00–18:00
Sydney** (170 + 152 pv), with a smaller 11:00–13:00 block. Nothing between 00:00 and 05:00.

### 1.3 What gets used (30d pageviews, ids collapsed to `/:id`)

| Route | Pageviews | Share | Persons |
|---|---:|---:|---:|
| /projects/:id | 241 | 19.5% | 2 |
| /projects | 209 | 16.9% | 2 |
| /dashboard | 135 | 10.9% | 2 |
| /assets/models/:id | 117 | 9.5% | 2 |
| /login | 63 | 5.1% | 4 |
| /assets/models | 47 | 3.8% | 1 |
| /assets/registry/:id | 32 | 2.6% | 1 |
| /availability | 31 | 2.5% | 2 |
| /overbookings | 30 | 2.4% | 1 |
| /assets/models/:id/edit | 28 | 2.3% | 1 |
| /today | 27 | 2.2% | 1 |
| /assets/registry/:id/edit | 20 | 1.6% | 1 |
| /finance | 17 | 1.4% | 1 |
| /clients/pipeline | 15 | 1.2% | 1 |
| /assets/registry | 15 | 1.2% | 1 |
| /maintenance | 14 | 1.1% | 1 |
| /warehouse, /warehouse/:id | 24 | 1.9% | 2 |
| /assets/roi | 13 | 1.1% | 2 |
| /crew | 9 | 0.7% | 1 |
| /kits | 7 | 0.6% | 1 |

- **Projects surfaces ≈ 37%**, assets/models/registry ≈ 22%, dashboard 11%. Five specific
  project pages received 24–54 views each — a small set of live jobs being worked repeatedly.
- **Rarely or never touched in 30d:** `/crew` (9 views, one person), `/kits` (7),
  `/settings` (9), `/my-tasks` (6), `/clients/:id` (9), `/assets/sales-stock` (7). Crew,
  kits and client detail are effectively unused by the current audience.
- **Navigation loop:** `/dashboard → /projects` (36 traversals) → `/projects/:id` (29) →
  back to `/projects` (10). From the dashboard the next most common hops are
  `/overbookings` (8), `/crew`, `/finance`, `/my-tasks`, `/projects/:id` (4 each). Landing
  pages are `/login` → `/dashboard` (7 direct transitions) or straight into a bookmarked
  project page.
- Bounce rate 3.1% (30d); avg session 15m 56s (down from 22m in the prior 30d).

### 1.4 Retention

Weekly retention on `$pageview` (cohorts 08-02 → 09-27): the two core users are retained
**100% week-over-week for all 8 weeks**. The 09-13 cohort of 4 (2 core + 2 anonymous
one-offs) retained 2/4 the following week. There is no acquisition to measure retention on.

### 1.5 Onboarding / activation funnel (D4, #1108)

**No data.** `onboarding_fork_chosen`, `setup_step_*`, `setup_completed` and
`activation_milestone` have **0 events in 90 days**. The emit sites are wired
(`src/app/(auth)/welcome/page.tsx`, `src/app/(auth)/setup/*`,
`src/hooks/use-activation-milestones.ts`) — the events are absent because **no new
organisation has signed up since the funnel instrumentation landed**, and the existing
org's milestones were already complete. The one onboarding event present is
`activation_checklist_dismissed` (1 event, 09-14, `milestones_done` count). `$identify` fired 3
times in 30d.

## 2. Performance

### 2.1 Core Web Vitals (T-7: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; alerts at 80%)

Site-wide, custom `web_vital` event, 30d (n = samples):

| Metric | n | p50 | p75 | p95 | % good | Budget |
|---|---:|---:|---:|---:|---:|---|
| LCP | 183 | 1,884 ms | **3,000 ms** | 5,410 ms | 64.5% | ❌ over 2,500 |
| TTFB | 205 | 442 ms | **1,054 ms** | 2,179 ms | 68.8% | ❌ (800 ms good line) |
| FCP | 189 | 728 ms | 1,419 ms | 2,514 ms | 83.1% | ✅ |
| INP | 188 | 56 ms | 66 ms | 112 ms | 96.3% | ✅ |
| FID | 163 | 5 ms | 8.5 ms | 34 ms | 99.4% | ✅ |
| CLS | 137 | — | — | — | 78.1% | see §4 (values invalid) |

**Trend is worsening.** Autocaptured `$web_vitals` weekly LCP p75: 1,794 ms (wk 09-07) →
**3,108 ms** (09-14) → **4,556 ms** (09-21). Custom-event LCP p75 for the last 7 days is
**4,373 ms with only 21% good** vs 2,831 ms / 70% good for the 23 days before. The alert
value on 09-28 was 2,846 ms.

Per-page LCP p75 (typed `query-web-vitals`, 30d) — 6 poor / 12 needs-improvement / 12 good:

| Page | LCP p75 | Rating |
|---|---:|---|
| /dashboard | **4,959 ms** | poor |
| /maintenance/:id/edit | 4,752 ms | poor |
| /projects/:id (worst two) | 4,624 / 4,064 ms | poor |
| /assets/roi | 4,076 ms | poor |
| /assets/models/:id (one) | 4,036 ms | poor |
| /availability | 3,526 ms | needs improvement |
| /overbookings | 3,387 ms | needs improvement |
| /today | 3,343 ms | needs improvement |
| /crew | 3,062 ms | needs improvement |
| /projects | 2,998 ms | needs improvement |
| /login | 2,283 ms | good |
| /warehouse | 1,879 ms | good |
| /finance | 1,684 ms | good |
| /assets/registry | 695 ms | good |

By route on the custom event: `/dashboard` n=64 p75 3,384 ms (11 poor / 36 good);
`/projects/:id` n=27 p75 **3,884 ms** (7 poor / 8 good); `/projects` n=21 p75 2,324 ms;
`/login` n=47 p75 2,238 ms.

- **TTFB is the leading contributor.** p75 1,054 ms site-wide, **1,597 ms on `/login`**,
  1,102 ms on `/dashboard`. Desktop cold navigations are slower than mobile (TTFB p75 1,196 vs
  621 ms; FCP 1,808 vs 982 ms) — a network/route-to-origin cost, not device power. Reloads are
  worse than navigations (LCP p75 3,280 vs 2,659 ms).
- **INP is healthy** everywhere except `/crew/:id` (244 ms, needs improvement).
- **CLS** (autocaptured `$web_vitals`, which carries correct values): poor on `/crew/:id`
  (0.349), `/assets/categories/:id` (0.334) and one project page (0.288); needs improvement on
  `/projects/:id` (0.230–0.238), `/warehouse/:id` (0.236), `/settings/calendars`,
  `/assets/registry`, `/overbookings`. Site-wide weekly p75 crossed 0.1 in the 09-14 week
  (0.107). The CWV combined-ratio alert (INP/160 + CLS/0.08) reads **1.747**, almost entirely
  from the CLS term.

This is the same picture as the R-8.9.3 exception in [`docs/exceptions.md`](../exceptions.md)
(client-rendered dashboards waiting on a Convex round-trip chain). **That exception expired
2026-08-25** and the signal has got worse since, not better.

### 2.2 Server: Convex op latency (T-P6: 300 ms API, 1 s incident)

`convex_op_latency` only fires for ops **over 300 ms**, so every figure below is the slow
tail, not the whole population. 30d: **41,198 events, 6,918 (16.8%) over the 1 s incident
line.** Alert value 09-28: p95 **1,384 ms**.

| Period | Kind | n | p50 | p95 | Incident % |
|---|---|---:|---:|---:|---:|
| 7d | query | 9,723 | 694 ms | 1,418 ms | 14.7% |
| 7d | mutation | 1,278 | 425 ms | 824 ms | 2.1% |
| 30d | query | 33,680 | ~705 ms | ~1,455 ms | 19.8% |
| 30d | mutation | 7,523 | ~450 ms | ~910 ms | 3.0% |
| prior 30d | query | 24,282 | 712 ms | 1,451 ms | 21.8% |

Every captured query sits on a **~670–700 ms floor regardless of shape** — the fixed
app-server ↔ Convex Cloud round-trip the runbook already identified, unchanged since July.

Top ops by volume (30d):

| Op | n | p50 | p95 | Incident % | Note |
|---|---:|---:|---:|---:|---|
| `apiKeys:getByTokenHash` | **11,923** | **996 ms** | 1,519 ms | **48.2%** (prior 37.6%) | API bearer auth, 24/7 |
| `projects:getById` | 9,336 | 695 ms | 783 ms | 0.8% | **2.1× prior period** |
| `apiKeys:touchLastUsed` | 7,304 | 444 ms | 910 ms | 2.9% | paired with row 1 |
| `orgSettings:getByOrg` | 2,908 | 666 ms | 739 ms | 0.9% | |
| `crewAssignments:list` | 1,541 | 439 ms | 816 ms | 0.9% | 1.8× prior |
| `crewMembers:getByIcalToken` | 1,422 | 788 ms | 1,498 ms | **36.1%** | iCal feed polling, 24/7 |
| `crewRoles:list` | 1,081 | 694 ms | 759 ms | 0.5% | |
| `overbooking:bundle` | 721 | 447 ms | 923 ms | 3.1% | |
| `orgSettings:getByIcalToken` | 396 | 722 ms | 1,448 ms | **29.3%** | new since 09-14 |
| `models:list` | 195 | 688 ms | 1,214 ms | 25.1% | |
| `oauthClients:getById` | 92 | 692 ms | 1,473 ms | 25.0% | |
| `miraOrgSettings:getForOrg` | 83 | 662 ms | 1,331 ms | 14.5% | |

Three things stand out:

1. **A machine client dominates the server tail.** `apiKeys:getByTokenHash` runs at a flat
   69–105 per UTC hour across all 24 hours (≈ one API bearer-auth every 4–5 minutes, 24/7),
   independent of human activity. It is both the highest-volume op and the slowest (p50
   ~1 s for what should be an indexed point read), and alone accounts for most of the
   incident count that keeps the T-P6 alert red. It has been present the whole 60-day
   window at similar volume. Identify the key via `apiRequestLog` / Settings → API keys and
   check what it polls; then profile why the token lookup is 300 ms slower than every other
   point read (per-request agent client construction and token verification are the obvious
   suspects — `src/lib/api/agent-client.ts`, `src/lib/api-key.ts`).
2. **`projects:getById` volume stepped up on 09-20** from ~100–380/day to 450–765/day and has
   stayed there (758 on 09-20, 765 on 09-24, 613 on 09-27) while human pageviews fell. It
   coincides with the 09-19/09-20 merge batch. Something server-side now re-fetches project
   detail far more often per interaction — worth checking the Convex function dashboard for
   the caller.
3. **Five-minute stalls.** Max durations of 300,785 ms (`projectManagers:listByUserId`,
   09-21), 300,317 ms (`projects:getById`), 283,487 ms (`crewShifts:listByAssignmentIds`) —
   ~300 s is a request timeout, not a slow query. They are rare (single digits) but each one
   is a hung page for a user.

The iCal feed pair (`crewMembers:getByIcalToken` + `orgSettings:getByIcalToken`) still shows
29–36% of calls over 1 s despite the #862 `max-age=300` fix; external calendar clients are
polling regardless of the cache header, and each poll runs the full read chain.

### 2.3 Server: Prisma slow queries (T-9: p95 < 100 ms, 1 s incident)

`slow_query` fires for queries **over 100 ms**. 30d: 875 events, 45 (5.1%) over 1 s. Alert
value 09-28: p95 **1,093 ms** (prior 30d p95 was 2,366 ms — the tail improved after the
#802–#804 JWKS/login caches, but not below the line).

| Model.op | n | p50 | p95 | Incident % |
|---|---:|---:|---:|---:|
| `SsoProvider.findMany` | **498** (57%) | 260 ms | **1,203 ms** | 9.0% |
| `User.findUnique` | 135 | 128 ms | 248 ms | 0% |
| `Jwks.findMany` | 96 | 312 ms | 641 ms | 0% |
| `Organization.findUnique` | 66 | 133 ms | 291 ms | 0% |
| `Member.findFirst` | 26 | 138 ms | 355 ms | 0% |
| `Session.findFirst` | 22 | 144 ms | 577 ms | 0% |

Entirely **auth-path** (Better Auth tables). Volume tracks human activity (153 on 09-14 vs
1–7 on quiet days), so this is per-login/per-session cost, and `SsoProvider.findMany` is the
only query that ever crosses 1 s — the 60 s in-process cache from #803 covers
`getOrgLoginInfo` but not whichever other call site still issues it uncached.

### 2.4 Vendor usage (T-P4)

Negligible: 10 `vendor_usage` events in 30d — Maps autocomplete 6 + place details 3 (week of
09-14), Resend 1 send (week of 09-21). Nowhere near the 2,400 sends/mo or $12/mo Maps lines.
Only one Resend send was recorded in 30 days; if notification emails did go out in that
time, the scheduled path's emit (`convex/emailActions.ts` → `convex/lib/vendorUsage.ts`) isn't
reaching PostHog — worth a one-off check against Resend's own dashboard.

## 3. Errors & reliability

- **Client-side exceptions: 0** in 30d (and 0 in 7d). All 70 `$exception` events are
  server-side (`posthog-node`, `$exception_handled=true`).
- **Crash-free sessions: 100%** (127 sessions with a pageview, 0 with an exception). The
  T-13 insight reports 100 and is not firing. (The `unique_session` formula version reads
  99.22% only because server exceptions carry an empty session id that counts as one
  session.)
- **One incident: 2026-09-16 07:28 → 09:46 UTC (2h20m), 60 occurrences, 4 fingerprints.**
  `BetterAuthError` "Prisma schema mismatch" — missing columns `user.banExpires`,
  `session.impersonatedBy`, `twoFactor.verified/failedVerificationCount/lockedUntil`,
  `jwks.alg`, `jwks.crv`. Hit `/api/auth/[...all]` (28), `/api/calendar/[token]/[feed]` (10),
  `/api/v1/oauth/token` (4), `/dashboard` and `/projects` GET (4 each). Consistent with a
  Better Auth upgrade whose migration ran ~2 h after the new image went live (migrations run
  at container start per `docker-entrypoint.sh`, so the likely cause is a failed/late first
  boot). Self-resolved; **the 4 issues are still "active" and unassigned in PostHog.**
- Remaining 10 occurrences: "No active organization" ×7 (`requireOrganization`, 08-11 →
  09-11, `/dashboard` and `/projects` POST — a session with no active org hitting a server
  action; a UX gap rather than a crash), one Convex `InternalServerError`, one
  `TypeError: fetch failed` (09-21), one `ConvexError: Server Error` (09-16) — all on the
  iCal route and all single occurrences.
- **No error-tracking alerts are configured** (0 of the internal-destination kind), so a
  repeat of the 09-16 incident would only be noticed via the crash-free alert, which does not
  see server exceptions.

## 4. Instrumentation findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | **CLS is rounded to an integer** on the custom `web_vital` event (`value: Math.round(metric.value)`), so every CLS sample is 0 or 1 and its percentiles are meaningless. `rating` is still correct; `$web_vitals` autocapture carries the true value. | Bug | `src/components/providers/posthog-provider.tsx:112` |
| 2 | `convex_op_latency` never carries `request_id` in practice — `getAmbientRequestId()` is only populated inside `withValidatedBody` handlers, and most Convex calls originate from server components/actions outside it. The cross-service correlation R-8.9.6 describes does not exist in the data. | Gap | `src/lib/convex-op-timing.ts:42` |
| 3 | The 8 observability insights (CWV ×4, crash-free, convex_op_latency, slow_query, queue_lag) sit on **no dashboard**; the only dashboard is PostHog's starter. | Hygiene | PostHog |
| 4 | `queue_lag` has 0 events. This is **correct** (it only fires past a 5-minute lag), i.e. the webhook queue has never lagged — but the T-P7 insight is therefore permanently empty and can't distinguish "healthy" from "not emitting". | Note | `src/lib/queue-lag-timing.ts` |
| 5 | The R-8.9.3 exception covering the LCP / `convex_op_latency` alerts **expired 2026-08-25**; both alerts are still firing. Per §15 an expired exception is an audit failure. | Policy | `docs/exceptions.md` |
| 6 | Project settings have autocapture web vitals, session recording (30d retention), heatmaps and console-log capture **enabled on the PostHog side**; the SDK config disables them so nothing is captured, but the project-level toggles contradict the PII posture in `docs/pii-inventory.md`. | Hygiene | PostHog project settings |
| 7 | `metric-list` (governed metric catalog) is unreadable with the current MCP key scope, so none of the numbers here are canonical PostHog metrics. | Note | PostHog API key scopes |

## 5. Alert state (2026-09-28 01:00 UTC check)

| Alert | Threshold | State | Value |
|---|---|---|---:|
| Crash-free sessions (T-13) | < 99.5% | ✅ not firing | 100 |
| LCP p75 (T-7) | > 2,000 ms | 🔴 firing | 2,846 ms |
| CWV combined INP+CLS ratio (T-7) | > 1.0 | 🔴 firing | 1.747 |
| convex_op_latency p95 (T-P6) | > 1,000 ms | 🔴 firing | 1,384 ms |
| slow_query p95 (T-9) | > 1,000 ms | 🔴 firing | 1,093 ms |

LCP and `convex_op_latency` have been red continuously since 2026-07-22 (runbook); the other
two were also firing at every check this week.

## 6. Recommendations (priority order)

1. **Identify and tame the 24/7 API-key poller.** One key is generating ~12k token lookups a
   month at ~1 s each and is the largest single input to the T-P6 alert. Find it in
   `apiRequestLog`, confirm it needs a 4–5 minute cadence, and profile
   `apiKeys:getByTokenHash` — a point read should not sit 300 ms above every other query.
2. **Fix the CLS rounding bug** (one line: keep 3 decimals for CLS, or send `metric.value`
   unrounded and round only the ms metrics). Until then, read CLS from `$web_vitals` only.
3. **Re-decide the LCP/TTFB work.** The expired R-8.9.3 exception needs either a renewed,
   dated entry or the SSR/streaming project it deferred. The data now points at TTFB
   (`/login` 1.6 s, `/dashboard` 1.1 s p75) as much as at client rendering — check the
   Coolify host's route to AU users and Cloudflare caching of `/api/auth/jwks` before
   rewriting dashboards. `/dashboard`, `/projects/:id` and `/maintenance/:id/edit` are the
   pages to measure against.
4. **Find the `projects:getById` caller** behind the 09-20 step change (2.1× volume with
   fewer users) — it is a per-interaction re-fetch that didn't exist before that week's
   merges.
5. **Investigate the 09-16 auth incident's deploy ordering** (migration ran ~2 h after the
   new image served traffic) and add a server-exception alert so the next one is noticed
   in minutes, not found in a report. Resolve/assign the 4 stale issues in PostHog.
6. **Put the 8 observability insights on one "Flow health" dashboard** so the alert values
   above are visible without opening each insight.
7. **Track acquisition, not just retention.** With 2 users and 0 signups the onboarding
   funnel instrumentation is idle; the useful usage signal for now is per-feature adoption
   (crew, kits, clients, warehouse are near-zero) rather than the funnel.
