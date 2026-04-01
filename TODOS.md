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

## UI / UX

### Warehouse "Today" Date Boundary Bug
**What:** The warehouse urgency grouping uses `tomorrow.setDate(today.getDate() + 2)`, creating a 2-day window for "today" (includes today + tomorrow). The label says "today" but it means "today and tomorrow."
**Why:** Users may be confused by a project starting tomorrow appearing in the "today" group. Either the window should be 1 day (true "today"), or the label should say "Next 48 hours" / "Today & Tomorrow."
**Pros:** Clearer urgency grouping, less user confusion.
**Cons:** Trivial fix. If the 2-day window is intentional (prep window), just relabel.
**Context:** In `src/app/(app)/warehouse/page.tsx`, function `getProjectUrgency()`. The `+2` was present in the original code before the UX redesign — it's inherited, not new.
**Depends on:** Nothing.
**Estimate:** human ~15 min / CC ~2 min

### Extract DetailLayout and SidebarSection Components
**What:** All 10 detail pages copy-paste the same 2-column layout and sidebar section styling. Extract reusable `DetailLayout` and `SidebarSection` components.
**Why:** ~80 duplicated border/spacing declarations across 10 files. One styling change requires editing 10 places.
**Pros:** DRY, consistent styling enforced in one place, each detail page shrinks ~30 lines.
**Cons:** Adds abstraction layer. Minor risk of over-constraining future detail pages.
**Context:** Accepted in eng review (issue #2). Pattern: main content (flex-1) + sticky sidebar (lg:w-[340px]) with `border-b border-border pb-4 space-y-2` section dividers.
**Depends on:** Nothing.
**Estimate:** human ~3 hours / CC ~15 min

### Extract Shared Formatters *(partially done)*
**What:** Six+ pages define their own `formatDate()` and `formatCurrency()` with identical AU locale/AUD logic. Extract to `src/lib/formatters.ts`.
**Status:** `src/lib/formatters.ts` created in v0.2.6 with `formatCurrency`, `formatDate`, and `formatLabel`. Remaining work: migrate existing inline formatters in other files to use the shared module.
**Depends on:** Nothing.
**Estimate:** human ~30 min / CC ~5 min

### Add ReducedMotionProvider Context
**What:** All 6 motion components in `motion.tsx` each call `useReducedMotion()` individually. Extract to a React context provider so it's read once.
**Why:** DRY — 6 hooks reading the same value. Minor perf improvement (1 media query listener vs 6).
**Pros:** Cleaner code, single source of truth for motion preference.
**Cons:** Adds provider wrapper to component tree.
**Context:** Accepted in eng review (issue #1).
**Depends on:** Nothing.
**Estimate:** human ~1 hour / CC ~5 min

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
