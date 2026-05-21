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

### Configurable Days-Per-Month
**What:** Make the "1 month = X days" constant configurable at the org level (stored in Organization.metadata). Default 28.
**Why:** Rental companies use 28, 30, or calendar-month billing depending on market norms. Currently hardcoded as `DAYS_PER_BILLING_MONTH = 28`.
**Pros:** Supports different industry conventions without code changes.
**Cons:** Adds a setting most orgs won't change.
**Context:** Deferred during /autoplan eng review. Named constant in src/lib/pricing.ts.
**Depends on:** Pricing optimization feature.
**Estimate:** human ~2 hours / CC ~10 min
**Priority:** P3

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

### Template Editor Settings for New Section Types
**What:** Add settings panels in the template builder for `call-sheet-info` and `day-header` section types. Currently these sections work with default settings but can't be customized through the template editor UI.
**Why:** Users should be able to toggle visibility of PM contact, venue details, schedule times, equipment summary, phases, and crew count in the template builder.
**Pros:** Full customizability of call sheet layouts.
**Cons:** Sections already work with sensible defaults.
**Context:** Deferred from call sheet enhancement plan (Phase 6). Section types are registered, plugins work, Zod schemas exist. Just needs the SectionSettingsPanel cases and editor sidebar entries.
**Depends on:** Nothing (infrastructure is complete).
**Estimate:** human ~2 hours / CC ~15 min
**Priority:** P3

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

### Crew Availability Composite Index
**What:** Add a composite index on `CrewAssignment(crewMemberId, startDate, endDate)` to optimize the cross-project availability overlap query.
**Why:** The inline crew assignment feature queries all assignments for a set of crew members across all projects, filtering by date range overlap. Without a composite index, this becomes a sequential scan as the assignment table grows.
**Pros:** Prevents slow availability lookups when crew assignment count exceeds ~10K rows.
**Cons:** Adds a write-time index maintenance cost. Negligible for this table's write volume.
**Context:** Identified during eng review of services/crewing rework. The availability query uses `WHERE crewMemberId IN (...) AND startDate <= :endDate AND endDate >= :startDate`. Prisma auto-creates an index on `crewMemberId` (foreign key) but not the composite with date fields.
**Depends on:** Services/crewing rework (cross-project availability check).
**Estimate:** human ~15 min / CC ~2 min
**Priority:** P3

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
