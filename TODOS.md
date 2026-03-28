# TODOS

Deferred work items tracked from engineering reviews and planning sessions.

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
