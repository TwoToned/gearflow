# Phase 0 — Measurement Baseline & Methodology

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The autoplan review made measurement the gating Phase 0: the plan ranks fixes "by inspection"
with no numbers, so we cannot prove the dominant cost or know when a phase has paid off. This
doc defines **what to capture, how, and the exit targets** each later phase is measured against.

## Why this exists (review finding C1, both CEO voices, CRITICAL)
- The dominant-cost premise ("whole-org `.collect()` is the #1 driver") is plausible and the
  `file:line` evidence is real, but call-**count** fan-out vs payload-**size** are different
  problems with different fixes. Only measurement disambiguates.
- Source of truth = the **Convex dashboard** for deployment `groovy-koala-475` (dev) /
  `useful-cuttlefish-334` (prod). This app does **not** use PostHog.

## Hot flows to baseline
Capture each on a representative org (real-ish data volume), one run, steady state:

| Flow | How to trigger |
|------|----------------|
| F1 Open kit detail | navigate to `/kits/[id]` |
| F2 Edit one kit field | rename a kit / toggle a field, observe refetch |
| F3 Open asset list | navigate to `/assets/registry` |
| F4 Open project detail | navigate to `/projects/[id]` |
| F5 Warehouse checkout loop | check out N items on `/warehouse/[projectId]` |
| F6 Warehouse check-in (bulk) | bulk return |

## Metrics per flow (from the Convex dashboard → Functions / Insights)
For each function invoked during the flow, record:
- **function-call count** (how many Convex function executions the one user action caused)
- **documents read** + **bytes read** per call (and summed)
- **p50 / p95 execution latency**
- **# reactive re-runs after ONE mutation** (the "every tiny thing" signal — F2 especially)

Also client-side: time-to-interactive for the navigation (browser devtools / `performance`).

## Exit targets (fill the "before" column at baseline; "after" gates each phase)
| Flow | Metric | Before | Target (after) |
|------|--------|--------|----------------|
| F2 kit edit | detail refetches per edit | _(expect 2)_ | ≤ 1 |
| F2 kit edit | docs read per edit | _( )_ | drop ≥ 80% (entity-scoped) |
| F1 kit detail | docs read on load | _( )_ | O(kit), not O(org) |
| F3 asset list | docs read on load | _( )_ | O(page), not O(org) |
| F3 asset list | re-runs after 1 asset status change | _( )_ | only loaded pages, not whole table |
| F5 checkout | Convex calls per item | _( )_ | no 2–3× re-reads of same lines |

## How to capture (autonomous-friendly)
1. **Convex dashboard (manual, human):** the authoritative numbers (bytes/p95) require the
   dashboard UI — capture these in the morning before/after each phase.
2. **Scriptable call-count (CI-friendly):** the integration tests already run every warehouse
   flow against the live dev deployment via the Proxy in `tests/helpers/integration.ts`. A
   call-count baseline can be approximated by counting `api.*` invocations a server action
   makes (instrument `getConvexClient()` to tally `.query`/`.mutation` calls per flow). This
   is added as a follow-up harness, not a blocker — the dashboard is the source of truth.

## Re-measurement gate (after Part 1 ships)
Compare against targets. **If F1–F4 navigation/edits already feel instant and hit targets,
Part 2 (instant-feel: cache/prefetch/optimistic) is CANCELLED.** Only a measured residual
perceived-latency gap re-opens it.
