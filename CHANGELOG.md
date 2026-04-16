# Changelog

All notable changes to GearFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-04-16

### Added
- Duplicate model detection in add equipment dialog. When adding a model that already exists on the project, users can choose to combine (merge quantity) or add as a separate line item.
- Sub-hire items always create separate line items and never merge with own-stock items of the same model.
- `forceSeparate` parameter on `addLineItem` server action to bypass auto-merge.

## [0.4.2] - 2026-04-16

### Fixed
- Editing a line item no longer wipes its model association. The `updateLineItem` server action was unconditionally setting `modelId` to null when the edit dialog didn't send it, which removed the item from all overbook calculations and made the badge disappear after any edit.
- Edit dialog now correctly warns when a line item is overbooked due to in-maintenance, lost, or retired assets. Previously, the edit dialog compared against raw stock (including unavailable assets), so overbooked items appeared editable without warnings.
- Adding a second line item for the same model on a project now shows accurate availability. The add dialog previously displayed stale stock counts because cache wasn't refreshed after edits, removes, or moves.
- Server-side availability enforcement in both add and update paths now uses effective stock (excluding unavailable assets), matching the overbook badge logic.

### Added
- Edit dialog now shows full availability info (available count, usable stock, unavailable asset breakdown, conflicting projects), matching the add dialog experience.
- `computeStockBreakdown` helper centralizes stock calculations across all availability checks, preventing client/server divergence.

## [0.4.1] - 2026-04-15

### Added
- Group template picker in the project equipment tab's Add Group dialog. Selecting a template auto-fills the group title and flips the create action to apply the template's items; leaving it blank creates an empty group as before.
- "Save as Template" action on each project group dropdown, with a dialog pre-filled from the group title. Captures the group's model- and kit-backed line items via `saveGroupAsTemplate` and invalidates the templates query so newly saved templates appear immediately in the picker.
- Group Templates management page at `/settings/group-templates` (nav entry gated by `project:manage_line_items`). Lists all templates sorted by name with expandable item previews (kit vs. model icons, quantity badges), rename/description edit dialog, and a delete dialog that clarifies existing projects keep their line items.

### Fixed
- `updateGroupTemplate` item-replace path no longer drops `kitId` and `sortOrder` when rebuilding template items.

## [0.4.0] - 2026-04-15

### Added
- Kit delete flow: the kit detail page now exposes a `DeleteKitDialog` with two tiers. Archive (soft delete) is always available while the kit is AVAILABLE + active, and is the default; hard delete is an opt-in second option that is blocked whenever any `ProjectLineItem` references the kit, so historical project data is preserved. The dialog surfaces a human-readable reason when hard delete is unavailable. New server actions `canDeleteKit(id)` and `deleteKit(id)` back the UI, gated by the existing `kit:delete` permission.
- Group templates now support kit items in addition to model items. `GroupTemplateItem` got a nullable `kitId` column and a Zod XOR refine so each row references exactly one of `modelId`/`kitId`. A template can mix both: "FOH Package" = 2x SM57 (model) + 1x rack kit (rigid). `saveGroupAsTemplate` captures both kinds from the source group; `applyGroupTemplate` creates the model lines inside the same transaction as the new group, then delegates kit items to `addKitLineItem` per unit of quantity (so "2x rack kit" becomes two independent parent rows with their full child expansions). Kit expansion failures (conflicts, availability) are collected as warnings rather than aborting the apply, matching warehouse-staff expectations.

### Removed
- The unused `KitPreset` / `KitPresetItem` tables (introduced in an earlier WIP migration) have been dropped in favor of extending the existing `GroupTemplate` system. The `group_template_supports_kits` migration atomically drops the orphan tables and adds `kitId` + `sortOrder` to `group_template_item`.

## [0.3.5] - 2026-04-15

### Added
- Keyboard shortcuts in the warehouse item check form: `P`/`F` to pass/fail the focused PASS_FAIL row with auto-advance, `A` to pass all remaining, `↑`/`↓` to move the focused-row cursor (skips non-PASS_FAIL rows), `Enter` to submit. Shortcuts are suppressed while typing in a text input, while submitting, or with a modifier key held. Desktop-only hint bar in the sheet footer shows the available keys.
- Deprep check gate: deprepping a returned item whose model has check items now runs a second RETURN-context check at deprep time (the inventory↔staging boundary), in addition to the existing return-scan check. Matches the mental model where Deploy is a staging ground on both sides of the truck. Damaged/flagged items bypass the second check. Kits respect `KitCheckMode` (KIT_LEVEL runs one kit-level check, PER_ITEM runs a queue entry per child).
- New `completeCheckAndDeprep` server action that writes RETURN-context check records and resets `prepStatus=PENDING` in one transaction.
- React component test infrastructure (`@testing-library/react` + jsdom) with 11 keyboard-handler tests for `ItemCheckForm`. Existing 1656 node-env validation tests are unaffected.

### Fixed
- Scan input auto-refocus after check completion: `finishCheckQueue` now returns focus to the correct scan input via `requestAnimationFrame` (PREP → main scan input, RETURN → return-tab scan input, deprep → deploy-tab scan input), letting barcode scanners flow scan-to-scan without a mouse click between checks.
- Timer leak in `ItemCheckForm` pass-all undo window — the 3-second setTimeout is now cleared on form close and component unmount.
- `completeCheckAndDeprep` pre-condition guard now strictly enforces `status=RETURNED` and `prepStatus=PACKED`, rejecting CONFIRMED/PREPPING items that could previously have been written against by a race or UI bug.

## [0.3.4] - 2026-04-15

### Fixed
- Edit line item dialog (equipment tab) now shows overbooking warnings and requires confirmation to save an overbooked quantity — previously the warning only existed when adding items
- Overbooked badge in the equipment table now wraps onto a second line on narrow viewports instead of overflowing outside the table column, so the badge is visible on mobile
- Sub-hire line items no longer consume our own stock in availability/overbooking calculations — they represent third-party rental so they should be invisible to our inventory math (fixed in `addLineItem`, `updateLineItem`, `checkAvailability`, and `computeOverbookedStatus`)
- `updateLineItem` now enforces availability server-side when quantity increases, matching `addLineItem` — previously the `allowOverbook` parameter was accepted but never checked, letting the client bypass overbook confirmation
- Project status changes (cancelled, completed, returned, invoiced) now invalidate overbook/availability caches across all open projects, so stock freed up by the transition is visible immediately instead of after a 30s stale window
- Edit dialog overbook warning now surfaces a "no dates set — checking stock only" notice when the project has no rental dates, matching the add dialog

### Removed
- Dead code: `line-items-panel.tsx` and `edit-line-item-dialog.tsx` were imported but never rendered (replaced by `equipment-tab.tsx`). Deleting them prevents future audits from getting misled by stale overbooking logic in an unreachable component.

## [0.3.3] - 2026-04-14

### Fixed
- Overbooking badges and availability conflict detection now work when adding equipment to projects (dates were not being passed through to the availability checker)
- Overbooking badges now refresh immediately after adding, editing, or removing line items instead of staying stale for up to 30 seconds
- Kit additions and line item deletions via the line items panel now also refresh overbooking status

## [0.3.2] - 2026-04-01

### Added
- Timeline PDF multi-page pagination: services that overflow one page now automatically split across multiple pages with continuation headers
- Timeline PDF column settings: configurable columns (crew, location, notes, charge, cost, status) via query params with sensible defaults

### Fixed
- Crew members with multiple roles on the same project no longer appear as duplicate rows on call sheets, roles are merged into a single entry
- Day-header separators between dates on multi-day call sheets now have stronger visual separation with background fill and thicker borders
- Unicode bullet character in day-header replaced with ASCII pipe for Helvetica font compatibility
- Timeline route no longer loads unnecessary crew assignment data from the database
- Crew role deduplication now uses exact match instead of substring match, preventing silent role drops

## [0.3.1] - 2026-04-01

### Added
- Multi-day call sheets: generate one PDF with separate pages per day, each with day header showing date, phase badges, and crew count
- Per-person call sheets: filter to a single crew member's schedule across all days
- Crew role filtering: filter call sheet output to a specific crew role
- Call sheet info section: dense 2-column block showing PM contact, client, venue, schedule times, and equipment summary on call sheets
- Call sheet generation dialog: date picker with crew count badges, role filter, and individual crew member selector
- PM contact extraction from ProjectManager join table for call sheet info
- Equipment summary computation for call sheet context
- Day header pdfme plugin with accent bar, bold date label, and phase badges
- Call sheet info pdfme plugin with configurable visibility toggles
- 17 new tests covering section expansion logic, height estimation, and Zod validation

### Fixed
- Cap dates query parameter at 31 before parsing to prevent unbounded allocation

## [0.3.0] - 2026-04-01

### Added
- Sub-hire order system: first-class entities for tracking gear rented from third-party suppliers
- Dual cost/charge pricing with gross margin analysis on every sub-hire order
- Sub-hire groups: organize items into logical sections with group-level pricing overrides
- Two pricing modes: itemized (per-item costs) or order total (single lump sum)
- Supplier rate memory: last-used rates saved per model+supplier pair, auto-filled on next order
- Cost comparison panel: see rates from all suppliers when adding items to a sub-hire
- Sub-hire lifecycle: Draft → Confirmed → On Hire → Returned, with automatic line item generation on confirm
- Per-item placement targeting: assign sub-hire items to specific project categories/groups
- Per-item document visibility: control which items appear on quotes, invoices, and packing lists
- Sub-hire items integrate into project financial totals (subtotal, tax, total)
- Dashboard metrics: active sub-hires count, monthly sub-hire cost, overdue returns
- Shortage-triggered sub-hire: when adding equipment exceeds stock, prompt to sub-hire the shortfall
- Quick duplicate: clone a sub-hire order to a new draft with same items
- "via Supplier" display on sub-hire items across warehouse tabs and pull sheets
- Subhire badge on pull sheet (HTML and PDF) for internal warehouse documents
- Supplier name rendering on PDF packing lists and delivery dockets
- Payment status tracking and file attachments on sub-hire orders
- 94 new validation schema tests for sub-hire system

### Changed
- Legacy free-text "Add Subhire" dialog removed in favor of structured sub-hire orders
- Sub-hire status actions moved to header dropdown menu on project detail
- Equipment tab shows sub-hire items as kit-style groups with children
- Financial summary now includes sub-hire charges in project totals

### Fixed
- Duplicate line item generation when re-confirming sub-hire orders
- Sub-hire items appearing as regular flat line items instead of grouped display
- Sub-hire costs not flowing through to project financial calculations
- Cross-tenant write vulnerability in sub-hire item reorder (org scoping added)
- Missing org scoping on sub-hire status return path and line item sync queries

## [0.2.6] - 2026-03-28

### Added
- Project finance rewrite: billing weeks/days pricing model with per-group overrides
- Equipment tab category/group/line-item hierarchy with drag-and-drop reordering
- Line item edit dialog, move between groups, and uncategorized items section
- Category rename/delete UI with inline editing
- Group edit dialog with price field and suggested price hint
- Project manager picker and rental defaults on project form
- Merge notification toast when equipment items combine
- Template picker, pricing progress bar, and audit trail on project detail
- Default tax rate in org settings
- Financial summary sidebar with margin tracking
- 42 new validation and formatter tests for finance schemas

### Changed
- Equipment tab rewritten as proper flat table layout with table-layout fixed
- Group rows match line item style with edit button and dropdown menu
- Removed legacy groupName field from add dialogs, replaced with "Adding to" label
- Removed pricing approval UI (accept suggested price buttons)
- Project form UX overhaul: billing time under rental dates, match button

### Fixed
- Drag-and-drop: replaced nested DndContexts with single flat context using prefixed IDs
- Table column reflow on group expand/collapse (table-layout: fixed + colgroup)
- Broken callbacks and missing query invalidations in equipment tab
- Move dialog now defaults to item's current group instead of uncategorized

## [0.2.5] - 2026-03-25

### Added
- Warehouse check item system: org-scoped check item library with PASS_FAIL, NOTES, MEASUREMENT, and DROPDOWN types
- Model and kit check item assignments with drag-to-reorder and library picker
- Three-phase warehouse prep flow: Pick → Prep (with checks) → Deploy, replacing the old single-step checkout
- Check form sheet (full-screen mobile, slide-over desktop) with "Pass All" shortcut and photo upload on failures
- Multi-item check queue for serial/bulk prep and return flows
- Container grouping system: prepContainer field with auto-add container assets, container picker with category search
- Kit check modes: KIT_LEVEL (check the kit itself) and CHILD_ITEMS (check each child individually)
- PrepStatus and ReturnStatus enums for independent warehouse lifecycle tracking
- Warehouse close-out: per-project close with summary stats, batch close from dashboard
- Check history tab on asset detail pages with context filtering
- Model failure analytics widget showing per-check-item failure rates
- Ad-hoc check route at `/check/[assetTag]` for standalone inspections
- Predictive maintenance: auto-creates maintenance records when 2+ consecutive failures detected
- Flagged asset notifications for project managers
- Check items integrated into global search and page commands
- `splitLineItem` helper for DRY multi-quantity line item splitting (extracted from 5 duplicated sites)
- Bulk assign check items to multiple models from the model table (row selection + multi-select dialog)
- 61 new validation tests for check item schemas
- Container grouping in pull sheet PDFs with asset tag display

### Changed
- Warehouse page split into tab components (deploy-tab, return-tab, pick-prep-tab, close-out-tab) from monolithic 2700-line page
- Prep flow uses split-based pattern: multi-qty items split off qty=1 items during prep
- Removed old prep-kit system in favor of prepContainer string field
- Asset availability query rewritten as single atomic Prisma filter using `none` relation

### Fixed
- Asset availability filtering: assets already assigned to other projects no longer appear in picker
- Bulk items with checks now prep all units in one check dialog
- Items of same model in different containers grouped separately
- Quick-add scan now routes through check queue when model has check items (was skipping checks entirely)
- WarehouseClose uses unique constraint to prevent duplicate close-outs (race condition fix)
- deleteCheckItem blocks deletion when check item is used by kits (not just models)
- Design system compliance: notices use left-edge accent bar, metrics use inline strip, teal palette for selection badges

## [0.2.3] - 2026-03-20

### Added
- Section-based PDF template builder with block editor UI (3-pane layout: block tree, PDF preview, settings panel)
- Drag-and-drop block tree with row/column layout system and cross-column content moves
- Section settings panel with per-section-type controls (table columns, styling, conditional visibility, custom fields)
- Column width picker with preset layouts and custom percentage inputs
- Brand template system for reusable header/footer/accent color configurations
- Section presets — save and load custom section groups across templates
- Section renderer with multi-page pagination engine supporting table splitting, group headers, and continuation pages
- Condition evaluator for dynamic section visibility based on document data
- Token resolver whitelist for safe template variable substitution
- `gearflow-rect` plugin for section background/border styling
- Document-level settings types and save pipeline for footer configuration (page numbers, text, format)
- 124 new tests covering block utilities, section renderer, token resolver, condition evaluator, and validation schemas

### Fixed
- PDF table pagination: fixed N×N page multiplication caused by separate pdfme inputs per page
- PDF table pagination: fixed item duplication when items span page breaks (startIndex/endIndex/isContinuation)
- PDF table pagination: aligned section-renderer filtering/grouping with plugin to fix 64-page PDF bug
- PDF table pagination: fixed phantom table padding and group header re-draw height estimation
- Crew table overflow clipping to page bounds
- Null guards in page header plugin and crew table to prevent 500 errors on preview
- TOCTOU race condition in template save optimistic locking (moved to transaction)
- Added size validation guard on template thumbnail uploads

### Changed
- Template preview now uses native browser PDF viewer instead of custom renderer
- Document template schema extended with section-based fields, brand template reference, and thumbnail storage

## [0.2.2] - 2026-03-19

### Added
- Full UX/UI structural redesign eliminating "AI slop" patterns across the entire app
- New design system (`DESIGN.md`) with deep teal primary palette, DM Sans typography, and motion guidelines
- Framer Motion utility components: `FadeIn`, `StaggerList`, `StaggerItem`, `AnimatedNumber`, `SurfaceLift`, `TabFade`
- Pure SVG data visualization: `Sparkline`, `UtilizationBar`, `DateRangeBar` (no charting library)
- 10 domain-specific spot illustrations for empty states (road case, stage plot, headset, etc.)
- Centralized `StatusIndicator` component with `status-colors.ts` replacing 20+ scattered inline color maps
- Keyboard shortcuts system (`Cmd+K` search, `Cmd+N` create, navigation shortcuts)
- Reusable `PageHeader`, `ListPageLayout`, `SectionHeader` layout components
- Shimmer skeleton loading states replacing static placeholders
- 61 new tests covering status colors, sparkline math, empty state resolution, dashboard utilities

### Changed
- **Dashboard**: Replaced 7 identical stat cards with inline metrics strip, dynamic time-of-day greeting, alert badges (overdue/maintenance), and DateRangeBar-enriched project list
- **All detail pages** (10 pages): Converted from full-width tab layout to asymmetric 2-column layout with sticky sidebar containing key info, eliminating need to tab through to find status/dates/financials
- **Sidebar navigation**: Reorganized into 5 logical sections (Core, Assets, Operations, People, Admin) with Quick Create dropdown
- **Warehouse**: Projects grouped by urgency (overdue → today → upcoming) with color-coded left borders
- **Login page**: Split-panel layout with brand panel and dot grid background
- **Tables**: Removed uniform surface wrappers, added contextual data (DateRangeBar in projects, utilization in assets, cert count in crew)
- **Forms**: Replaced Card wrappers with `SectionHeader` chip labels and increased spacing
- **Empty states**: Added spot illustrations and preset system for 20 domain contexts
- **Settings/Account**: Section-based layout with `SectionHeader` labels replacing monolithic cards
- **Availability calendar**: Borderless grid with contextual month header

### Removed
- Legacy Card component wrappers on forms, settings, and detail pages
- Old color tokens (`bg-muted`, `text-foreground`, `text-muted-foreground`) — replaced with semantic tokens
- Stat card grid pattern on dashboard
- Uniform surface-ring wrapping on all tables

## [0.2.1] - 2026-03-19

### Fixed
- Resolved all 145 ESLint errors to pass CI lint checks
- Excluded third-party gstack skill files from project ESLint scope
- Fixed misplaced `eslint-disable` comments that weren't suppressing errors
- Fixed `prefer-const` violations across PDF and server modules
- Fixed `react/no-children-prop` error by renaming `children` prop on KitChildRows
- Fixed `useMemo` dependency array using method calls instead of simple expressions
- Removed stale `eslint-disable` directive on interface with no violation

## [0.2.0] - 2026-03-19

### Added
- Test infrastructure: Vitest for unit tests, Playwright scaffold for E2E
- 1,084 unit tests covering all 20 Zod validation schemas + utility functions
- VERSION file for semantic versioning
- CHANGELOG.md following Keep a Changelog format
- TODOS.md for tracking deferred work
- CI pipeline now runs tests before deploy
- npm scripts: `test`, `test:watch`, `test:coverage`, `test:e2e`

## [0.1.0] - 2026-03-10

Initial release of GearFlow — asset and rental management platform for AV/theatre production companies.

### Added

#### Core Platform
- Next.js 16 App Router with Turbopack, TypeScript strict mode
- PostgreSQL database with Prisma v6 ORM (56 models)
- Better Auth with organization plugin, 2FA, passkeys, SSO (SAML/OIDC)
- Two-tier role system: site admin + org roles (owner, admin, manager, member, viewer)
- Custom per-org roles with granular permission matrix
- Tailwind CSS v4 + shadcn/ui v4 dark theme

#### Asset Management
- Serialized and bulk asset CRUD with auto-incrementing asset tags
- Asset models with categories, specifications, and custom fields
- Kit system — physical containers with fixed sets of assets
- QR code generation and barcode scanning
- Media uploads to S3 with org-prefixed paths
- CSV import/export for assets and models

#### Project & Rental Lifecycle
- Full project lifecycle: enquiry → quoting → confirmed → deployed → returned → invoiced
- Line items with per-day/week/hour/flat pricing and group support
- Subhire line items for third-party equipment
- Project templates and duplication
- Availability engine with overbooking detection
- Booking calendar views for models, assets, and kits

#### Warehouse Operations
- Barcode-driven checkout/checkin scanning
- Kit atomic checkout/checkin (scans kit, deploys all contents)
- Pull sheet generation for project preparation
- Warehouse display dashboard (live, token-based)
- Conflict detection for double-bookings

#### Documents & PDFs
- Quote, invoice, packing list, return sheet, delivery docket, call sheet PDFs
- Custom document template designer (pdfme)
- Kit group rendering in documents

#### Crew Management
- Crew members with roles, skills, and certifications
- Project assignments with phases and rate overrides
- Shift scheduling and timesheet tracking
- Crew availability calendar
- iCal feed export

#### Compliance & Maintenance
- AS/NZS 3760 Test & Tag module with full electrical test records
- Maintenance records (multi-asset, scheduled/ad-hoc)
- Compliance reporting (PDF/CSV)

#### Clients & Suppliers
- Client directory with company/individual types
- Supplier management with purchase orders
- Address autocomplete via Google Maps

#### Reporting & Search
- Report engine with ~30 pre-built reports and custom report builder
- Global search with fuzzy matching and keyboard navigation
- Activity log audit trail

#### Settings & Admin
- Organisation settings: branding, asset tag config, timezone
- Site admin panel for user/org management
- Team member invitations via Resend email
- WooCommerce integration (webhook-driven order import)

#### Mobile & PWA
- Progressive Web App with offline support
- Mobile-responsive layout with safe areas
- Continuous barcode scanning on mobile

### Infrastructure
- Self-hosted deployment via GitHub Actions + PM2
- Google Maps integration (address autocomplete, location mapping)
