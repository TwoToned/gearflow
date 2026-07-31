# Project & Rental Management

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

## Projects List Views (`ProjectTable`, `ProjectBoard`)
`ProjectTable` (`src/components/projects/project-table.tsx`) is server-side
paginated: `projects.listPage` (filter/sort/client join done in Convex) via
`useAuthedQuery`. `ProjectBoard` (kanban, `project-board.tsx`) is unpaginated —
`projects.listBoard` returns every non-template, non-cancelled project in one
query, grouped by lifecycle stage client-side (a "browse everything" view, not a
table). Both replaced whole-org live subscriptions (`useProjects`/`useClients`/
`useLocations`) that used to filter/join/sort client-side (perf fix, 2026-07 — see
`docs/designs/perf-convex-efficiency-2026-06.md` Finding #1). Per-page issue flags
and blocking-comment counts are separate reads already scoped to the current
page's project ids, unaffected by this change. `ClientsDashboard`'s own
`useProjects` call (aggregate revenue/count stats, not a list) is a known,
separate follow-up — not yet converted.

## Status Flow
```
ENQUIRY → QUOTING → QUOTED → CONFIRMED → PREPPING → CHECKED_OUT → ON_SITE → RETURNED → COMPLETED → INVOICED
                                                                                        ↗
                                           Any status → CANCELLED ─────────────────────┘
```

### Lock tiers (#957 — see FEATUREDOCS/62-project-lifecycle-locks.md)

Each status maps to one of four lock tiers, resolved by `lockTierForStatus()`
(`convex/lib/projectLocks.ts` — the single source of truth every gate site imports):

| Statuses | Tier | Gated |
|---|---|---|
| `ENQUIRY` / `QUOTING` / `QUOTED` | **OPEN** | Nothing |
| `CONFIRMED` / `PREPPING` / `CHECKED_OUT` | **FINANCE_LOCKED** | Money fields (`FINANCIALS_LOCKED` without an open unlock session) |
| `ON_SITE` / `RETURNED` | **JUSTIFY** | Above, plus structural mutations need a confirm + written justification |
| `COMPLETED` / `INVOICED` | **HARD_LOCKED** | Everything — no per-edit path, only a FULL unlock session |
| `CANCELLED` | OPEN | Ungated (open question — see FEATUREDOCS/62) |

Phase C (#988) makes the resolver take the project's quote state as a second
input (`resolveLockTier({ status, quoteState })`), so a sent quote raises the
tier without any gate site changing. Not built yet.

### Acceptance gate on CONFIRMED (#986 — see FEATUREDOCS/66)

A project may not advance to `CONFIRMED` until one of its quote revisions is
`ACCEPTED`. Confirming a job whose price the client never agreed to is the
failure the revision model exists to prevent.

Org admins/owners and the project's assigned PMs override with a bounded
justification (≥10 chars, ≤1000 — `requireJustification` in
`convex/lib/projectLocks.ts`, the same audience and bounds as #792's hard-lock
revert). The justification lands on the `STATUS_CHANGE` audit row's `metadata`.

Only an actual transition INTO `CONFIRMED` is gated — re-saving an
already-confirmed project never re-prompts. A **re-crossing** (revert to
`PREPPING`, then back) IS gated again, matching `crossesIntoSnapshotStatus`'s
own re-crossing rule: pricing may have moved while the project was reverted.

## Project revisions (`projects.revision`)

The single version counter shared by the project, its quote and its snapshot
(#986 — full model in [FEATUREDOCS/66](./66-finance-quotes-invoices-xero.md)):

```
projects.revision : number         ← the authority (starts at 1 on create)
  quotes.version  = the revision it was cut from   (one quote row per revision)
  projectSnapshots.revision                        (frozen entity state for that revision)
```

Project v2 == Quote v2 == the snapshot taken at v2. There is deliberately no
second counter (R-3.1).

**Server-owned.** Written ONLY by `createNative` (seeded to 1 — and by both
service-token create paths, including the WooCommerce order → project flow) and
`quotesWrites.newVersionNative`. It is stripped from every generic client patch
alongside `PROJECT_MONEY_ANCHORS` (`PROJECT_SERVER_OWNED` in
`convex/projectWrites.ts`) and can't be cleared: a client-settable revision
would let a browser caller renumber, skip or rewind versions, orphaning the
quote rows keyed to those numbers.

**Templates carry no revision** — they are never quoted, and a project created
from one starts its own count at 1 rather than inheriting a number. Absent reads
as 1 via `projectRevision()` (`convex/lib/quoteState.ts`), so pre-#986 documents
and any row the backfill hasn't reached behave as v1.

## Project Hierarchy
```
Project
  → ProjectCategory (top-level organiser: "RF", "IEM", "PA")
      → ProjectGroup (billable unit: title, description, qty, price)
          → ProjectLineItem (equipment tracking only, not on quote)
      → ProjectLineItem (standalone, appears as its own line item)
  → ProjectLineItem (uncategorized)
  → ProjectService (direct cost roll-up)
  → CrewAssignment (direct cost roll-up)
  → ProjectManager (multi-PM via join table)
```

## Project Wizard (`src/components/projects/project-wizard.tsx`)

A single 4-step wizard (Basics → Schedule → Site → Review) backs **create, edit,
and templates** — there is no separate flat form (the old `project-form.tsx` was
retired). Routes:
- `/projects/new` → `<ProjectWizard />` (create)
- `/projects/templates/new` → `<ProjectWizard isTemplate />` (template create)
- `/projects/[id]/edit` → `<ProjectWizard project={project} />` (edit)

**Edit mode** is engaged by passing the `project` prop (the `getProject`/
`useProjectDetail` composite, typed loosely as `EditableProject`). In edit mode:
- `defaultValues` are pre-filled from the project across all steps; stored dates
  are normalised to the form's `yyyy-MM-dd` shape via `normalizeDate`, times stay
  `HH:mm`. Existing project managers seed `managerIds`.
- One edit-only field appears that create mode hides: **Status** (basics step).
  The wizard's old "Financial" block (site step, hand-typed Deposit %/Deposit
  paid/Invoiced total inputs with no server-side math) is **REMOVED** as of
  #940 (WS1 — finance model): deposit % now lives on the **client payment
  profile** (client detail page — `paymentProfile`/`profileDepositPercent`,
  see [FEATUREDOCS/66-finance-quotes-invoices-xero.md](./66-finance-quotes-invoices-xero.md)),
  and deposit-paid/invoiced-total are derived from the project's real
  Quote/Invoice rows (Project page → Finance tab), never hand-typed here.
  **Discount (%)** moved out of that block (QW-4 / #953) to the basics step,
  always visible in both create and edit mode, right after the Client
  picker — see "Discount default cascade" below.
- Submit calls `updateProject(id, data)` and **reconciles managers** by diffing
  the initial set vs the selected set (`addProjectManager`/`removeProjectManager`
  on the delta only — no dupes, no accidental removals), then routes to
  `/projects/{id}`. The final CTA reads "Save changes".
- The next-project-number peek is skipped, and all steps are freely reachable
  (every step is already valid). Create mode is unchanged.

- **Project code is required.** Pre-filled from `peekNextProjectNumber()` (create
  only); the user accepts or overrides. `next()` blocks step 0 if blank (the Zod
  schema still allows blank for auto-gen, so the requirement is enforced in the
  wizard).
- **Step-transition focus management (R-8.1.7, #894).** Continue/Back unmounts the
  just-clicked button, so the wizard explicitly moves focus on every step change
  instead of leaving it to the browser's `document.body` fallback (WCAG "focus is
  never silently lost"). A `tabIndex={-1}` heading ("Step N: <label>") sits at the
  top of the step-content card and is focused via `stepHeadingRef` in a `useEffect`
  keyed on `step`, skipping the very first render. Step 0 is excluded from that
  effect — its Name field already carries `autoFocus`, which re-fires on every
  (re)mount (the step content is conditionally rendered, so returning to step 0
  remounts the field) and would otherwise race the heading-focus effect.
- **Schedule step — two windows (WS2 #941).** Two `RangeCalendar` blocks
  (`src/components/ui/range-calendar.tsx`, a custom date-fns range calendar — no
  external calendar dep): **Rental** (the chargeable window, `rentalStartDate`/
  `rentalEndDate` — duration preset chips: 1 day / 2 days / Weekend / 1 week) and
  **Project** (the gear-committed window, `projectStartDate`/`projectEndDate`).
  Project is **blank by default** with "(same as rental)" ghost text — it stays
  genuinely unset in the form/DB unless the user explicitly diverges it (an
  earlier load-in, a later strike); there is no auto-copy from the rental range
  (R-3.1 — a duplicated-but-in-sync value is still a defect). Per-window
  start/end times live in an optional "Project window" fine-tune accordion
  (`projectStartTime`/`projectEndTime`). A **soft (non-blocking)** hint appears
  when the project window doesn't fully contain the rental window
  (`projectStart > rentalStart` or `projectEnd < rentalEnd`) — shown inline,
  never registered as a form error, so it can't block Continue/submit. The
  legacy `loadInDate`/`loadOutDate`/`eventStartDate`/`eventEndDate` fields are
  **DEPRECATED** — the wizard reads them (pre-migration projects) but never
  writes them. See [11-availability.md](./11-availability.md) for the full
  two-window design and `getProjectWindow`.

### Discount default cascade (QW-4 / #953)

`Client.defaultDiscount` (`convex/schema.ts`) is a per-client default discount
percentage, set on the client record (`client-form.tsx`, `src/lib/client-fields.ts`).
It snapshots onto `Project.discountPercent` **at project-create time only**:

- **Server-authoritative (R-9.3).** `projectWrites.createNative` resolves it
  in-mutation: when the caller doesn't pass an explicit `discountPercent` AND the
  project has a `clientId`, it org-checked-reads the client row and stamps
  `client.defaultDiscount` (when set) onto the new project. `== null` (not a
  truthy/falsy check) decides "not provided" — an explicit `0`% discount from the
  caller always wins over the client default, never gets silently overwritten by
  it (see the `== null` auto-pricing comment in `convex/lineItemWrites.ts` for the
  same lesson applied elsewhere). This is the only place the cascade fires;
  `updateNative` has no equivalent — reassigning a project's client later does
  **not** retroactively recompute its discount.
- **WooCommerce order assembly** builds projects directly (not through
  `createNative` — see FEATUREDOCS/35 §"Order Processing" step 5), so it seeds the
  same cascade independently via `resolveWooDiscountPercent` (canonical copy in
  `src/lib/woocommerce-utils.ts`, a verbatim-copied twin in
  `convex/wooCommerceActions.ts` since Convex functions can't import from `src/`).
- **Wizard UX** (`project-wizard.tsx`, Basics step, next to the Client picker) is a
  convenience layer only — the server snapshot above is authoritative regardless
  of what the browser sends. Selecting a client prefills Discount (%) from
  `client.defaultDiscount` with a "from client default" hint; the field stays
  freely editable. Switching clients before submitting re-prefills, but **only**
  while the user hasn't touched the field themselves (`discountTouchedRef`) —
  once they type a value (including an explicit `0`), their choice sticks through
  further client changes. Opening an existing project for edit never re-prefills
  from the client's *current* default over whatever discount was actually saved
  (`prefilledDiscountForClientId` seeds from the project's original `clientId`, so
  the effect only fires on an actual client *change*, not on mount).

## Project Managers
- **Manager picker permissions (#727).** The wizard's "Project manager(s)" field
  (basics step) loads options via `getOrgMembers()`, which requires
  `orgMembers:read` — the `member` role was granted this (`fix(rbac): grant
  member role read-only access to orgMembers`) so it no longer 403s for
  `member`-role users creating projects. `useServerQuery`'s `error` is destructured
  and surfaced through `Field`'s `error` prop (not just `data`), so any future
  permission regression (or a real network failure) renders a visible "Couldn't
  load org members" message instead of silently resolving to an empty picker
  indistinguishable from "this org has no other members".
- Multi-PM support via `ProjectManager` join table (replaces old single `projectManagerId`)
- Managed on the project detail page sidebar via `ProjectManagersPanel`
- Add/remove PMs via browser-direct mutations `addNative` / `removeNative` in
  `convex/projectManagersWrites.ts`, called via `src/hooks/use-project-managers-writes.ts`
  (the old `src/server/project-managers.ts` server actions are gone)
- PMs shown as avatar row in project header

## Financial Calculations (`recalculateProjectTotals()`)
```
equipmentRevenue = SUM(group.price × group.quantity) + SUM(standalone.lineTotal)
serviceCostTotal = SUM(service.costTotal) where status != CANCELLED
labourCostTotal = SUM(assignment.estimatedCost) where assignment.serviceId IS NULL

saleRevenue = SUM(standalone SALE line.lineTotal)          -- WS11 #950
saleCostTotal = SUM(SALE line COGS) where status != CANCELLED and not optional  -- WS11 #950

subtotal = equipmentRevenue + serviceRevenue + saleRevenue
discountAmount = subtotal × discountPercent / 100
taxRate = project.taxRate ?? org.defaultTaxRate ?? 10
taxableAmount = subtotal - discountAmount
taxAmount = taxableAmount × taxRate / 100
total = taxableAmount + taxAmount

margin = total - (serviceCostTotal + labourCostTotal + saleCostTotal)   -- saleCostTotal added WS11 #950
marginPercent = margin / total × 100
```

### Tax Rate Cascade
- Per-project `taxRate` (Decimal, nullable) takes priority
- Falls back to `Organization.defaultTaxRate` (configurable in Settings)
- Falls back to 10% (GST default)

### Derived Billing Weeks/Days + Best-Price Capping (#943)
> **Correction to earlier drafts of this doc:** a "Billing Weeks/Days Pricing"
> feature (`Project.billingWeeks`/`billingDays` + a `ProjectGroup` override,
> formula `(weeklyRate × weeks + dailyRate × days) × quantity`) was documented
> here as the shipped "Primary Model". It never actually shipped in the
> running system — Prisma migration `20260326000000` added the columns,
> migration `20260617000000` dropped them again five days later ("removed in
> favour of simple auto-pricing"), and the fields never reached Convex,
> Zod, or any TS in between. The doc was simply never updated to match. A
> separate `Project.defaultRentalPeriod`/`defaultRentalQuantity` +
> `ProjectGroup.rentalPeriod`/`rentalQuantity` "legacy fallback" pair *did*
> ship and *was* the live pricing path — but nothing in the UI ever wrote
> `rentalPeriod`/`rentalQuantity` on a group either, so in practice every
> line priced at `dailyRate × qty × 1`. #943 replaces both retired
> mechanisms with the derived system below — deliberately restoring the
> *spirit* of the original weeks/days design doc, in a derived (not
> hand-entered) form, plus best-price capping.

Pure module: `src/lib/billing-derivation.ts`, byte-parity-ported to
`convex/lib/billing-derivation.ts` for code that runs inside a Convex
mutation (pinned equal by `convex/lib/billing-derivation.test.ts`). This is
the SINGLE canonical implementation — it replaced three independently
hand-duplicated copies of the "suggested group price" formula.

**Chargeable days.** `inclusiveCalendarDays(rentalStartDate, rentalEndDate)`
— calendar days, inclusive (Fri→Mon = 4 days). Either date missing → 1 day
(matches the pre-existing `duration` field's default).

**Best-price capping.** For a model with both `dailyRate` and `weeklyRate`:
```
weeks = floor(chargeableDays / 7)
remainderDays = chargeableDays % 7
uncapped = weeks × weeklyRate + remainderDays × dailyRate
capped   = (weeks + 1) × weeklyRate
perUnitCharge = min(uncapped, capped)   // capped only ever wins when remainderDays > 0
```
E.g. 6 days at $20/day vs $100/week: 6×$20=$120 > 1×$100, so it's billed as
"1 wk (capped)" for $100. A daily-only model (no `weeklyRate`) just bills
`chargeableDays × dailyRate`, never capped.

**Auto-priced line storage (the de-risked shape).** `lineTotal = unitPrice ×
quantity × duration` is UNCHANGED — every consumer of that formula (three
byte-parity copies: `convex/lib/lineTotal.ts`, the inline copy in
`convex/lineItemWrites.ts`, `src/hooks/use-native-line-item-writes.ts`) is
untouched. An auto-priced line instead stores:
- `unitPrice = perUnitCharge` (the capped blended charge, above)
- `duration = 1` (always — the blended charge already bakes in the whole
  chargeable window)
- `priceBreakdown = JSON.stringify({ weeks, days, weeklyRate, dailyRate, capped })`
  — the previously-dead `projectLineItems.priceBreakdown` field, now
  populated. Rendered in the UI/PDFs as e.g. `"2 wk @ $150.00 + 3 d @ $30.00"`
  or `"charged as 1 wk (capped)"` (`formatPriceBreakdown`).

Auto-pricing triggers in `addLineItemSmartNative` on ANY model-backed line
with no manual `unitPrice` set — the old auto-pricing only fired for
`pricingType === "PER_DAY"`, so a `PER_WEEK` line silently never auto-priced;
that gate is gone (the derivation itself picks the tier from the rates
available, so `pricingType` no longer matters to auto-pricing).

**Project-level billing summary.** A read-only "billed as N wk M d" label in
the Financials tab (`BillingSummaryRow`), computed by `deriveBillingSummary`
— plain `floor`/`%` split of `inclusiveCalendarDays`, no capping (capping is
a per-line PRICING concept, not a project-wide date-range label). Overridable
via `Project.billingWeeksOverride`/`billingDaysOverride` (absent = derived;
present = the manual override, shown with an "edited" badge). Edited from a
small dialog that calls `projectWrites.updateNative`'s generic set/clear
directly (no full project-form round-trip needed for a two-field patch).
Per-group overrides are explicitly out of scope.

**Stale-price flow.** A rental-date edit NEVER silently reprices anything.
`lineItemWrites.projectPricingStaleness` (query) compares every auto-priced
line's STORED `priceBreakdown` against what the CURRENT project dates would
derive (`isBreakdownStale`); a non-zero count surfaces an amber "Rates
derived from old dates — recalculate" banner (`StalePricingBanner`).
`lineItemWrites.recalcAutoPricedLinesNative` (mutation) — the only thing that
ever recomputes — runs exclusively from that banner's "Recalculate" click,
recomputing every eligible line (model-backed, has a stored `priceBreakdown`,
NOT `priceOverridden`) and every affected group's `suggestedPrice`, then
`recalcProjectTotals`. A manually overridden line's price (`priceOverridden:
true`) is never touched by the recalc, mirroring how the derived billing
summary itself is never touched once overridden.

**Allocation.** `convex/lib/allocation.ts`'s weekly-vs-daily rate-scale
choice (`AllocationInput.billingWeeks`) now reads the project's derived (or
overridden) `billingWeeks` via `deriveBillingSummary`, replacing the retired
`rentalPeriod: "DAILY" | "WEEKLY"` string field — `billingWeeks > 0` selects
the same weekly-scale behaviour `rentalPeriod === "WEEKLY"` used to.

### Finance soft-lock (#957 — see FEATUREDOCS/62-project-lifecycle-locks.md)
Once a project is FINANCE_LOCKED+ (CONFIRMED and later), the fields that feed the
formula above — `taxRate`/`discountPercent` on the project,
`price`/`discount`/`rentalPeriod`/`rentalQuantity` on a group,
`unitPrice`/`discount`/`duration` on a line item, a crew-less
service's `costTotal`, and crew assignment rate/hours overrides — are rejected
server-side (`FINANCIALS_LOCKED`) unless an unlock session is open. `recalcProjectTotals`
itself is never gated — it only ever reads these fields, never sets them, so
totals stay live on a locked project. New adds while locked default their price
to $0 instead of the normal autofill (an "Unpriced" badge marks them) — this is
server-enforced, not just a client suggestion.

**#940 (WS1 — finance model) update:** `depositPercent`/`depositPaid`/
`invoicedTotal` are OFF this list as of #940 — `depositPercent` moved to the
client payment profile (not a project field anymore); `depositPaid`/
`invoicedTotal` moved from "locked input" to recalc-OWNED (derived from the
project's ISSUED invoices, same treatment as `equipmentRevenue`/`total`/
`margin` — never client-writable at any lock tier, not just gated by one).
See [FEATUREDOCS/66-finance-quotes-invoices-xero.md](./66-finance-quotes-invoices-xero.md).

## Categories (`ProjectCategory`)
- Top-level organiser for equipment (e.g. "RF", "IEM", "PA")
- Sort order via `sortOrder` field, drag-and-drop reorderable
- Deleting a category orphans its groups and line items into the
  Uncategorized zone (FK is `ON DELETE SET NULL` for both
  `ProjectGroup.categoryId` and `ProjectLineItem.categoryId` — the
  group FK switched from CASCADE to SET NULL in v0.10.0.0 so deleting
  a category no longer destroys its groups along with every contained
  line item)
- Browser-direct mutations: `convex/projectCategoriesWrites.ts` (`createCategoryNative`,
  `updateCategoryNative`, `deleteCategoryNative`, `reorderCategoriesNative`) — the old
  `src/server/project-categories.ts` server actions are gone

## Groups (`ProjectGroup`) — The Billable Unit
- Groups are the billable units on quotes/invoices
- Fields: `title`, `description` (free-text for quote), `quantity`, `price`,
  `discount` (issue #883)
- `discount` is a **flat $ amount off `price × quantity`**, not per-unit —
  same subtraction shape as `ProjectLineItem.discount`, clamped at 0.
  Editable from `EditGroupDialog` or `PriceEditDialog`'s project branch (both
  share the `DiscountField` `$`/`%` toggle; `%` resolves to a flat dollar
  amount client-side before it reaches `updateGroupPriceNative` — the
  mutation never sees a percentage). Applied in
  `convex/lib/recalc.ts` (`groupRevenue`), `convex/lib/allocation.ts`
  (per-model revenue pool), and `src/lib/pdfme/structure-line-items.ts`
  (the synthetic group row's PDF total) — see
  [FEATUREDOCS/47](./47-cross-type-equipment-unification.md#structural--discount-unification-pass-issue-883)
  for the full plumbing list. There is no discount UI at group *creation*
  (`AddGroupToolbarDialog`) — same as `price`, which is also only set
  after creation via one of the two edit surfaces above.
- `discountMode` (`"$" | "%"`, issue #1012) records **how that discount was
  entered**, next to the resolved dollar amount. It is display-only — recalc,
  allocation and invoicing still read `discount` and nothing else — and exists
  so quote/invoice PDFs can print `-10%` instead of `-$100.00`
  ([FEATUREDOCS/13](./13-pdfs.md)). Absent on every pre-#1012 row and read as
  `"$"`, so no backfill was needed. It is written **only alongside the amount
  it describes**: `updateGroupPriceNative` drops a stale mode when the discount
  is zeroed, and the lifecycle-lock `defaultToZero` path clears both together.
  Both edit surfaces seed the toggle *and* the input from the stored mode on
  open (`discountEntryValue`), so reopening a 10% group shows "10 %" rather
  than silently rewriting it back to `$`. `LOCKED_GROUP_FIELDS` /
  `LOCKED_LINE_ITEM_FIELDS` include `discountMode` so a FINANCIAL-scope revert
  restores the entry shape with the amount.
- `categoryId` is **nullable since v0.10.0.0** — a group can live in
  the project's Uncategorized zone (mirrors `SubHireGroup.targetCategoryId`).
  The toolbar "Add Group" dialog and per-group Move dialog both offer
  Uncategorized as a destination. `createProjectGroup` scopes its
  `sortOrder` aggregate by `projectId` so each project's Uncategorized
  zone has its own sequence.
- **Moving a line item into an uncategorized-zone group:** the
  `MoveItemToGroupDialog` builds its target list from BOTH `categories[]`
  (categorized groups) AND a separate `uncategorizedGroups` prop
  (`native.uncategorizedProjectGroups`). Earlier it was only fed
  `categories[]`, so uncategorized-zone groups were never offered as move
  targets — and a project whose ONLY groups were uncategorized showed the
  false "no groups exist" empty state (read as "can't move into an empty /
  newly-created group"; the real discriminator was *uncategorized*, not
  *empty*). The submit path forwards `categoryId: null` for those targets,
  which `moveLineItemToGroup` / `moveLineItemsToGroup` already accept. Server
  side needs no change. Smoke test:
  `__tests__/move-item-to-group-dialog.smoke.test.tsx`.
- `suggestedPrice` auto-calculated from tracked assets' rates inside the group
- User can override `price` or accept the suggestion with one click
- Assets inside a group are for **tracking only** — never shown on quotes
- Groups only exist within a project, not as standalone library items

### Group Templates
- Save a group configuration as a reusable template (`GroupTemplate` + `GroupTemplateItem`)
- Apply a template when creating a new group (pre-fills line items from template)
- Template picker integrated in the inline "Add Group" form
- Reads: `convex/groupTemplates.ts`; browser-direct mutations:
  `convex/groupTemplatesWrites.ts` (`saveGroupAsTemplateNative`, `updateTemplateNative`,
  `deleteTemplateNative`, `applyNative`) — the old `src/server/group-templates.ts`
  server actions are gone
- Standalone management page at `/settings/group-templates` (linked from
  the Settings sidebar and reachable via `@grouptemplates` in cmd+K)
- Full integration-checklist coverage: `requirePermission(project, ...)` on
  all server actions, `logActivity` on every write, global search,
  page-commands entry, org export/import (`GroupTemplate` +
  `GroupTemplateItem`).
- Notifications: `// FEATUREDOCS/29: N/A — templates are static config
  with no time-based triggers (no expiry, no scheduled state changes)`.
- CSV: `// FEATUREDOCS/29: N/A — templates are hand-curated and small in
  number; bulk CSV import/export would add complexity without a real
  use case`.

### Suggested Price Calculation (`computeGroupSuggestedPrice()`)
Derived billing weeks/days + best-price capping (#943 — see above). Single
canonical implementation: `convex/lib/suggestedPrice.ts` (used from every
Convex call site — `lineItemWrites.ts`, `projectGroupsWrites.ts`,
`subHireLineGen.ts`) plus its src-side twin `src/lib/project-groups-pricing.ts`
(used from the Next.js server, outside a Convex mutation). This collapsed
what were THREE independently hand-duplicated copies of the formula pre-#943
(the two above, plus an inline loop in `groupTemplatesWrites.applyNative`).
```
chargeableDays = inclusiveCalendarDays(project.rentalStartDate, project.rentalEndDate)
For each line item in group (excluding kit children, custom items):
  { perUnitCharge } = computeBlendedCharge({ chargeableDays, dailyRate: model.dailyRate, weeklyRate: model.weeklyRate })
  total += perUnitCharge × item.quantity
```
The same `computeBlendedCharge` derivation auto-fills `unitPrice` on a single
line when it's added (`addLineItemSmartNative`) — `unitPrice = perUnitCharge`,
`duration = 1` (pinned — see "Derived Billing Weeks/Days" above),
`priceBreakdown` stores the weeks/days/capped detail.
- Recalculated when: items added/removed/merged into the group, or the
  project's rental dates change and the operator clicks "Recalculate" on the
  stale-price banner (never silently — see above). Group-level
  rentalPeriod/rentalQuantity overrides are retired; there is nothing left on
  the group ITSELF that can make its suggestedPrice stale.

## Line Items (`ProjectLineItem`)
- `categoryId` (nullable FK → ProjectCategory)
- `groupId` (nullable FK → ProjectGroup)
- Items in a group are for equipment tracking only
- Standalone items (no groupId) appear as their own line items on quotes

### Line Item Types
- **EQUIPMENT**: Links to `modelId`, optionally `assetId`, `bulkAssetId`, or `kitId`
- **SERVICE / LABOUR / TRANSPORT / MISC**: No asset link, just description + pricing
- **Custom Items** (`isCustomItem: true`, type stays `EQUIPMENT`): Free-text items with no inventory reference. Set via "Custom Item" button in equipment tab. The `description` field serves as the display name. Shown with a muted "Custom" badge. Skips all availability checks and merge logic. Appears on all documents and in warehouse views.

### Custom Items
Custom items are ad-hoc line items for gear not in the system — borrowed equipment, client-supplied items, one-off rentals tracked informally. They live as regular `ProjectLineItem` records with `isCustomItem: true` and no `modelId`/`assetId`/`bulkAssetId` link.

**Behavior:**
- Created via the browser-direct `addCustomNative` mutation in `convex/lineItemWrites.ts`
  (the old `addCustomLineItem()` server action in `src/server/line-items.ts` is gone —
  that file now only holds reads: `checkAvailability`, `lookupAssetByTag`,
  `checkKitAvailability`, `recalculateProjectTotals`, `checkAvailabilityBatch`)
- Validated by `customLineItemSchema` in `src/lib/validations/line-item.ts`
- Display name: `description` field (already used as fallback across all rendering paths)
- `computeOverbookedStatus` skips custom items (filters on `li.modelId !== null`)
- Never merged with other items (merge logic requires `modelId`)
- Appear in warehouse (pick/prep, deploy, return tabs) — checked out/in via button, no scan
- Appear on all PDFs (`getProjectForDocument` fetches all non-cancelled items regardless of type)
- Appear on pull sheet (`getProjectPullSheet` filters `type: "EQUIPMENT"`)
- A custom item inside a project group counts as an **extra** on top of the group's bundle price — it is not absorbed into the group total and no longer vanishes from the project total.

**Distinction from sub-hires:** Sub-hires represent formally ordered gear from a supplier with a structured order workflow. Custom items are anonymous ad-hoc entries with no supplier and no order tracking.

### Inline editing (equipment table)
Unit price, discount, quantity, description, and notes are editable directly
in the equipment table row — click the cell, type, then blur (click away or
Tab) or press Enter to save; Escape reverts without saving. This is a second
entry point onto the *same* write as the "Edit" pencil's
`EditLineItemDialog`, not a parallel path: `line-item-inline-cells.tsx`'s
cell components call `equipment-tab.tsx`'s `handleInlineLineItemUpdate`,
which layers the one changed field onto `buildLineItemFormDefaults(item)` and
resolves it via `computeEditLineItemPayload` — the identical helper
`EditLineItemDialog`'s `handleSave` calls for a full-form save (both now live
in `src/lib/line-item-edit-payload.ts`, R-3.1). The resulting payload goes
through the same `updateLineItemMut` mutation function (a second
`useServerMutation` instance, `updateLineItemInlineMut`, shares the identical
`mutationFn` but skips the dialog-close/success-toast side effects — the
row's own `justChanged` flash on `updatedAt` change is feedback enough for a
single-cell save).

- **Description** is only inline-editable when the row has no `modelId` —
  a model-backed row always displays `model.name` regardless of
  `description` (the same read-fallback the dialog's field seeds from), so
  inline-editing it for an equipment line would visibly do nothing on save.
  Custom/service/labour/transport/misc items (no model) are always editable.
- **Discount** reuses `resolveDiscountAmount`/`discountEntryValue` from
  `src/lib/discount-mode.ts` exactly like the dialog's `DiscountField` — the
  inline editor is a number input plus the same `$`/`%` toggle, seeded from
  the stored `discount`/`discountMode` pair. An empty discount renders a
  hover-revealed "+ Discount" affordance instead of a $0 line, matching the
  row's other hover-revealed actions.
- **Quantity** (`InlineEditableQuantity`) reproduces `EditLineItemDialog`'s
  overbook check, just reactively instead of proactively: no per-row
  availability query is pre-fetched (no `rentalStartDate`/`rentalEndDate`
  threaded into `LineItemRow` at all) — the cell attempts the save with
  `allowOverbook: false`, and `patchNative`'s own re-check is the single
  source of truth. On a quantity *increase* past availability, the server
  throws `ConvexError({ code: "INSUFFICIENT_STOCK", message, hint })`; the
  cell catches exactly that code, shows the server's own message plus a
  "Cancel" / "Overbook anyway" pair inline, and only resends with
  `allowOverbook: true` on confirm. `updateLineItemInlineMut`'s `onError`
  skips its normal toast for this one code (the inline confirm handles it)
  but still toasts every other error. Quantity is a *structural* field
  (`LOCKED_LINE_ITEM_FIELDS` doesn't include it), so the cell isn't wrapped in
  `<LockedField>` — same JUSTIFY-tier/toast treatment as description/notes.
- **Price/discount lock**: wrapped in the same `<LockedField>` the dialog uses
  for money fields — when the project's financials are locked
  (`moneyLocked`, FEATUREDOCS/62), the cells render read-only with the same
  tooltip + "Manage unlock" exit, never bypassing the lock client-side.
  Description/notes are the *structural* gate instead (`assertLifecycleGuard`
  `kind: "structural"`) — same as editing them via the dialog today, a
  JUSTIFY-tier project without an open session surfaces the server's
  `JUSTIFICATION_REQUIRED` error as a toast (no inline justification prompt
  yet, matching the dialog's current behaviour).
- **Sub-hire group children** get all five cells too (added after the initial
  pass, which excluded them), routed through a different mutation entirely —
  see FEATUREDOCS/39-sub-hires.md's own "Inline editing" section for why
  `patchNative` isn't safe for these rows and what routes there instead.
  Quantity is the one field with no overbook concept for these rows (no
  `INSUFFICIENT_STOCK` check server-side), so the confirm step simply never
  triggers.
- **Project groups** (`GroupRow`, not a line item) also get inline
  price/discount cells now, wired to the exact `updateGroupPriceNative` call
  `EditGroupDialog`/`PriceEditDialog`'s project branch already make — `price`
  is always-required/full-replace (the cell resends the current price when
  only discount changed); `discount`/`discountMode` are set-or-clear-when-
  provided (resend the current price, omit discount entirely, when only
  price changed). This mutation genuinely is `assertLifecycleGuard({kind:
  "financial"})`-gated server-side (unlike sub-hire groups' `updateGroup`),
  so `GroupRow`'s cells wrap in `<LockedField>` same as `LineItemRow`'s.
  Clearing the discount input resolves to `resolveDiscountAmount`'s
  `undefined` ("nothing to discount"), which the mutation reads as "leave
  untouched" rather than "clear to zero" — a pre-existing characteristic of
  `updateGroupPriceNative` shared with `EditGroupDialog`'s own save, not
  something introduced here.

## Project Detail Page Layout
Restructured (v0.x) to a clean hero card + lean sidebar — the old big header,
standalone lifecycle band, and nine-section sidebar were "far too much info".
```
HERO CARD (rounded-[--r-lg] border-2 bg-card, full width):
  Projects › PROJ-123                                    (breadcrumb)
  Project Name [Template?]            [💬][Warehouse][Docs▾][Edit][⋯]
  PROJ-123 · Wet hire · Client · [PM avatars] [presence]   (meta line)
  ◉──◉──◉──○──○──○   Enquiry…Return     [Advance to {next} →] [⋯ status]
                                          (chrome-free ProjectLifecycle)

[Summary strip] [Conflicts banner]

┌─── LEFT (~63%) ──────────────────────┐ ┌─── RIGHT (~37%, 340px sticky) ───┐
│  TABS: [Equipment] [Labour &          │ │  ── Schedule ──                   │
│   logistics] [Financials] [Tasks]     │ │  date rows                        │
│   [Notes] [Files]                     │ │  ── Location ──                   │
│                                       │ │  venue + site contact             │
│  Financials tab = FinancialSummary    │ │  ── Team ──                       │
│   + ProjectCostsPanel (non-template)  │ │  client link + PM panel           │
│  (other tab content below)            │ │  ── Activity ──                   │
│                                       │ │  ProjectActivityFeed (realtime)   │
└───────────────────────────────────────┘ └───────────────────────────────────┘
```

- **Hero card** (`projects/[id]/page.tsx`): breadcrumb + identity/actions row +
  the chrome-free `ProjectLifecycle`. The non-template status pill is gone from the
  title row — status now lives in the lifecycle `⋯` menu. Templates keep a status
  pill in the hero. The `⋯` overflow action menu holds Runsheet, Duplicate project,
  Save as template, and the destructive Cancel/Delete (CANCELLED-vs-active logic).
- **`ProjectLifecycle`** (`components/projects/project-lifecycle.tsx`): the circular
  stepper is unchanged (done = filled --ink node + check, current = --card node + 2px
  red ring + red number, upcoming = outlined muted). It has NO card chrome of its own
  — the page places it in the hero card. Controls at the row's right end: an
  `Advance to {next} →` button plus a `⋯` dropdown that is the full status picker
  (props `statuses` + `onStatusChange`); for CANCELLED the off-pipeline t-out line
  renders but the `⋯` stays so the user can reactivate.
- **Lean sidebar** — only four sections: Schedule, Location, Team (client name link
  + `ProjectManagersPanel`), Activity (`ProjectActivityFeed`). Status/Quick-actions/
  Details/legacy-ActivityTimeline removed; FinancialSummary + ProjectCostsPanel moved
  into the Financials tab.

### Equipment Tab
- Flat table layout (`table-layout: fixed` with `<colgroup>`) — no card chrome
- Categories as collapsible row headers with tinted background
- Groups as collapsible table rows with edit button + dropdown menu, showing qty/price columns
- Line items indented under their parent group, drag-and-drop reorderable
- Single flat `DndContext` with prefixed IDs (categories, groups, items all in one context)
- Inline "Add Group" button in toolbar with template picker
- Uncategorized zone at the bottom holds orphan line items, orphan
  sub-hire groups, **and orphan project groups** (since v0.10.0.0) —
  fetched as `uncategorizedProjectGroups` from the composite
  `bundle` query in [`convex/equipmentTab.ts`](../convex/equipmentTab.ts)
  (the old `getUncategorizedProjectGroups` server action in
  `src/server/category-slots.ts` is gone)
- Line item edit dialog; separate "Move to category" and "Move to group" dialogs (split in v0.9.3.0 — see [47-cross-type-equipment-unification.md](./47-cross-type-equipment-unification.md))
- Category rename (inline) and delete with cascade warning

### Financials Tab
Moved out of the sidebar into its own non-template main-content tab (after
"Labour & logistics") to declutter the right rail. Contains `FinancialSummary`
+ `ProjectCostsPanel` + `ProjectFinancePanel`. The allGroups/pricing computation
that feeds `FinancialSummary` lives in the tab now (same logic as before).

`ProjectFinancePanel`'s quote half is the `<ProjectQuoteRail>` revision rail
(#986): one row per revision with send / recall / new-version / accept / decline.
Phase D (#989) promotes finance to its own top-level tab and retires this one —
until then the rail is the minimum surface for exercising the model, not the
designed layout.
- Total with margin bar (green > 40%, amber 20-40%, red < 20%)
- Equipment revenue, discount, tax breakdown
- Services + Labour costs section
- Pricing progress indicator ("3/8 groups priced" in amber)
- Expandable audit trail breakdown (per-group pricing)

### Project Summary Strip
- Inline metrics strip between header and tabs (not stat cards per DESIGN.md)
- 4 metrics: Equipment revenue, Services (cost + count), Crew (cost + count), Total
- Responsive: 4-column on desktop, 2x2 grid on mobile
- Uses existing financial data + `getProjectServicesSummary()` + `getProjectLabourCost()`

### Labour & Logistics Tab
- Single tab, single component: `ServicesPanel` (`src/components/projects/
  services-panel.tsx`) is now the **entire** tab — there is no page-level `CrewPanel`
  sibling anymore (issue #796). `ServicesPanel` renders the services timeline, then
  a "Project crew" section that mounts `CrewPanel` internally (viewing/status/bulk/
  messaging/call-sheet for every assignment on the project, service-linked or not).
- Timeline view: services grouped by date with SectionHeader overline pattern
- Service cards show StatusIndicator pills, crew avatar stack (3 max + overflow), inline crew cost
- "Generate Services" button auto-creates services from project dates + service templates
- "Import Services" button clones services from another project with date offset
- Empty state with calendar preset and contextual CTA
- FadeIn/StaggerList motion animations
- **Service date model**: only `BUMP_IN` / `BUMP_OUT` / `LABOUR` can span multiple
  days (`canBeMultiDay` in `services-panel.tsx`). For every other type `endDate`
  is forced to equal `date` in `buildServiceData()` (`server/project-services.ts`)
  and the single-day date input keeps `endDate` synced on change. Without this,
  editing only the start date left a stale `endDate` and silently turned a 1-day
  service into a 2-day span (also clamps `endDate` < `date`).

## Project Types
`DRY_HIRE, WET_HIRE, INSTALLATION, TOUR, CORPORATE, THEATRE, FESTIVAL, CONFERENCE, OTHER`

## Subhire
Line items with `isSubhire: true` and `supplierId` reference third-party equipment. `showSubhireOnDocs` controls visibility on client-facing PDFs.

## Kit & Prep-Kit Line Items
- Kit/prep-kit parent: `kitId` set, `isKitChild: false`
- Children: `isKitChild: true`, `parentLineItemId` pointing to parent
- Nested kits (kit inside prep-kit): child has its own `kitId` and `childLineItems`
- Queries must include 2 levels of `childLineItems` with `kit: true` for nested rendering
- See [Kits](./09-kits.md) and [Preps](./32-preps.md)

## Project Services
Structured operational tasks attached to a project (deliveries, pickups, bump in/out, labour, misc).

### Service Types
`DELIVERY, PICKUP, BUMP_IN, BUMP_OUT, LABOUR, MISC`

### Service Status Flow
`PLANNED → CONFIRMED → IN_PROGRESS → COMPLETED` (any → `CANCELLED`)

### Key Behaviour
- Each service has its own date, time, address (for delivery/pickup), crew count, pricing
- `billableToClient` flag: when true, cost flows into project revenue instead of cost
- `costTotal` field for direct financial roll-up (no shadow line items) — **auto-calculated
  from the service's own crew once it has any** (see Crew Integration below); a
  crew-less service keeps a manually-typed value (e.g. vehicle/transport cost)
- `chargeRateOverride` / `crewChargeTotal` (WS10 #949) — the charge-side twin of
  `costTotal`: once a service has crew AND a charge rate resolves (per-service
  `chargeRateOverride` or the assigned crew role's `chargeRate`), `crewChargeTotal`
  auto-computes and feeds `lineTotal` UNLESS `unitPrice` is manually set (manual
  price always wins — see [31-crew-management.md](./31-crew-management.md) "Charge
  Cascade & Margin"). No manual price + no charge rate configured = `lineTotal`
  stays whatever it was (usually null) — margin UI hides rather than showing a
  fake reading.
- Services grouped by date in the UI

### Crew Integration (issue #796 — per-crew rate table)
- Each service can optionally have a `crewRoleId` (FK to `CrewRole`) and `crewCountRequired`
- Service dialog includes a crew role picker, searchable crew member multi-select,
  and — once 1+ crew are selected — a **per-crew rate table** (`CrewRateTable` in
  `services-panel.tsx`): name, resolved rate (cascade preview), an overridable
  rate/rate-type/hours per row, and that row's cost
- `CrewAssignment` records auto-created with `serviceId` set, running the full rate
  cascade immediately (`convex/lib/crewRate.ts` `resolveRate`/`calculateEstimatedCost`,
  same as a crew-side assignment — no more "$0 until someone edits it later")
- The table's total is the single source of truth for the service's `costTotal`:
  `recalcServiceCostFromCrew()` (`convex/lib/serviceCost.ts`) recomputes it after
  every create/update crew reconcile, AND after a rate edit made from the crew side
  (`CrewPanel`'s assignment dialog / `crewAssignmentsWrites.ts`) — whichever side
  changed the rate, both surfaces show the same number
- Service type maps to assignment phase: DELIVERY→DELIVERY, PICKUP→PICKUP, etc.
- Deleting a service deletes all linked crew assignments
- Query invalidation ensures Crew and Services stay in sync
- See [31-crew-management.md](./31-crew-management.md) "Service ↔ Crew Cost Linkage"
  for the double-counting guard in `recalcProjectTotals`

### Margin Display (WS10 #949)
- `ServiceCard`'s financial line (`services-panel.tsx`) shows charge (`lineTotal`,
  everyone) and, for manager+ only, cost (`costTotal`) + margin (charge - cost,
  with %) — negative margin renders `text-t-out`, UNCLAMPED (a loss-making service
  is meant to be visible, not hidden). A `showOnDocuments: false` auto-priced
  service shows an "Internal (not billed)" tag instead of forcing the flag on.
- The services financial summary panel's third tile used to duplicate the second
  ("Total" and "Internal" both read the same `costTotal`-derived value) — it's now
  "Margin" (`onDocumentsTotal - internalTotal`), gated manager+ along with the
  "Internal" cost tile (members see only "On documents").
- The project P&L panel (`project-costs-panel.tsx` / `convex/projectCosts.ts`)
  gained an additive `labourServiceRevenue` field — the slice of `serviceRevenue`
  billed for LABOUR-type services, shown as a "Labour revenue" line once
  auto-pricing makes it non-zero (the pre-existing "Labour" cost row is unchanged —
  it covers standalone, non-service-linked crew, which never has a charge side).

### Defaults from Project
- New services inherit the project location address/coordinates
- Date auto-fills based on service type

### Service Auto-Generation
- `generateServicesNative` (`convex/projectServicesWrites.ts`) creates services
  from the project's **window** (`getProjectWindow` — WS2 #941) + service
  templates, not `loadInDate`/`loadOutDate`/`eventStartDate`/`eventEndDate`
  directly (deprecated). DELIVERY/BUMP_IN sit at the window start (the old
  load-in role), BUMP_OUT/PICKUP at the window end (the old load-out role),
  LABOUR/MISC span the whole window (the old event-start..event-end role — the
  closest single replacement now that the event pair is gone).
- Idempotent: checks existing services by type+date key to avoid duplicates on re-run (intra-batch dedup too, to avoid inflated totals)
- Uses `isAutoAdded` templates; falls back to all active templates if none marked
- Default set if no templates: DELIVERY, BUMP_IN, BUMP_OUT, PICKUP (+ LABOUR
  show days whenever the project has a resolvable window — there's no longer a
  separate "explicit event date" signal to gate on)
- A multi-day window creates one LABOUR service per day

### Service Cloning
- `cloneServicesNative` (`convex/projectServicesWrites.ts`) copies services between projects
- Calculates the date offset from the source/target **project window start**
  (`getProjectWindow`, WS2 #941), not `loadInDate ?? eventStartDate`
- Resets status to PLANNED, preserves crew preferences but not assignments; drops stale/foreign crew member+role FKs

### Crew Notifications
- `generateCrewMessage(projectId, crewMemberId)` (`src/server/project-services.ts`, retained as a live-read carve-out) builds copy-to-clipboard schedule message
- Includes venue, site contact, per-assignment schedule with dates/times/roles

### Service Templates
- Managed in Settings → Services (`/settings/services`)
- `isAutoAdded` flag for templates that should be added to every new project
- CRUD via `createServiceTemplateNative` / `updateServiceTemplateNative` / `deleteServiceTemplateNative` in `convex/projectServicesWrites.ts`

### Architecture
- Service CRUD/status/bulk/generation/template mutations are browser-direct in
  `convex/projectServicesWrites.ts` (12 mutations); money math (equivalent to the old
  `buildServiceData()` DRY helper) and `recalcProjectTotals` are ported server-authoritative
  inline in that file, run at every recalc site
- Line-item sync (equivalent to `syncServiceLineItem()`) has a kit child guard + deleted item guard
- Cascade delete: always unlink line items, never delete them
- Shared constants in `src/lib/constants/services.ts`
- Partial unique index on `CrewAssignment(projectId, crewMemberId, serviceId) WHERE serviceId IS NOT NULL`

### Server Actions vs Convex
`src/server/project-services.ts` was trimmed to a carve-out (reads + one live-effect action):
- Retained: `getProjectServices`, `getProjectServicesSummary`, `getServiceTemplates`,
  `updateServiceCrewStatus` (sendCrewOffer — crypto + email + Prisma), `generateCrewMessage`
- Moved browser-direct, all in `convex/projectServicesWrites.ts`: `createServiceNative`,
  `updateServiceNative`, `deleteServiceNative`, `updateServiceStatusNative`,
  `bulkDeleteServicesNative`, `bulkUpdateServiceStatusNative`, `generateServicesNative`,
  `cloneServicesNative`, `convertLineItemToServiceNative`, `createServiceTemplateNative`,
  `updateServiceTemplateNative`, `deleteServiceTemplateNative`
- **Removed as dead code** (unused, never wired to any UI): the old `getCrewSuggestionsForProject`
  (matched `Category.suggestedCrewRoles` to equipment categories) and `getServiceCostHistory`

### Day-of Runsheet
- Dedicated route: `/projects/[id]/runsheet`
- Mobile-first layout: no sidebar/tabs, compact header with venue directions
- Services grouped by date with crew lists per service
- Tappable phone numbers (tel: links) for site contact
- Link from project detail page "Runsheet" button

### Timeline PDF
- API route: `/api/documents/timeline/[projectId]`
- Portrait A4, date-grouped service rows with type/title/time/crew/cost
- Uses existing pdfme infrastructure (gearflowPageHeader/Footer plugins)
- Available via Documents dropdown on project detail page

### Documents ▾ is warehouse-only (#987)
The project header's **Documents ▾** offers Pull slip, Delivery docket, Return
sheet, Call sheet and Project timeline — all artifacts of LIVE project state,
which is correct for them (a packer wants today's list).

"Quote / proposal" and "Invoice" were removed. A client-facing finance document
is the STORED revision, downloaded from the finance panel
(`/api/finance/{quote,invoice}/…/pdf`), never a fresh render — two clicks a week
apart used to produce two different documents under the same name. See
[FEATUREDOCS/66](./66-finance-quotes-invoices-xero.md) "Immutable documents".

## Duplicate Model Handling
Adding a model that already exists as a line item on the project **auto-merges** into the existing line item (increments quantity) by default. When a duplicate is detected, the add dialog presents a choice:
- **Combine with existing** (default) — merges quantity into the existing line item
- **Add as separate line item** — creates a new row via `forceSeparate` parameter

Sub-hire items (`isSubhire: true`) always create separate line items and never merge with own-stock items of the same model. The merge query matches on `modelId`, `groupId`, `categoryId`, and `isSubhire` to prevent cross-type merging.

## Project Templates
- `Project.isTemplate = true`. Templates use the same `Project` table but are completely isolated.
- `generateTemplateCode()` creates `TPL-0001`, `TPL-0002`, etc.
- Templates MUST be excluded from: dashboard stats, notifications, reports, search results, availability calendar, availability checks
- All project list queries: add `isTemplate: false` filter
- `updateProjectStatus()` rejects templates. `getProjectForWarehouse()` throws for templates.
- Duplication preserves full hierarchy: categories, groups, line items, services

## Project Deletion
Only cancelled projects can be deleted (`deleteNative` in `convex/projectWrites.ts`, browser-direct — the old `deleteProject` server action in `src/server/projects.ts` is gone; that file now only holds reads).

### Cleanup on Delete
`deleteNative` (`convex/projectWrites.ts`) performs these steps explicitly in one
mutation — there is no more Postgres FK cascade to rely on (domain tables were
dropped from Postgres in the Convex decommission):
1. **Reset checked-out assets**: All `CHECKED_OUT`/`CONFIRMED` serialized assets linked to project line items → `AVAILABLE`, restore default location
2. **Reset checked-out kits**: All `CHECKED_OUT`/`CONFIRMED` kits + their serialized assets → `AVAILABLE`, restore locations
3. **Cascade line items**: every top-level line item (+ children + units) is deleted via `removeLineItemCascadeCore`
4. **Cascade crew, PMs, tasks, services, grouping (categories/groups/slots), the `projectModelRevenues` rollup, and (#957) `projectSnapshots`/`projectSnapshotEntries`/`projectUnlockSessions`**, then the project row itself + counters + audit log

## Server Action Files vs Convex
Writes moved browser-direct during the Convex-native migration (see [54. Convex Data Layer](./54-convex-data-layer.md)); `src/server/*.ts` now holds reads-only carve-outs where a file remains at all.
- `src/server/projects.ts` — Project **reads only** (`getProjects`, `getProject`,
  `peekNextProjectNumber`, etc.); CRUD/duplication/status live in `convex/projectWrites.ts`
  (`createNative`, `updateNative`, `deleteNative`, `duplicateNative`,
  `updateStatusNative`, `archiveNative`, `saveAsTemplateNative`, …)
- Category CRUD/reorder: `convex/projectCategoriesWrites.ts` (`src/server/project-categories.ts` is gone)
- Group CRUD/pricing/reorder/move items: `convex/projectGroupsWrites.ts` (`src/server/project-groups.ts` is gone)
- PM add/remove: `convex/projectManagersWrites.ts` (`src/server/project-managers.ts` is gone)
- Template CRUD/save/apply: `convex/groupTemplatesWrites.ts` (`src/server/group-templates.ts` is gone)
- `src/server/line-items.ts` — Line item **reads only** (`checkAvailability`,
  `lookupAssetByTag`, `checkKitAvailability`, `recalculateProjectTotals`,
  `checkAvailabilityBatch`); add/update/remove/reorder live in `convex/lineItemWrites.ts`
- `src/server/project-services.ts` — trimmed carve-out (reads + `updateServiceCrewStatus` +
  `generateCrewMessage`); CRUD/status/generation/templates live in `convex/projectServicesWrites.ts`
- Crew assignment management: `convex/crewAssignmentsWrites.ts` (`src/server/crew-assignments.ts` is gone)

## Validation Schemas
- `src/lib/validations/project.ts` — Project form (includes
  billingWeeksOverride/billingDaysOverride — the derived billing-summary
  override, #943 — and taxRate)
- `src/lib/validations/project-category.ts` — Category (name, sortOrder)
- `src/lib/validations/project-group.ts` — Group (categoryId, title,
  description, quantity, price). No rentalPeriod/rentalQuantity — retired
  #943; a group's billing window is derived purely from the project's dates.
- `src/lib/validations/group-template.ts` — Template (name, description, items[])
- `src/lib/validations/line-item.ts` — Line item (includes categoryId, groupId)
- `src/lib/validations/project-service.ts` — Service (includes billableToClient, costTotal)

## Operational P&L Panel
The project detail page shows the costs panel in the Financials tab (`src/components/projects/project-costs-panel.tsx`, reactive via `useProjectOperationalCosts`/`convex/projectCosts.ts`'s `operationalCosts`). It shows revenue minus service / labour / sub-hire / maintenance costs (`ProjectOperationalCosts` in `src/lib/project-costs.ts`) with a net-margin bar. Operational only — Xero owns invoicing. Hides itself when the project has no revenue.

**Doc-drift correction (WS7 #946, 2026-07-26):** this section previously claimed a
"damage" cost line and "charge-back-aware" logic (damage marked charged-back to the
client excluded from cost) — **neither exists in the codebase.** There is no
`damageCost`/`chargeBack`/`chargedBack` field anywhere in `convex/` or
`src/lib/project-costs.ts`; the only costs are `serviceCostTotal`, `labourCostTotal`,
`subHireCostTotal`, and `maintenanceCostTotal`. Charge-back-aware damage costs remain
an unbuilt, undesigned feature — WS7 explicitly deferred it (sub-hire order totals
also do NOT feed the P&L; see [22-suppliers](./22-suppliers.md#supplier-orders-purchase-orders)).

## Reservation Conflict Resolution
When a serialized asset is booked on this project AND on another live project whose PROJECT window overlaps (WS2 #941 — `getProjectWindow`, falls back to rental when unset), an amber banner (`src/components/projects/project-conflicts-banner.tsx`) surfaces on the project page. Each conflict row expands to a one-click swap picker of free same-model assets. The swap (`swapLineItemAsset`, `convex/projectLineItems.ts`, browser-direct via `src/hooks/use-reservation-swap.ts`) re-checks free-in-window and reassigns inside one mutation, so a stale candidate can't push through a fresh double-booking. Conflict/swap-candidate reads live in `convex/reservationConflicts.ts` (`projectConflicts`, `swapCandidates`); the old `src/lib/reservation-conflicts.ts` is gone. Both reads `.collect()` the org's full line-item/unit/asset/project/model graph (`loadOrgGraph()`) rather than paginating — correctness requires comparing against every booking anywhere in the org, so a bounded read would silently miss conflicts outside the fetched page. This is a registered §15 exception, not an oversight — see `docs/exceptions.md` (R-8.3.3 `reservationConflicts-orgGraph`).

## Future-Proofing
- **ROI Tracking**: Asset.purchasePrice supports revenue attribution against rental income — see [42. Asset Utilization](./42-asset-utilization.md)
- **Xero Integration**: Groups as line items + ungrouped standalone assets as separate line items
