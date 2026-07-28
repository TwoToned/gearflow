# RVLT Flow Roadmap

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Operational roadmap for RVLT Flow, the AV/theatre rental-management platform for
Two Toned Productions. This document sequences known work into priority phases.
It is the parent index above the individual design docs in `docs/designs/`.

## How to read this

- **Phases** are priority bands. Ship them roughly in order.
- **Within a phase**, items are listed in dependency order — do them top to bottom.
- **Effort** is human-team scale: `S` (< 1 week), `M` (1–2 weeks), `L` (3–4 weeks),
  `XL` (multi-month). AI-assisted build time is a small fraction of this.
- Each phase item is a candidate for its own `/autoplan` run — one feature, one
  plan, one review pipeline. Do not batch unrelated items into a single plan.
- Finance repositioned (2026-07-26): **RVLT Flow owns the quoting pipeline and
  invoice generation** — quotes, deposit / partial-payment / final invoices.
  Xero (and later other finance apps) owns the ledger, payment collection, and
  reconciliation, fed via integrations starting with Xero. This supersedes the
  earlier "Xero owns invoices, payments, quotes, GST" stance (recorded in
  `docs/designs/app-cleanup-unification.md`). Tracking: issue #934.

## The big reframe

The backlog reads as ~14 separate items, but five of them are a single organism —
**how equipment gets onto a project and flows through the warehouse**:

- Groups & categories management on projects
- Delivery docket + pick slip
- The checkout duplication bug
- Bulk check-in
- Child assets / accessories

They all read and write the same project line-item model. Built piecemeal, that
model gets reworked five times. They are therefore planned as **one program**
(Phase 1), model-first: fix the data model once, then the features land cleanly
on top of it.

---

## Phase 0 — Stop the bleeding

Small, isolated, do now. No dependency on anything else.

### 0.1 — Checkout duplication bug → promoted to the fulfillment-model rework
**Effort:** L (was estimated S) · **Status:** ✅ Shipped v0.7.0.0 (patched v0.7.0.1)
Scanning units to deploy them produces one project line-item row per physical
unit instead of one per ordered line — the docket and project screen fragment.
Investigated and `/autoplan`-reviewed: this is **not** an acute bug, it is the
one-asset-per-`ProjectLineItem`-row data model showing through. The fix is the
order-line / fulfillment-unit split — effectively item 1.2 pulled forward.
Design: [`docs/designs/archive/line-item-fulfillment-model.md`](./designs/archive/line-item-fulfillment-model.md).
A multi-week, 4-phase build; it superseded a render-only patch.

### 0.2 — iCal timezone correctness ✅ Shipped v0.7.1.0
**Effort:** S
Crew calendar feeds showed wrong times in Google Calendar — a timezone offset
bug. Root cause: `formatICalDate` used server-local time and emitted unanchored
floating-time DATE-TIMEs. Fix: TZID + VTIMEZONE block anchoring (AU, NZ, UK,
US zones, UTC fallback), UTC DTSTAMP per RFC 5545, `Intl.DateTimeFormat`-based
tz conversion (no new deps), org timezone read from `OrgSettings.timezone`.
16 regression tests in `src/lib/ical.test.ts`. See
[FEATUREDOCS/31](../FEATUREDOCS/31-crew-management.md) for the library
reference.

---

## Phase 1 — Project & Warehouse Fulfillment

**The priority program.** This is where daily friction lives. Model-first: land
the data-model changes, then the features fall out cleaner. The proper fix for
the Phase 0 checkout bug folds in here.

Related design docs (shipped, archived): `docs/designs/archive/warehouse-checks.md`,
`docs/designs/archive/pdf-template-builder.md`.

### 1.1 — Child assets / accessories
**Effort:** L · **Depends on:** nothing (data-model foundation)
Attach serialised and bulk assets to other serialised assets — an IEC cable on a
mixer, an adaptor on a JAG headset mic, two clamps and a TrueCon on a light.
Foundational: it unlocks the good version of bulk check-in (1.3).

### 1.2 — Groups & categories on projects
**Effort:** L · **Depends on:** 1.1 (shared line-item model pass)
The clunky core. Managing assets on a project — grouping them, categorising
them, moving them between groups, setting pricing — currently takes ages and
forces delete-and-redo for small changes. Goal: every action available on every
line type (serialised asset, sub-hire, custom item); fast, smart creation of
groups/categories; drag/move between them; inline repricing. No destructive
churn for routine edits.

### 1.3 — Bulk check-in
**Effort:** M · **Depends on:** 1.1
A full-checklist check-in screen instead of the broken-down per-item view. For
child/bulk assets, show the total quantity due back on the job (50 lights = 100
clamps + 50 TrueCons) and let the operator enter how many are physically in
front of them and check that count in at once — no per-light drill-down.

### 1.4 — Delivery docket + pick slip
**Effort:** M · **Depends on:** 1.2 · **Status:** substantially shipped
Rework both documents to be group/category-aware. Make the pick slip actually
make sense for packing; make delivery-docket categorisation smarter. Ties
directly to the corrected checkout logic from 0.1 / Phase 1.
`expandProjectGroups`/`packerSort`/sub-hire-group-awareness are live in
`src/lib/pdfme/build-document-data.ts`/`structure-line-items.ts` — see
[`docs/designs/archive/pick-list-delivery-docket-grouping.md`](./designs/archive/pick-list-delivery-docket-grouping.md).
Remaining follow-ups are tracked in `TODOS.md`.

---

## Phase 2 — Crew & Services

A separate organism from fulfillment. Tackle after Phase 1.

### 2.1 — Service & crewing overhaul
**Effort:** XL
Rethink service management and crewing from the ground up — smarter scheduling,
tighter integration between services, crew assignments, availability, and
projects. "Think big" rework, not an incremental patch. Worth its own design doc
before any build. (iCal correctness already handled in Phase 0.)

---

## Phase 3 — Feature expansion

Net-new capability. Valuable, but not daily-pain — sequence after the core
workflows are solid.

### 3.1 — Project todo lists
**Effort:** M
Add Asana-style todo/task lists to projects so project management lives in
RVLT Flow instead of scattered across chat and email.

### 3.2 — Public API
**Effort:** L
A documented API for users to programmatically pull data from and drive
RVLT Flow. Needs API-key authentication, rate limiting, versioning, and reference
docs. Recommend shipping **read-only v1 first** (a much smaller, lower-risk
surface) and adding write endpoints once the read API has real users. API
reference docs belong with the user guide (see Continuous tracks).

### 3.3 — Finance as a first-class, version-controlled workflow
**Effort:** L · **Tracking:** [#985](https://github.com/TwoToned/gearflow/issues/985)
(sub-issues #986–#990)
WS1 (#940) shipped the finance *entities* and #957 shipped the lock *enforcement*;
neither built the workflow or the UX. This program adds quote revisions on a single
shared `projects.revision` counter (project v2 == quote v2), immutable stored PDF
artifacts so a sent quote is actually reproducible, a top-level Finance tab that owns
send / new-version / accept / invoice, and lock UI that is visible before you try
rather than a toast after you've tried. Design:
[`docs/designs/finance-first-class-version-control.md`](./designs/finance-first-class-version-control.md).

---

## Phase 4 — Experience pass

Polishing a clunky workflow is backwards — fix the flow first (Phases 1–2), then
make it feel right. Phases 1 and 2 already remove most of the structural
clunkiness; this phase is the consistency-and-flow sweep across everything else.

### 4.1 — UX / flow overhaul
**Effort:** L · **Status:** in progress
`docs/designs/ux-ui-redesign.md` is the approved CEO-plan decisions record;
[`docs/designs/rvlt-polish-sweep.md`](./designs/rvlt-polish-sweep.md) is the
live, chunk-by-chunk execution tracker against it (most chunks done as of
2026-07-17) — start there for current status, not just the original plan doc.

### 4.2 — Mobile overhaul
**Effort:** L · **Depends on:** 4.1 · **Status:** substantially shipped
The warehouse runs on phones, so mobile quality is semi-operational, not pure
polish. The CHANGELOG v0.24.0.0–v0.24.15.0 sweep already converted every
operator-facing list table to cards on mobile — see
`docs/designs/archive/mobile-first-redesign.md` and
`docs/designs/archive/mobile-data-table-framework.md`. Remaining mobile work
should be scoped against what those docs didn't cover, not restarted.

---

## Continuous tracks

These run alongside the phases, not as standalone sprints.

### Dev & Claude documentation
**Effort:** M · **Cadence:** start alongside Phase 1, keep current
Overhaul and then maintain `CLAUDE.md`, `ARCHITECTURE.md`, and `FEATUREDOCS/`.
Every feature after this is built by Claude reading these docs — stale docs tax
every future task. High-leverage, compounding. Do it early.

### User guide
**Effort:** M · **Cadence:** parallelizable, can be delegated
End-user documentation, separate audience from the dev docs. A separate
Docusaurus repo is the right call. Can run as a background track. Eventually
hosts the Phase 3.2 API reference.

### Codebase tidy-up
**Effort:** ongoing · **Cadence:** folded into every phase
Not a standalone project — it has no done-state and no user-visible outcome.
When a phase touches a file, that file gets tidied. Refactoring rides along with
feature work; it never gets its own sprint.

---

## Sequencing summary

```
Phase 0  Stop the bleeding        ──► now (this week)
            │
            ├─ Dev/Claude docs refresh starts here ──────────────┐
            ▼                                                    │ continuous
Phase 1  Project & Warehouse Fulfillment  ──► the priority        │
            ▼                                                    │
Phase 2  Crew & Services                                         │
            ▼                                                    │
Phase 3  Feature expansion (todo lists, API)                     │
            ▼                                                    │
Phase 4  Experience pass (UX, mobile)                            │
                                                                 │
User guide (Docusaurus) ── parallel background track ────────────┘
```

## Open decisions

- **API scope (3.2)** — confirmed: external programmatic access for users.
  Recommendation is read-only v1 first; revisit write scope after read ships.
- **UX redesign (4.1)** — confirmed: a holistic "fix the clunk" pass.
  Audit `ux-ui-redesign.md` before building so it extends, not restarts.
- Phase boundaries are guidance, not contracts. If Phase 2 crewing pain proves
  sharper than expected, it can jump ahead of late Phase 1.
