# TODOS

Deferred work items tracked from engineering reviews and planning sessions.

## Pricing System

### Margin-Aware Quoting
**What:** Add a margin view column/tooltip showing cost basis vs. suggested price with margin percentage. Transform the optimizer from a pure calculator into a business decision tool.
**Why:** The optimizer always picks the cheapest option for the customer. Rental companies sometimes want simpler billing even if slightly more expensive, or need to hit margin targets.
**Pros:** Transforms pricing from calculator to business tool, helps staff make margin-aware decisions.
**Cons:** Requires cost basis data (not currently tracked per model). May need a "cost rate" field on Model.
**Context:** Deferred during /autoplan CEO review. Override tracking (priceOverridden + overrideReason) enables margin decisions but doesn't surface the data.
**Depends on:** Pricing optimization feature.
**Estimate:** human ~1 week / CC ~30 min
**Priority:** P2

### CSV Rate Import
**What:** Add CSV import for model rates. Upload a spreadsheet with model name/ID, daily rate, weekly rate, monthly rate. Bulk populate rates without clicking through forms.
**Why:** The optimizer is only useful when models have rates populated. For existing inventories with hundreds of models, the model form and inline editing are too slow. CSV import solves the cold-start data entry problem.
**Pros:** Fastest path to full rate coverage, familiar workflow for AV rental operators who manage rates in spreadsheets.
**Cons:** Requires file upload handling, CSV parsing, error reporting for bad rows. Need to handle model matching (by name? by asset tag? by ID?).
**Context:** Deferred during /autoplan CEO review. The bulk rate update dialog (formula-based) is in scope; CSV import is the next step for operators with existing rate spreadsheets.
**Depends on:** Pricing optimization feature (rate fields must exist on Model).
**Estimate:** human ~3 days / CC ~30 min
**Priority:** P2

### ~~Configurable Days-Per-Month~~ ✅ SHIPPED
Shipped in v0.8.2.0. `OrgSettings.daysPerMonth` (validated 20-31, default 28),
`resolveDaysPerMonth()` guards against corrupt metadata, threaded through
`optimizePrice` + `computeTotalDays`, UI field in Settings → Project Defaults
with onChange clamping. 10 new pricing tests + 2 resolver tests.

## Testing Expansion

### Server Action Integration Tests
**What:** Add integration tests for the 53 server action files (~19k LOC) covering the core business logic.
**Why:** Server actions contain the most critical logic — availability checking, warehouse checkout, kit expansion, permission enforcement, activity logging. Unit tests on validation schemas catch input errors, but integration tests catch logic bugs in the actual database operations.
**Pros:** Catches real bugs (stale data, race conditions, permission bypass), enables safe refactoring of the largest files (kits.ts at 58KB, warehouse.ts at 49KB).
**Cons:** Requires setting up a test database, Prisma test helpers, and auth mocking. Significant one-time setup cost.
**Context:** Start with the 10 most critical files: assets.ts, projects.ts, kits.ts, warehouse.ts, line-items.ts, categories.ts, clients.ts, bulk-assets.ts, crew.ts, and permissions enforcement in org-context.ts. Also include the new check system files when they ship: check-items.ts, check-records.ts, warehouse-close.ts. Each server action follows the same pattern (requirePermission → query → logActivity → serialize), so test helpers can be shared.
**Depends on:** Test infrastructure (completed in v0.2.0). Needs test DB setup (docker-compose or test env).
**Estimate:** human ~4 weeks / CC ~3-4 hours

### E2E Tests with Playwright
**What:** Add end-to-end tests for the 90 page routes covering critical user journeys.
**Why:** E2E tests catch integration bugs that unit tests miss — broken navigation, form submission failures, auth redirects, real API interactions. The Playwright config is already scaffolded.
**Pros:** Catches real-world bugs (broken forms, auth flows, navigation issues), provides confidence for major refactors or upgrades.
**Cons:** Requires running app, test data seeding, slower to run than unit tests. Need to handle auth state and org context in test setup.
**Context:** Priority journeys to test first: (1) login → dashboard, (2) create asset model → create asset → view in registry, (3) create project → add line items → generate quote PDF, (4) warehouse checkout → checkin flow, (5) kit creation → add items → checkout as kit. Playwright config already exists at playwright.config.ts.
**Depends on:** Test infrastructure (completed in v0.2.0). Needs test data seeding strategy.
**Estimate:** human ~3 weeks / CC ~2-3 hours

## Warehouse Check System

### Customer-Facing Inspection Report PDF
**What:** Generate a printable proof-of-inspection document showing all check results for a deployment — pass/fail per item, photos, T&T status, measurement readings, and operator signature.
**Why:** Clients need proof that gear was inspected before dispatch. Currently there's no way to produce this evidence for sign-off or compliance records.
**Pros:** Builds client trust, supports compliance workflows, reuses existing PDF template system and CheckRecord data.
**Cons:** Requires designing a new PDF template type. Check system must ship first to have data to render.
**Context:** Deferred during CEO review (scope expansion #1). The CheckRecord table already captures all needed data (result, value, notes, photos, performedBy, performedAt). The existing section-based PDF template builder could be extended with check-specific section types (check-results-table, photo-evidence-grid, tt-summary). Route: generate from project detail or warehouse close-out.
**Depends on:** Warehouse check system (CheckRecord table, check form, prep/return flows).
**Estimate:** human ~1 week / CC ~30 min
**Priority:** P2

## Call Sheet

### ~~Template Editor Settings for New Section Types~~ ✅ SHIPPED
Shipped in v0.8.2.0. `CallSheetInfoSettings` + `DayHeaderSettings` panels
in `SectionSettingsPanel`, default-settings dispatch wired into both
`section-builder.tsx` and `block-editor.tsx`. Day-header toggles flow
through `expandSectionsForDates` so phases/crewCount can be hidden on
auto-injected per-day headers. Renderer also merges defaults at read
time so legacy `{}` settings don't render blank sections.

## PDF Template System

### T&T Report Template Builder
**What:** Port the section-based template builder pattern to the 10 T&T report types. Create new section types (summaryBox, dataTable, textBlock) and make report layouts editable in the same builder UI.
**Why:** Currently T&T report layouts are hardcoded. Users can't customize columns, add sections, or reorder content. The section-based architecture from the project document builder is directly reusable.
**Pros:** Unlocks custom report layouts without code changes, consistent UX across all document/report editing, section types are additive.
**Cons:** 10 report types means 10 default templates to define. Report data shapes differ from project documents — need separate data assembly.
**Context:** The section-based template builder (from the PDF template rewrite) established the architecture: draggable section list → settings per section → multi-page pagination → pdfme generation. T&T reports would add section types: `report-header`, `summary-box`, `data-table`, `text-block`, `signature-line`. Existing report template builders in `src/lib/pdfme/templates/tt-*.ts` define the default section ordering per report type.
**Depends on:** PDF template builder rewrite (section-based architecture must ship first).
**Estimate:** human ~3 weeks / CC ~2-3 hours
**Priority:** P2

### Remove Legacy PDF Pipeline
**What:** Remove the old basePdf/schemas-based PDF generation pipeline, the pdfme Designer component (`DocumentDesigner`), and related dead code (~1000 LOC) once all orgs have migrated to section-based templates.
**Why:** The section-based template builder replaces the old fixed-position pipeline. Keeping both adds maintenance burden and confusion about which code path is active.
**Pros:** Cleaner codebase, removes ~1000 LOC of dead code, eliminates legacy/new pipeline branching logic in `generate-pdf.ts`.
**Cons:** Must verify all orgs have migrated first (check for templates without `sections` column populated). Risk of breaking templates that weren't auto-migrated.
**Context:** The migration script converts `DocumentTemplate.settings` → `sections[]` for existing templates. Templates without settings use system defaults and don't need migration. After migration, the `basePdf` and `schemas` columns on DocumentTemplate become dead data. The `DocumentDesigner` component and `/template-designer/[id]` page are fully replaced by the new template builder.
**Depends on:** PDF template builder rewrite must ship + migration verified for all orgs.
**Estimate:** human ~2 days / CC ~30 min
**Priority:** P3

## Testing Expansion

### Component Tests with React Testing Library
**What:** Add component tests for the 123 component files using React Testing Library + happy-dom in Vitest.
**Why:** Tests complex stateful components (warehouse scanner, availability calendar, kit builder) that have significant client-side logic beyond simple rendering.
**Pros:** Catches client-side state bugs, validates user interactions without running the full app.
**Cons:** Most components are thin wrappers around shadcn/ui — lower ROI than server action tests. Requires happy-dom/jsdom setup.
**Context:** Focus on complex stateful components first: warehouse scanner (barcode input → API call → state update), availability calendar (date range selection → conflict display), kit builder (drag-and-drop → item management), and data tables (filtering/sorting/pagination). Skip simple presentational components.
**Depends on:** Test infrastructure (completed in v0.2.0). Needs happy-dom devDependency.
**Estimate:** human ~2 weeks / CC ~2 hours

## Services & Crewing

### Crew Travel Distance to Venue
**What:** Show crew member travel distance/time to the venue in the crew assignment combobox. When assigning crew to a service, display "Alex: 25 min drive" next to each crew member based on their address and the project location.
**Why:** Helps make smarter crew assignment decisions, especially for gigs across different cities or suburbs. Reduces no-shows from crew who didn't realize how far the venue was.
**Pros:** Better crew scheduling decisions, reduces travel cost surprises.
**Cons:** Requires Google Distance Matrix API integration (new external dependency, per-query cost). Crew member addresses must be populated (currently optional field). Project must have a location set.
**Context:** Deferred during CEO review of services/crewing rework. CrewMember already has `address`, `addressLatitude`, `addressLongitude` fields. Project has location relation with lat/lng. The data model supports this, just needs the API integration and UI.
**Depends on:** Services/crewing rework (timeline view with inline crew assignment). Google Maps API key (already in env as NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
**Estimate:** human ~2 days / CC ~20 min
**Priority:** P3

### ~~Crew Availability Composite Index~~ ✅ SHIPPED
Shipped in v0.8.2.0. Added `@@index([crewMemberId, startDate, endDate])`
on `CrewAssignment` via migration `20260603000000_crew_assignment_composite_idx`.
The existing `(crewMemberId, startDate)` index is kept; Postgres uses
the leading prefix where it's narrower.

## Equipment & Line Items

### Promote Custom Item to Inventory
**What:** Add a "Promote to Inventory" action on custom line items that converts the item into a real Model + Asset stub in the inventory system.
**Why:** Operators sometimes add custom items for gear that later becomes permanently acquired. Currently they'd need to add the model/asset manually and re-add to the project.
**Pros:** Bridges the gap between ad-hoc tracking and formal inventory, no data loss.
**Cons:** Requires defining sensible defaults for the auto-created Model (name from description, no rates, no category).
**Context:** Deferred from custom items autoplan. The `isCustomItem` flag makes it easy to identify items eligible for promotion.
**Priority:** P3

### Custom Items Library (Suggest from Past Projects)
**What:** When adding a custom item, suggest names from previously added custom items across the org's project history.
**Why:** Operators often reuse the same informal descriptions ("Borrowed SM58", "Client-supplied cable drum"). Suggestions reduce typos and improve consistency in reports.
**Pros:** Better data quality, faster entry.
**Cons:** Requires indexing all past `description` values for custom items — simple DB query but needs UI autocomplete.
**Context:** Deferred from custom items autoplan.
**Priority:** P3

### Assign Asset Tag to Custom Item (Post-Hoc)
**What:** Allow operators to optionally assign an existing asset tag to a custom item after it's added, converting it from a custom item to a tracked asset on the line item.
**Why:** Sometimes gear starts as "custom" (borrowed, untracked) but gets formally added to inventory mid-project. Operators should be able to link the item without re-adding it.
**Cons:** Edge case for most users. Requires matching the custom item line item to a real Asset.
**Context:** Deferred from custom items autoplan (Barcode Scanning Phase 2).
**Priority:** P3

### ~~Child Assets / Accessories~~ ✅ SHIPPED
Shipped in v0.11.0.0. `Asset.parentAssetId` self-relation (serialised
children), `AssetBulkChild` join (bulk children, default `SHIPS_WITH`
allocation), `ProjectLineItem.childKind` (`KIT | ACCESSORY`), reusing
`isKitChild` so the ~40 totals/count filters auto-exclude accessories with
no migration. Accessories auto-expand onto projects from two entry points:
office adds (`expandAccessoryChildren` in `line-items.ts`) and warehouse
assigns-at-scan (`expandAccessoriesForAsset` in `line-item-fulfillment.ts`,
hooked into `prepUnit` + `checkOutItems`, idempotent). Warehouse cascade
flips accessory units through the standard unit path inside the parent's
transaction. PDF audit covers all 5 consumers with an "accessory parent"
detection in both render and height calc. `AssetAccessoriesManager` UI on
the asset detail page; "scan the parent" prompts in all 3 warehouse tabs.
Hardened post-review: TOCTOU-safe attach, detach-while-deployed guard,
deleteAsset blocks parents with accessories, symmetric kit↔accessory dual
membership guard. 26 integration tests. Follow-ups (deferred, see below).

### ~~Accessories — warehouse / pull-sheet / check-flow wiring~~ ✅ SHIPPED
Shipped in v0.14.0.0. Accessories now render + are pickable on the interactive
and printable pull sheets, render nested under the parent in the deploy/return
tabs (`AccessoryChildRows`), and expand badged "Accessory" in the project
equipment table (`describeRow` accessory-parent detection). Return cascade
extended to the check-and-store flow (`completeCheckAndStore`) and de-prep
(`completeCheckAndDeprep`); `checkinAccessoryChildren` promoted to the shared
`line-item-fulfillment` module. Pure helpers extracted + unit-tested
(`pick-list-progress`, `getAccessoryChildren`). +18 tests.

### ~~Multi-quantity / model-level accessory correctness~~ ✅ FIXED (pending release)
Fixed on branch `fix/accessory-multiquantity`. `checkinAccessoryChildren` takes a `returnedAssetId` and
scopes a per-unit return to that unit's accessories — serialised children by
`asset.parentAssetId`, bulk children by the returned unit's per-unit share
(partial return). Wired through `checkInItems`, `completeCheckAndStore`, and
`completeCheckAndDeprep` (prepStatus reset). Bulk demand now scales with assigned
units (`expandAccessoriesForAsset` recomputes one bulk child of total quantity,
idempotent). Partial unique indexes (migration `20260605120000`) on
`(parentLineItemId, assetId|bulkAssetId)` where `childKind='ACCESSORY'` close the
expansion race, with a `isUniqueViolation` catch + update fallback.
`AccessoryChildRows` wired into the `bulk-group` deploy/return branch. Shared
`resolveAssetAccessories` profile. 5 multi-quantity isolation integration tests.

### Snapshot per-unit accessory contributions at deploy
**What:** Bulk accessory demand and per-unit return share are recomputed live from
current config + active units, not snapshotted per unit at checkout. Residual edge
cases (FEATUREDOCS/48 "Known edge cases"): a config edit mid-deployment doesn't
reconcile a removed bulk accessory down; an orphaned serialised accessory (parent
deleted → parentAssetId null) only returns on a whole-line return; per-unit deprep
clears all shared bulk rows' prepStatus.
**What to do:** Record each parent unit's accessory contribution (serialised child
ids + bulk {bulkAssetId, qty}) at deploy time (e.g. on the ProjectLineItemUnit or
a join row), and drive demand/return from the snapshot instead of recomputing.
**Why:** Makes bulk accessory counts exact under config churn and parent deletes;
serialised correctness already holds via parentAssetId.
**Context:** Residual edges from the v0.14.x multi-quantity fix. Serialised
isolation, concurrent-expansion (FOR UPDATE lock), and double-scan are already
correct; these are bulk-only and need a config edit / asset delete to trigger.
**Priority:** P2

### Pre-existing warehouse safety (surfaced during accessories review)
**What:** (1) `checkOutItems` fetches+updates an asset by global `assetId` via
`findUnique`/`update` without re-scoping to the caller's `organizationId` —
potential cross-tenant write. (2) Accessories are materialised AFTER the
test-and-tag checkout preflight (`assertTestTagAllowsCheckout`), so an
overdue/failed accessory can deploy without a compliance check.
**Why:** (1) is a multi-tenant isolation risk; (2) lets non-compliant gear ship.
**Context:** Flagged by Codex adversarial during the v0.14.0.0 ship; both are
pre-existing (untouched by that branch).
**Priority:** P1

### ~~Model-level bulk accessories~~ ✅ SHIPPED
Shipped in v0.13.0.0. `ModelBulkAccessory` join table — every asset of a
model inherits its defaults. Office add and warehouse scan-time both union
the asset's own bulk children with the model's defaults, deduped by
`bulkAssetId` so asset-level overrides win. UI: Accessories section on the
Model detail page; asset detail shows inherited rows tagged "from model".
5 integration tests.

### Accessories — Follow-ups from v0.11.0.0
- **Scan-time quantity overrides at re-scan.** `expandAccessoriesForAsset`
  dedupes by `bulkAssetId` only. If a model accessory expanded with qty=1
  and an operator later adds an asset-level override with qty=4 for the
  same bulkAsset, a re-scan won't update the existing row. Either update
  the existing row's quantity, or skip silently and document. P3.
- **Re-enable `DEDICATED` bulk allocation.** Server-side support exists; UI
  is currently SHIPS_WITH-only because DEDICATED was double-counting against
  live availability (`adjustBulkAvailability` decrement at attach + the
  expanded child line counted as a booking in `availability.ts`). Pick one:
  exclude DEDICATED accessory children from the live overbook query (sub-hire
  style), or drop the attach-time decrement. P3.
- **Bulk parents.** v1 restricts parents to serialised assets; "50 lights
  each with 2 clamps" can't be expressed yet. Unlocks the full Bulk Check-In
  payoff. P2.
- **Nested accessories.** Currently one level deep. Kits already nest;
  revisit only if requested. P3.
- **DEDICATED detach-while-out** — if `DEDICATED` is re-enabled, block
  detaching while the bulk units are still out on a project (currently we
  guard only the serialised case). P3.

## Warehouse Documents

### ~~Pick Slip + Delivery Docket Group/Category Awareness~~ ✅ SHIPPED
Branch `feat/pick-list-grouping-rework`. Phases 0-5, 7 commits, /autoplan-reviewed.
Per-template `expandProjectGroups` boolean (default true for warehouse types, false
for quote/invoice via `getDefaultSettings`). Read-time merge in `resolveTemplateSettings`
so legacy stored JSON picks up the new key safely. Sub-hire groups render as their
own "Sub-Hire: <Supplier> — <Group>" section. Kit boundary wins over Project Group
placement (`[Kit] <name>` section). Packer-walk sort (location → category → model
name) inside every bucket. Pagination orphan check (header + 1 body row reservation).
Both legacy and section-renderer pipelines updated. 48 new tests covering edge
cases the engineering review flagged. Follow-up: Cross-Type Group/Category
Unification (next branch, see [user-flagged] note below).

### Follow-ups from this PR
- **Template editor UI for `expandProjectGroups` toggle** — P3. The setting exists
  in `TemplateSettings.table.expandProjectGroups`; no UI to flip it per template
  yet. Orgs that want custom behaviour need a DB edit today.
- **Configurable packer sort order per org** — P3. `getPackerSortOrder()` returns
  a hard-coded `[location, category, modelName]` comparator. Two Toned might
  later want true rack-walk order (e.g. "Truss Room before Warehouse A" by route,
  not alphabetical).
- **Map-key collision composite keys** — P3. Theoretical bug: if two categories
  share an identically-named Project Group AND expand mode is on, those groups
  merge silently in the table plugin's bucket Map. Eng review flagged it; current
  state documents the case (no fix needed unless a user reports). Fix would need
  separate (key, displayLabel) fields on the plugin contract.
- **Delete delivery-docket kit special cases entirely** — P3. Both pipelines
  still special-case delivery-docket to promote kit children to top-level rows
  under a kit-name section. Phase 3b moved kit boundary into the data layer,
  but the special cases still run alongside (their CHECKED_OUT filter is the
  remaining bit of unique logic). A future cleanup can pull that into
  `structureLineItems` too.

### Bulk Check-In Totals Screen
**What:** Add a bulk check-in mode that shows child/bulk assets as totals across the whole job, not broken down per parent. Example: 50 lights each with 2 clamps + 1 true con — show "100 clamps to check in" and "50 true cons to check in" as single rows, let the operator enter how many they have in front of them and tick them off in one action.
**Why:** Current check-in requires checking in each accessory per parent asset. For a job with 50 lights, that's 150 individual check-ins instead of 3 totals. Painfully slow for accessory-heavy gigs.
**Pros:** Order-of-magnitude faster check-in for accessory-heavy jobs, matches how warehouse staff actually count (pile of clamps, count the pile).
**Cons:** New screen and reconciliation logic — once totals are entered, the system has to distribute them back to parent units (or accept that accessories are tracked at the aggregate level for this job). Need to handle partial shortfalls cleanly.
**Context:** Closely tied to the child-assets / accessories feature — only makes sense once accessories are modelled as children. Also dovetails with the unit-based fulfillment model.
**Depends on:** [[child-assets-accessories]] (this todo's accessory model). Fulfillment model rework (shipped).
**Estimate:** human ~1 week / CC ~30 min
**Priority:** P1

## Project Asset Management UX

### ~~Cross-Type Group/Category Unification~~ ✅ SHIPPED
Shipped in v0.9.0.0. Approach B as planned: `CategorySlot` table owns cross-type
sort order, `SubHireGroup.targetCategoryId` repurposed for placement,
`UnifiedAddDialog` replaces four separate per-kind dialogs, `SubHireGroupRow`
renders sub-hire groups as first-class table rows, `PriceEditDialog` covers both
group kinds, cross-type DnD with Drop Matrix 8C rejection, per-row keyboard
shortcuts e/m/d, show-margin Cost column toggle, inline "Create category"
from the Move dialog. Test gates S1, S2, S7, S8, S9, S10, S11, S15 all green
(1974 unit + 235 integration tests pass).

**Follow-up shipped in v0.9.3.0:** Line-item "Move" action split into two clearer
choices — "Move to category" and "Move to group" — replacing the combined picker
that confused users (selecting "Audio" vs "Audio > PA System" looked equivalent
but landed items in different places).

**Symmetry sealed in v0.10.0.0:** `ProjectGroup.categoryId` is now nullable
(matching `SubHireGroup.targetCategoryId`). Project groups can live in the
Uncategorized zone via the toolbar "Add Group" dialog and the per-group Move
dialog. The FK switched from `CASCADE` to `SET NULL` so deleting a category
orphans its groups instead of destroying every line item inside them. New
`getUncategorizedProjectGroups` server query mirrors the sub-hire equivalent.

Plan at [~/.gstack/projects/TwoToned-gearflow/jayden-main-plan-20260603-164457.md].
Full feature doc: [FEATUREDOCS/47-cross-type-equipment-unification.md].

### Multi-Select Drag (broken out from Cross-Type Unification scope)
**What:** Drag-select multiple line items in the project equipment table and move them between groups/categories in one action. Cmd/Shift-click adds rows to a persistent selection; the cursor shows a count badge during drag; on disallowed-target drops, a partial-reject toast lists which rows succeeded vs failed.
**Why:** Bulk reorganising is currently one item at a time — slow when restructuring a large project.
**Pros:** Quality-of-life win on the equipment tab; complements cross-type DnD.
**Cons:** New interaction model not yet in DESIGN.md (selection visual state needs a primitive). Half-feature if shipped underspecified.
**Context:** Originally scope-expansion for cross-type unification; pulled out during design review (Finding 11) as needing its own spec.
**Depends on:** Cross-Type Group/Category Unification (above).
**Estimate:** human ~3-5 days / CC ~45 min
**Priority:** P2

### Mixed-Type Group Templates
**What:** Extend group templates so they can capture asset items, sub-hire items, AND custom items inside a single template. Save a project group as a template and apply it to a future project with the same mix of types.
**Why:** Group templates today only capture asset items. Operators repeatedly recreate sub-hire + custom + asset combos for similar gigs.
**Pros:** Faster project building for repeat gig shapes (e.g., "Corporate AV — small").
**Cons:** Template apply must handle missing sub-hire suppliers (template captures supplier names; apply must let user re-pick).
**Context:** Deferred from Cross-Type Group/Category Unification autoplan (out of blast radius per P3).
**Depends on:** Cross-Type Group/Category Unification.
**Estimate:** human ~1 week / CC ~1-2 hours
**Priority:** P2

### Polymorphic LineItem Model (architectural re-evaluation trigger)
**What:** Collapse `ProjectLineItem`, `SubHireItem`, custom items into one `LineItem` table with an `ownership: owned | sub-hired | custom` discriminator. Sub-hire's PO workflow becomes a view over line items, not a parallel data universe.
**Why:** The 6-month regret scenario from the autoplan CEO review: if a 4th line-item type appears (loaner gear, freight, consignment, venue-provided), the current 3-parallel-models approach requires another schema delta, another row kind, another conditional branch. The polymorphic approach pays the migration once.
**Pros:** True architectural unification. Future types add without UI rework. Eliminates the schism the cross-type unification is papering over.
**Cons:** Large blast radius (~5-6 weeks human / 1-2 CC days). Touches every query, every PDF, every server action that reads project structure. Polymorphic queries in Prisma are awkward.
**Context:** Deferred during the cross-type unification autoplan (2026-06-03). **Re-evaluation trigger:** if a 4th line-item type request appears, OR if the post-ship review of the cross-type unification reveals that the symmetry promise still feels half-kept, revisit this. Subagent's strongest critique during CEO review.
**Depends on:** Nothing (large blast radius).
**Estimate:** human ~5-6 weeks / CC ~1-2 days
**Priority:** P3 (re-evaluate on trigger)

## Project Management

### ~~Configurable Auto-Incrementing Project Codes~~ ✅ SHIPPED
Shipped on branch `feat/project-codes`. Optional per-org template (e.g. `%YY%MM%INC` → June's
first project `260601`). Pure `%`-token engine (`src/lib/project-number.ts`: %YYYY/%YY/%MM/%M/
%DD/%D/%INCREMENT|%INC|%SEQ), configurable reset period (NONE/YEARLY/MONTHLY/DAILY) and
increment padding, stored in `OrgSettings`. Atomic `ProjectNumberSequence` counter (INSERT ON
CONFLICT) allocated inside the create txn with manual-collision retry; manual codes still win
and blank-without-format still errors. Settings → Project Defaults UI with live preview;
create-form shows the next code + "leave blank to auto-generate". 12 unit + 6 integration tests.
Full doc: [FEATUREDOCS/51](./FEATUREDOCS/51-project-numbering.md).

### Project Todo Lists (Asana-Style)
**What:** Add a todo/task list to each project. Tasks have title, assignee (org member or crew), due date, status, optional description, optional checklist. Project detail page gets a Tasks tab. Optional: dashboard view of "my open tasks across projects."
**Why:** Operators currently use external tools (Asana, Notion, Slack threads) to track project-specific to-dos. Pulling this into the platform means tasks are linked to the project, visible to the team, and don't fall through the cracks.
**Pros:** Single source of truth for project work, reduces tool switching, can surface overdue tasks on dashboards.
**Cons:** New schema (Task model with relations to Project, User/CrewMember). Needs notification integration. Risk of half-baked "task manager" that nobody uses if it's not as fast as Asana.
**Context:** User asked for this in their Gearflow TODO. Start minimal — title, assignee, due date, status — and expand only if used.
**Depends on:** Nothing.
**Estimate:** human ~2 weeks / CC ~2 hours
**Priority:** P2

## Calendar Integration

### ~~iCal Timezone Audit~~ ✅ FIXED
Shipped on branch `fix/ical-timezone`. Root cause: `formatICalDate` used `Date.getHours()` (server-local time) and emitted unanchored "floating time" DATE-TIMEs with no TZID, VTIMEZONE block, or `Z` suffix. On Vercel (UTC server) a Sydney 9am event became `DTSTART:...T230000` floating — Google Calendar rendered it at 11pm in the viewer's local zone, shifted by ~10–11h. Fix: TZID-anchored DTSTART/DTEND with hardcoded VTIMEZONE blocks for AU + common intl zones (DST-aware via RRULE), UTC DTSTAMP per RFC 5545, `Intl.DateTimeFormat`-based tz conversion (no new deps), org timezone read from `OrgSettings.timezone` (default Australia/Sydney). 16-test regression suite in `src/lib/ical.test.ts`.

## Platform Integrations

### Public REST/GraphQL API
**What:** Build a public API for integrating with external tools. Read endpoints for projects, assets, availability; write endpoints for creating projects, line items, checkouts. Auth via API keys scoped per organisation. Rate limiting, audit logging, OpenAPI spec.
**Why:** Operators want to integrate with their accounting (Xero), CRM (HubSpot), or custom dashboards. Currently the only integration is WooCommerce. A general API unlocks every other workflow.
**Pros:** Unlocks third-party integrations, makes the platform a hub instead of a silo, enables enterprise deals that require integration.
**Cons:** Large surface to design, document, version, and maintain. Need API key management UI, rate limits, scopes, versioning strategy. Security review essential.
**Context:** User flagged this in their Gearflow TODO. Existing server actions follow consistent patterns (permission check → query → log → serialize) which makes API wrappers straightforward, but the actions are RPC-shaped, not REST-shaped — wrapping vs. rewriting is a design call.
**Depends on:** Nothing (greenfield).
**Estimate:** human ~6-8 weeks / CC ~1 day for scaffolding
**Priority:** P2

## Documentation

### User Guide (Docusaurus, Separate Repo)
**What:** Build a public user-facing documentation site with Docusaurus (or similar). Covers onboarding, every major feature (assets, projects, warehouse flow, kits, sub-hires, reports), troubleshooting, and a "what's new" changelog. Hosted at docs.gearflow.app or similar. Likely a separate repo.
**Why:** Operators currently have no self-serve documentation. Every question is a support touch. A real user guide lets new orgs onboard themselves and reduces support load.
**Pros:** Reduces support burden, improves onboarding, marketing value (SEO, demos), credibility for enterprise sales.
**Cons:** Significant ongoing maintenance cost — docs go stale fast. Needs writer time, screenshots, and a workflow for keeping docs in sync with releases.
**Context:** User flagged this in their Gearflow TODO. Separate repo recommended to keep the main app's CI fast and let docs ship independently.
**Depends on:** Nothing.
**Estimate:** human ~4-6 weeks initial / ongoing maintenance
**Priority:** P2

### Dev / Internal Documentation Overhaul
**What:** Pass through every FEATUREDOCS file plus CLAUDE.md and ARCHITECTURE.md. Verify accuracy against current code, prune stale sections, fill gaps (new features added without doc updates), and re-link cross-references. Improve the index in ARCHITECTURE.md.
**Why:** Docs drift. FEATUREDOCS has 30+ files but coverage is uneven — some features have extensive docs, others are stubs. A periodic audit keeps the docs trustworthy for both humans and the agent.
**Pros:** Faster onboarding for new contributors, better agent context, surfaces dead code / orphaned features.
**Cons:** Time investment with no user-visible output. Easy to defer indefinitely.
**Context:** User flagged this in their Gearflow TODO. Run after a release cluster, not mid-feature.
**Depends on:** Nothing.
**Estimate:** human ~1 week / CC ~3-4 hours
**Priority:** P3

## UI / UX

### System-Wide UI/UX Overhaul
**What:** Full pass across every page to make the app feel cohesive. Audit spacing, typography, component patterns, empty states, loading states, error states, microcopy, iconography, motion. Surface inconsistencies (different buttons in similar slots, off-by-default-rhythm spacing, mixed metaphors). Fix them.
**Why:** App has grown organically across 30+ features. Individual pages are polished but they don't all feel like they belong to the same product. Operators notice this — it erodes trust.
**Pros:** Product feels professional and intentional, fewer "this feels different from the other screen" support tickets, better foundation for marketing screenshots.
**Cons:** Hard to scope — could be 2 weeks or 2 months. Easy to spiral into rewrites. Needs a design lead + a strict cutoff.
**Context:** User flagged this. DESIGN.md is the source of truth for visual decisions — overhaul should enforce DESIGN.md compliance, not relitigate it. Wave 1/2 cleanup (StatusIndicator, DeleteDialog, DESIGN.md typography sweep) is good groundwork — extend the same approach to the whole app.
**Depends on:** Nothing (but `/design-review` is the tool to use).
**Estimate:** human ~4-6 weeks / CC ~1-2 days per surface
**Priority:** P2

### Mobile-First Overhaul
**What:** Full mobile pass beyond the current scanner/PWA work. Audit every page on mobile, fix tap targets, sticky bars, modal sizing, table responsiveness, sidebar behavior, scan-to-action flows. Make warehouse staff and on-site PMs first-class users on phones.
**Why:** Half of warehouse work happens on phones — scanner, checkin, lookup. Office/PM work increasingly happens on phones too. Some screens are still desktop-first with mobile as an afterthought.
**Pros:** Unlocks field-first workflows, faster warehouse ops, better on-site PM experience.
**Cons:** Touches every page. Some patterns (dense tables, side-by-side detail layouts) need genuine redesign, not just CSS tweaks.
**Context:** Partial groundwork done — PWA, scanner reliability, safe-area fixes (732b97b, b30dfcc, e645b4b). Full per-page audit hasn't happened.
**Depends on:** Nothing.
**Estimate:** human ~3-4 weeks / CC ~1 day per surface
**Priority:** P2

## Services & Crewing

### Big-Picture Services & Crewing Rethink
**What:** Step back from the existing crewing/services system and rethink it. How should services, crew, projects, schedules, availability, pay rates, travel, and notifications integrate? Today they're a collection of features that work but don't feel like one system. Design a unified model and migrate.
**Why:** User flagged this as "revise this and think big on how it can be way smarter and integrate together better." The smaller crewing TODOs (travel distance, availability index) are tactical — this is the strategic rework.
**Pros:** Aligns the whole crew/services surface, unlocks the smaller deferred items as natural consequences instead of bolt-ons.
**Cons:** Strategy task, not an implementation task. Easy to over-scope. Needs `/office-hours` or `/plan-ceo-review` before any code is written.
**Context:** User flagged this in their Gearflow TODO. Existing surface: CrewMember, CrewAssignment, ProjectService, service categories, schedule view, call sheets. Pay rates and travel exist but aren't fully wired into assignment decisions.
**Depends on:** Nothing (planning task).
**Estimate:** planning ~1 week / implementation depends on outcome
**Priority:** P2

## Wave 3 — Remaining Features

The remaining items from Wave 3 ("Dream Big Inside the Wedge") in
`docs/designs/app-cleanup-unification.md`. Per that plan, Wave 3 is ongoing
and ships one feature at a time — each gets its own `/autoplan` review
pipeline. There is no Wave 4. Cross-warehouse transfers from the original
Wave 3 list are excluded — Two Toned operates a single warehouse.

### Calibration / Certification Tracking
**What:** Track calibration and certification profiles for assets beyond the Test & Tag electrical-safety module — custom cert types with their own intervals, due dates, and pass/fail history (e.g. rigging inspections, load-cell calibration, lamp-hours).
**Why:** Test & Tag only covers AS/NZS 3760 electrical testing. AV inventory has gear with other compliance regimes that currently have no home in the app.
**Pros:** Extends the compliance moat; reuses the T&T reminder/notification patterns.
**Cons:** Needs a flexible cert-profile model so operators can define their own types without a schema migration — overlaps with the Custom Fields infrastructure.
**Context:** Wave 3 AV-differentiator. Model after the existing Test & Tag module (`FEATUREDOCS/14`) and maintenance reminders.
**Depends on:** Nothing hard; custom-field infrastructure (v0.6.0.0) is a useful base.
**Estimate:** human ~1.5 weeks / CC ~1-2 hours
**Priority:** P2

### Self-Service Crew Portal
**What:** A scoped portal where crew members log in to view their offered assignments, accept or decline them, and log their own time — without giving them full app access.
**Why:** Crew assignment and timesheets are currently operator-driven. A self-service surface cuts the admin loop and reduces no-shows.
**Pros:** Biggest operational-leverage item in Wave 3; crew already exist as first-class records with auth tokens (auditor-token pattern is a precedent).
**Cons:** Largest remaining Wave 3 item. Needs a permission-scoped role/surface, careful auth boundary, and mobile-first UX.
**Context:** Wave 3 operational quality-of-life. Crew management (`FEATUREDOCS/31`), crew availability, and timesheets already exist; this is the member-facing front-end.
**Depends on:** Crew management, crew availability, time entries (all shipped).
**Estimate:** human ~3-4 weeks / CC ~3-4 hours
**Priority:** P2

### Saved Filters Per Entity
**What:** Let users save named filter/sort/column configurations on list pages and recall them, with a consistent UX across every list page.
**Why:** Operators repeatedly re-apply the same filters (e.g. "overdue projects", "assets in maintenance"). Saving them removes repetitive setup.
**Pros:** Cheap, high-frequency win; touches every list page through the shared DataTable.
**Cons:** Needs a place to persist configs (per-user, org-scoped) and a tasteful save/recall UI.
**Context:** Wave 3 operational quality-of-life. Build on the shared DataTable (`FEATUREDOCS/25`) and existing table-preferences hook (`use-table-preferences`).
**Depends on:** Shared DataTable + table-preferences infrastructure (shipped).
**Estimate:** human ~1 week / CC ~45 min
**Priority:** P2

### Bulk Operations Across List Pages
**What:** Multi-select rows on list pages and apply an action to all of them — bulk status change, bulk delete/archive, bulk tag, bulk export.
**Why:** Today most mutations are one-record-at-a-time. Bulk actions are a large time-saver for inventory and project housekeeping.
**Pros:** Cheap, high-frequency win; touches every list page through the shared DataTable.
**Cons:** Each entity needs its own safe set of bulk actions + permission checks; bulk writes must be transactional and audit-logged.
**Context:** Wave 3 operational quality-of-life. Build on the shared DataTable (`FEATUREDOCS/25`); follow the server-action pattern (requirePermission → transaction → logActivity).
**Depends on:** Shared DataTable (shipped).
**Estimate:** human ~1.5 weeks / CC ~1-2 hours
**Priority:** P2

### In-App Onboarding Tour
**What:** A first-run guided tour highlighting key surfaces (catalog, projects, warehouse, settings) for new users/orgs.
**Why:** New operators currently get no orientation. A tour shortens time-to-value.
**Pros:** Self-contained; no schema or server work beyond a "tour completed" flag.
**Cons:** Lower operational leverage than the other items; tour content must be maintained as the UI evolves.
**Context:** Wave 3 operational quality-of-life.
**Depends on:** Nothing.
**Estimate:** human ~3-4 days / CC ~30 min
**Priority:** P3

### Comments / @Mentions on Projects + Assets
**What:** Threaded comments on projects and assets with @mention of team members; mentions raise a notification.
**Why:** Operational discussion currently happens outside the app (chat, email). In-app comments keep context attached to the record.
**Pros:** Strengthens the app as the single source of truth; reuses the existing notification system.
**Cons:** New Comment model + mention parsing + notification wiring; needs activity-log and search integration to be first-class.
**Context:** Wave 3 operational quality-of-life. Wire into notifications (`FEATUREDOCS/17`), activity log (`FEATUREDOCS/24`), and global search (`FEATUREDOCS/16`).
**Depends on:** Notification system (shipped).
**Estimate:** human ~2 weeks / CC ~1-2 hours
**Priority:** P3

### AssetHold Table — Derived Asset Status (architecture)
**What:** Replace the single mutable `Asset.status` enum with a derived-status model: multiple "hold" rows in an `AssetHold` table (maintenance, checkout, T&T, lost/retired), with the displayed status computed from the active holds.
**Why:** Multiple workflows mutate `Asset.status` independently and overwrite each other. The Wave 1 guarded-update pattern is a partial mitigation, not a fix.
**Pros:** Eliminates a whole class of status-overwrite bugs; status becomes auditable.
**Cons:** Significant migration — every status writer and reader changes. Only worth it if status-overwrite bugs keep recurring.
**Context:** Flagged "Wave 3+ architectural improvement" by the eng review in `docs/designs/app-cleanup-unification.md`. Do only if the pain shows up.
**Depends on:** Nothing; large blast radius.
**Estimate:** human ~2-3 weeks / CC ~2-3 hours
**Priority:** P3

### InventoryMovement Ledger (architecture)
**What:** Model bulk-asset availability as a ledger of `InventoryMovement` rows (every check-out, check-in, kit-pack, maintenance-pull is a movement) instead of a mutable `availableQuantity` field; current quantity becomes a sum.
**Why:** A mutable quantity field drifts and is hard to reconcile. A ledger is self-auditing and never silently wrong.
**Pros:** Reconciliation becomes trivial; full movement history for free.
**Cons:** Large migration; every availability read/write changes. Only worth it if reconciliation pain persists.
**Context:** Flagged "Wave 3+ architectural improvement" by the eng review in `docs/designs/app-cleanup-unification.md`. Do only if reconciliation pain persists.
**Depends on:** Nothing; large blast radius.
**Estimate:** human ~2-3 weeks / CC ~2-3 hours
**Priority:** P3
