# Changelog

All notable changes to GearFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
