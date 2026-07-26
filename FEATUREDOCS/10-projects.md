# Project & Rental Management

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

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
- Two edit-only fields appear that create mode hides: **Status** (basics step) and
  the **Financial** block — discount %, deposit %, deposit paid, invoiced total
  (site step). These carry the parity that the old flat edit form had.
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
- **Schedule step — one calendar, not six pickers.** The hire window is a single
  date range chosen via `RangeCalendar` (`src/components/ui/range-calendar.tsx`,
  a custom date-fns range calendar — no external calendar dep) plus duration
  preset chips (1 day / 2 days / Weekend / 1 week). The range writes
  `rentalStartDate`/`rentalEndDate`; load-in, show-start, show-end and load-out
  **dates derive from the window** (fill-if-empty, never clobbering an explicit
  edit). Per-moment dates + times live in an optional "Load-in, show & load-out
  times" accordion so the common case is "tap a preset, done". All ten underlying
  fields are preserved for `createProject()`.

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

subtotal = equipmentRevenue
discountAmount = subtotal × discountPercent / 100
taxRate = project.taxRate ?? org.defaultTaxRate ?? 10
taxableAmount = subtotal - discountAmount
taxAmount = taxableAmount × taxRate / 100
total = taxableAmount + taxAmount

margin = total - (serviceCostTotal + labourCostTotal)
marginPercent = margin / total × 100
```

### Tax Rate Cascade
- Per-project `taxRate` (Decimal, nullable) takes priority
- Falls back to `Organization.defaultTaxRate` (configurable in Settings)
- Falls back to 10% (GST default)

### Billing Weeks/Days Pricing (Primary Model)
- `Project.billingWeeks` (Int, nullable) + `Project.billingDays` (Int, nullable) — set on project form
- Per-group override: `ProjectGroup.billingWeeks` + `billingDays`
- Uses `Model.weeklyRate` and `Model.dailyRate` fields
- Formula: `(weeklyRate × weeks + dailyRate × days) × quantity`
- "Match" button on project form auto-calculates weeks/days from rental date range

### Legacy Rental Period Pricing (Fallback)
- `Project.defaultRentalPeriod` (DAILY | WEEKLY) + `defaultRentalQuantity` (Int)
- Per-group override: `ProjectGroup.rentalPeriod` + `rentalQuantity`
- Used only when billingWeeks/billingDays are both null
- Formula: `rate × quantity × rentalQuantity`

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

### Suggested Price Calculation (`calculateSuggestedPrice()`)
Simple rate × period × qty model (the min-cost optimizer + billing-period
config were removed — see git history for `38-pricing-optimization.md`).
```
rentalPeriod = group.rentalPeriod ?? project.defaultRentalPeriod ?? "DAILY"
rentalQuantity = group.rentalQuantity ?? project.defaultRentalQuantity ?? 1
For each line item in group (excluding kit children):
  rate = (rentalPeriod === "WEEKLY") ? model.weeklyRate : model.dailyRate
  total += rate × item.quantity × rentalQuantity
```
The same `rate × period × qty` model auto-fills `unitPrice` on a single line
when it's added (`addLineItem`) — `unitPrice = rate`, `duration = rentalQuantity`.
- Recalculated when: items added/removed, group rental period/quantity changed, item moved between groups

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
│   logistics] [Financials] [Tasks]     │ │  DateRangeBar + date rows         │
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
+ `ProjectCostsPanel`. The allGroups/pricing computation that feeds
`FinancialSummary` lives in the tab now (same logic as before).
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

### Defaults from Project
- New services inherit the project location address/coordinates
- Date auto-fills based on service type

### Service Auto-Generation
- `generateServicesNative` (`convex/projectServicesWrites.ts`) creates services from project dates + service templates
- Idempotent: checks existing services by type+date key to avoid duplicates on re-run (intra-batch dedup too, to avoid inflated totals)
- Uses `isAutoAdded` templates; falls back to all active templates if none marked
- Default set if no templates: DELIVERY, BUMP_IN, BUMP_OUT, PICKUP (+ LABOUR show days if event dates)
- Multi-day events create one LABOUR service per day

### Service Cloning
- `cloneServicesNative` (`convex/projectServicesWrites.ts`) copies services between projects
- Calculates date offset from first service date difference
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
4. **Cascade crew, PMs, tasks, services, grouping (categories/groups/slots), and the `projectModelRevenues` rollup**, then the project row itself + counters + audit log

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
- `src/lib/validations/project.ts` — Project form (includes billingWeeks, billingDays, defaultRentalPeriod, defaultRentalQuantity, taxRate)
- `src/lib/validations/project-category.ts` — Category (name, sortOrder)
- `src/lib/validations/project-group.ts` — Group (categoryId, title, description, quantity, price, billingWeeks, billingDays, rentalPeriod, rentalQuantity)
- `src/lib/validations/group-template.ts` — Template (name, description, items[])
- `src/lib/validations/line-item.ts` — Line item (includes categoryId, groupId)
- `src/lib/validations/project-service.ts` — Service (includes billableToClient, costTotal)

## Operational P&L Panel
The project detail page shows the costs panel in the Financials tab (`src/components/projects/project-costs-panel.tsx`, server fn `getProjectOperationalCosts`). It shows revenue minus service / labour / sub-hire / maintenance / damage costs with a net-margin bar. Charge-back-aware: damage marked charged-back to the client is excluded from cost. Operational only — Xero owns invoicing. Hides itself when the project has no revenue.

## Reservation Conflict Resolution
When a serialized asset is booked on this project AND on another live project whose rental window overlaps, an amber banner (`src/components/projects/project-conflicts-banner.tsx`) surfaces on the project page. Each conflict row expands to a one-click swap picker of free same-model assets. The swap (`swapLineItemAsset`, `convex/projectLineItems.ts`, browser-direct via `src/hooks/use-reservation-swap.ts`) re-checks free-in-window and reassigns inside one mutation, so a stale candidate can't push through a fresh double-booking. Conflict/swap-candidate reads live in `convex/reservationConflicts.ts` (`projectConflicts`, `swapCandidates`); the old `src/lib/reservation-conflicts.ts` is gone. Both reads `.collect()` the org's full line-item/unit/asset/project/model graph (`loadOrgGraph()`) rather than paginating — correctness requires comparing against every booking anywhere in the org, so a bounded read would silently miss conflicts outside the fetched page. This is a registered §15 exception, not an oversight — see `docs/exceptions.md` (R-8.3.3 `reservationConflicts-orgGraph`).

## Future-Proofing
- **ROI Tracking**: Asset.purchasePrice supports revenue attribution against rental income — see [42. Asset Utilization](./42-asset-utilization.md)
- **Xero Integration**: Groups as line items + ungrouped standalone assets as separate line items
