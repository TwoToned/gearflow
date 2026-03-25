# Changelog

All notable changes to GearFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
