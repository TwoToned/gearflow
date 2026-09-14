# Activation Checklist

> Part of the multi-tenant/onboarding program (tracking #1063, Phase D: #1069). Design:
> [`docs/designs/onboarding-and-activation.md`](../docs/designs/onboarding-and-activation.md) §7.1-7.2.
> Mockup: [`docs/designs/mockups/onboarding-mockup.html`](../docs/designs/mockups/onboarding-mockup.html)
> screen 7.

The dashboard's "Get started" card (D1, #1105) — the tour that keeps up when someone ignores it.
Lives beside [the setup checklist](./71-org-setup-wizard.md#c6---finish-setup-checklist-1104)
(C6, #1104), never merged with it: setup is "configure the company" (currency, branding,
location, team), activation is "do the work" (add gear, book a job, put the gear on it).
Different job, different lifetime — a fresh org sees both cards at once.

## Four milestones, all derived — never stored

| # | Milestone | Derivation |
|---|---|---|
| 1 | First model | org has ≥1 `Model` |
| 2 | First asset | that model has ≥1 `Asset`/`BulkAsset` |
| 3 | First project | org has ≥1 `Project` where `isTemplate: false` |
| 4 | Model on project | that project has ≥1 line item referencing a model |

`convex/activationMilestones.ts`'s `state` query computes all four on every read from the org's
real `models`/`assets`/`bulkAssets`/`projects`/`projectLineItems` rows — nothing is cached or
progressed step-by-step. This is what makes the tour **deviation-tolerant** (same R-3.1 rule as
C6's checklist): an operator who ignores every prompt and adds five models by hand finds the
card already ticked when they next open the dashboard. Nothing to reset, resume, or desync.

"First" model/project is the **oldest** row in the org, not literally "the one the tour pointed
at" — Convex appends `_creationTime` as the implicit final tiebreaker on every index, so
`by_organizationId` in its default ascending order already returns it. No new index needed for
either lookup.

Two lookups can't use a plain indexed `.first()`:

- **"org has ≥1 non-template project"** has no compound `by_organizationId`+`isTemplate` index,
  and the existing `dashboardCounters.activeProjects` counter is a false friend here — it also
  excludes DRAFT/QUOTED/COMPLETED/CANCELLED projects (only `CONFIRMED`/`PREPPING`/`CHECKED_OUT`/
  `ON_SITE` count), so a brand-new DRAFT project (the normal state right after creation) would
  read as zero. `firstNonTemplateProject()` instead does a `for await` scan over
  `by_organizationId` ascending, returning the first row whose `isTemplate !== true` — per the
  Convex guidelines, `for await` iteration (not `.collect()`/`.take()`) is the sanctioned
  early-exit pattern, so this doesn't count against the repo-wide collect-ratchet either.
  Since this query is reactive on the dashboard's hot path, the scan is capped at
  `MAX_TEMPLATE_SCAN` (200) rows — an org that front-loads hundreds of templates before its
  first real project reads the milestone as "not yet done" past the cap rather than paying an
  ever-growing per-view read cost (the safe direction: this card only exists pre-activation, and
  an org with that many templates has almost always already created a real project and moved
  past this card).
- **"that project has ≥1 line item referencing a model"** — `projectLineItems.by_projectId` isn't
  filterable by `modelId` in the index range, so `hasLineItemReferencingModel()` is the same
  `for await` early-exit scan, bounded to one project's own line items.

`hasAssetForModel()` checks `assets`/`bulkAssets` by `by_modelId` with `.first()` on each in
parallel — a real asset can be either serialized or bulk, so both tables are checked and either
one satisfies the milestone.

## The card

`src/components/dashboard/activation-checklist.tsx`'s `ActivationChecklist` — four rows, an
honest "About 5 minutes. Pick up wherever you left off." label, and a permanent dismiss. Renders
nothing while loading, once dismissed, or once all four milestones are complete (same
disappears-for-good rule as C6's card).

**The active row (the first not-yet-done milestone) carries the next action inline** — a button
like "Add an asset" — rather than a separate CTA block, per #1105's explicit UI requirement. Rows
after the active one show no CTA at all (nothing to do yet); a done row shows the milestone's
actual value in a small mono chip (e.g. the model's real name) instead of a generic checkmark, so
the row reads as a fact rather than a scoreboard. CTA targets are the real creation routes, not a
wizard step — there is one place each of these things is actually done:

- Model → `/assets/models/new`
- Asset → `/assets/registry/new?modelId=<firstModelId>` (prefills the model via the registry
  form's existing `preselectedModelId` support)
- Project → `/projects/new`
- Line item → `/projects/<firstProjectId>?tab=equipment` (the project detail page's Equipment tab
  is where line items live)

## The dismissal — its own table, not a reuse

The one persisted bit is `orgActivationDismissals` (`convex/schema.ts`), its own tiny mutations
module (`convex/orgActivationDismissalsWrites.ts`, file-for-file identical shape to
`orgSetupDismissalsWrites.ts`) with its own write-kill-switch domain (`"org-activation"`, not
`"org-setup"` or `"notifications"`). Same reasoning as C6's `orgSetupDismissals`: reusing
`notificationDismissals` would tie this dismissal to that table's `pruneStaleNative` GC (which
only knows about the notification bell's own keys, and would silently delete an unrelated row the
next time it runs); reusing `orgSetupDismissals` itself would tie two features with genuinely
different lifetimes to one write-kill-switch domain and one dismissal timeline. At most one row
per `(organizationId, userId)` — both ids come from the verified auth token
(`getAuthContext`/`requireSelfScope`), never a client arg, since a member only ever owns their own
dismissal.

## Copy

DESIGN.md sanctions personality only in empty states and onboarding moments, and bans it in
alert/compliance/overdue contexts. This card is squarely in the sanctioned zone: sentence case,
no mascot, no generic SaaS filler ("Manage your gear directory"). Row copy and the card's title/
subtitle are the mockup's literal strings (screen 7) — "Get started", "About 5 minutes. Pick up
wherever you left off.", "Add a piece of gear you own" / "Add a real unit of it" / "Create your
first job" / "Put that gear on the job" — dry and specific rather than generic ("gear" and "job"
throughout, never "asset inventory" or "engagement").
