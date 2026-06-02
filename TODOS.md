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

### Child Assets / Accessories
**What:** Allow serialised and bulk assets to be permanently attached to other serialised assets as children/accessories. E.g. "IEC cable" attached to "Mixer", "Adaptor" attached to "JAG Headset Mic". When the parent asset is added to a project, children come with it automatically. When the parent is checked out/in, children move with it.
**Why:** Lots of gear has fixed accessories that always travel together but aren't really kits (no formal container, no separate pricing). Currently operators either add accessories as separate line items (clutter) or omit them and hope they ship with the parent (errors).
**Pros:** Models reality of how gear actually moves, reduces line-item clutter, fewer missed accessories at deploy, no need to build a kit for every cable.
**Cons:** New schema relationship (`Asset.parentAssetId`?), needs UI on asset form to attach/detach children, warehouse flows need to propagate parent → children scans, PDFs need to decide whether to show children indented or hide them.
**Context:** Different from kits — kits are containers with their own asset tag and rental contract; accessories are inseparable from their parent. Bulk asset children (e.g. 1 mixer always ships with 1 IEC) and serialised children (specific IEC tracked individually) both need to work.
**Depends on:** Nothing (greenfield feature, but touches warehouse, pull sheet, delivery docket, kit boundary).
**Estimate:** human ~2 weeks / CC ~2-3 hours
**Priority:** P1

## Warehouse Documents

### Pick Slip + Delivery Docket Group/Category Awareness
**What:** Rework the pick slip and delivery docket to be group- and category-aware. Pick slip should be optimised for packing (grouped by location/case/category in a packer-friendly order). Delivery docket categories should be smarter — respect project groups, sub-hire groups, kit boundaries.
**Why:** Currently both documents treat line items as a flat list with basic category sorting. Pick slip doesn't help packers find gear efficiently; delivery docket groups don't match what's on the project. Linked to the checkout-logic rework — now that fulfillment is unit-based, these PDFs can render unit-level detail intelligently.
**Pros:** Faster packing, fewer mis-picks, clearer client docs, consistent grouping across all project documents.
**Cons:** Section-based template builder must support new section types for grouped layouts. Need to define the "packer order" heuristic (location? category? case?).
**Context:** Follow-on from the line-item fulfillment model rework. Pick slip and delivery docket are currently in the section-based PDF builder but use generic list renderers that don't know about groups/sub-hire-groups/kits.
**Depends on:** PDF template builder section-based architecture (shipped).
**Estimate:** human ~1 week / CC ~45 min
**Priority:** P1

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

### Cross-Type Group/Category Unification
**What:** Unify how groups and categories work across asset, sub-hire, and custom line items on a project. Today each type has its own UX patterns — adding groups, moving items between groups, setting pricing per group all feel different. Make creating new groups and reorganising assets fast and obvious. Eliminate the need to delete and re-add items to reorganise.
**Why:** Currently this is confusing and slow. Small changes (move an item to a different group) require deleting and re-adding. Pricing is set in different places depending on type. New users don't know which "add" button does what.
**Pros:** Massive UX win on the most-used screen, reduces support questions, makes complex jobs faster to build.
**Cons:** Touches a lot of code — line items, groups, sub-hire groups, custom items, pricing modes, and every component that renders the project equipment table. Risk of regression in pricing/totals.
**Context:** Sub-hire groups shipped (a3f5a02, ccbe715). Asset groups and custom-item groupings still uneven. User flagged this as "currently feels super clunky and unfinished."
**Depends on:** Nothing (refactor of existing surface).
**Estimate:** human ~2-3 weeks / CC ~3-4 hours
**Priority:** P1

## Project Management

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
