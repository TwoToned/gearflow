# Registered thresholds & budgets (POLICY.md R-0.4)

The authoritative registry of the numeric budgets/SLOs POLICY.md §8–9 requires. Values
marked **⟨default⟩** are provisional placeholders chosen by the maintainer to satisfy
"registered, not document-only"; tune them against real data. Alerting on these is wired
through **PostHog** (see "Backend" below) — a registered threshold with no alert yet is
still "registered" per the rules, but only "enforced" once its PostHog alert exists.

**Backend:** metrics + alerting → **PostHog** (`POSTHOG_KEY` on Coolify; browser analytics
also needs `NEXT_PUBLIC_POSTHOG_KEY`). Error tracking + source maps → currently Sentry;
planned to consolidate onto PostHog Error Tracking (#650).

**Context:** single-user, all-free-tier app today, so budgets = the free-tier ceilings
(alert *before* the paywall) and SLOs are provisional until there are real users.

---

## Machine-enforced already (blocking CI gates)

| Budget | Value | Gate | Rule |
|---|---|---|---|
| Bundle — entry-route First Load JS (gzip) | 347 KB baseline, fail +5% | `bundle-ratchet` (Build job) | R-8.1.5 / T-8 |
| CSS (gzip) | 50 KB | `size-limit` | R-8.7.5 / T-8 |
| Test coverage | 48% floor (ratchet) | `test:coverage` | R-8.8 |
| Dead code | ≤ baseline (481) | `knip-ratchet` | R-4.2 |
| Unbounded org reads | ≤ 0 unjustified | `collect-ratchet` | R-9.8 |
| `any` count | ≤ baseline | `any-ratchet` | R-8.2.2 |

## Registered, alert pending (needs the PostHog alert wired)

### Interactive latency budget — T-9 (R-8.3.2, #643) ⟨default⟩
p95 of the interactive path, measured via PostHog performance events:
- Convex **query** (interactive read): **p95 ≤ 500 ms**
- Convex **mutation** (write): **p95 ≤ 1000 ms**
- Full interaction (click → UI settled): **p95 ≤ 1500 ms**

*Opinion/rationale:* Convex adds a WS round-trip and the app already did round-trip-bundling
perf work, so 500 ms reads / 1 s writes are comfortable-but-honest — snappy enough that a
regression is a real UX problem, loose enough not to false-alarm on a cold function. The DB
`statement_timeout` (30 s) is the hard blast-radius cap; this is the *quality* budget under it.

### Queue-lag / job age — T-P7 (R-9.10, #660) ⟨default⟩
Age of the oldest un-processed scheduled job (Convex scheduler / crons):
- **User-facing** (emails, notifications): oldest pending **> 15 min → alert**
- **Background** (dashboards recompute, backfills): oldest pending **> 60 min → alert**

*Opinion/rationale:* an invite or overdue-return email that sits for >15 min feels broken to
the recipient, so that queue should be near-real-time; background rollups can lag an hour
without anyone noticing. Both are well inside the dead-letter window, so this catches "stuck,
not yet dead."

### Per-endpoint SLOs — T-P6 (R-8.9.6, #651) ⟨provisional⟩
No formal SLO yet — **single user**. Provisional default target to activate at the first real
users: **99.0% availability**, **p95 < 1 s** per interactive endpoint. Revisit at first
paying customer.

### Cost budgets — T-P4 (R-9.12, #661) ⟨free-tier ceilings⟩
On free tier the budget *is* the free-tier quota; alert at **80%** so there's time to
optimize or upgrade before hitting the wall:

| Service | Free-tier quota (approx — verify current) | 80% alert |
|---|---|---|
| Convex | ~1M function calls / mo, 0.5 GB DB, 1 GB files | 800k calls / 0.4 GB / 0.8 GB |
| Google Maps | $200 / mo credit | $160 |
| Resend | 3,000 emails / mo (100 / day) | 2,400 / mo (80 / day) |
| PostHog | 1M events / mo | 800k events |

### 80%-of-budget alerting — R-9.2 (#656)
Every *continuous* budget above alerts at **80% of its limit** (the cost table already bakes
this in). Wired via PostHog once the metrics land.

### Perf-regression defect workflow — R-9.5 (#657)
**Owner: Jayden.** A perf regression caught by a gate (bundle-ratchet, or a PostHog CWV/latency
alert) is filed as a GitHub issue labelled `perf` and triaged like any defect (R-14).

### Sourcemap / release tagging — R-8.9.2 (#650)
**Pending:** migrate error-tracking from Sentry to **PostHog Error Tracking**, then make the
`posthog-cli sourcemap` upload + release tag a mandatory (fail-if-absent) pipeline step.

---

_Review at each quarterly sweep (§12). Replace ⟨default⟩/⟨provisional⟩ values with measured
targets as real usage data accrues._
