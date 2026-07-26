# Claude Code Initial Prompt — RVLT Flow: Asset & Rental Management Platform

> **⚠️ Historical document.** This is the original bootstrap prompt used to
> start the project — it does not track ongoing changes. The stack, data
> model, and feature set have moved on substantially since (Convex replaced
> Postgres/Prisma as the domain datastore, React Query was removed, several
> features described below as planned/current were later removed in the June
> 2026 feature-removal sweep). For current architecture, read
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) and the relevant
> [`FEATUREDOCS/`](./FEATUREDOCS/) file — treat this file as "what we set out
> to build," not "what exists today." The Tech Stack section immediately below
> has been corrected; the rest of the document is left as originally written.

## Project Overview

Build a full-stack **asset and rental management platform** for companies in the **AV (Audio Visual) and Theatre production industry**. This is a SaaS-style application that will serve as the central source of truth for business operations — housing all assets, equipment information, and project management in one place.

**Think of this as a purpose-built alternative to CurrentRMS, Rentman, Flex Rental Solutions, and Snipe-IT** — but tailored specifically for small-to-mid AV and theatre rental companies that need professional-grade inventory management, project lifecycle tracking, and warehouse operations without the price tag or bloat of enterprise solutions.

---

## Tech Stack

*(corrected to reflect current reality — see the banner above)*

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4
- **Authentication:** Better Auth (with the Organization plugin for multi-tenancy)
- **Database:** Convex — sole copy of all domain data. PostgreSQL/Prisma is
  scoped to Better Auth + the activity log only.
- **UI Components:** shadcn/ui — Radix for overlay primitives, Base UI for sidebar/breadcrumb
- **State Management:** Convex `useQuery`/`useMutation` (reactive, no polling)
- **Forms:** React Hook Form + Zod validation
- **File Storage:** S3-compatible (AWS S3 or MinIO) — no local-filesystem path
- **PDF Generation:** pdfme (`@pdfme/generator` + custom plugins)
- **Barcode/QR:** Generation and scanning support (use libraries like `react-qr-code` and `html5-qrcode`)

---

## Multi-Tenancy & Authentication (Better Auth)

Use Better Auth's **Organization plugin** to support multi-business tenancy. Each "organization" represents a separate business that uses the platform.

### Auth Requirements:
- Email/password authentication
- Social providers (Google, optionally GitHub)
- Organization (business/tenant) creation and management
- Role-based access within each organization: **Owner**, **Admin**, **Manager**, **Staff**, **Warehouse** (custom roles)
- Invite system — owners/admins can invite team members via email
- Organization switching for users who belong to multiple organizations
- All data is scoped to the active organization — users must never see another organization's data
- Session management and 2FA support (via Better Auth plugins)

### Data Isolation:
- Every database model must include an `organizationId` foreign key
- All queries must be scoped by the current user's active organization
- Create a middleware/utility that automatically injects organization context into all database operations
- API routes must validate organization membership before returning data

---

## Core Data Model

### Organization (via Better Auth)
The organization model is managed by Better Auth's Organization plugin. Extend it with:
- `name` (business name)
- `slug` (URL-friendly identifier)
- `logo` (image URL)
- `address`, `phone`, `email`, `website`
- `currency` (default AUD)
- `taxRate` (default GST rate)
- `settings` (JSON — for org-specific configuration)

### Category
Categories organize equipment types hierarchically.
- `id`, `organizationId`
- `name` (e.g., "Audio", "Lighting", "Video", "Staging", "Rigging", "Power Distribution", "Cabling", "Comms", "Scenic/Set", "Backline")
- `parentId` (self-referencing for subcategories, e.g., Audio → Microphones → Dynamic Microphones)
- `description`
- `icon` (optional emoji or icon identifier)
- `sortOrder`

### Model (Equipment Template)
Models are templates/blueprints for equipment. Inspired by Snipe-IT's "Asset Models" concept — you define a model once (e.g., "Shure SM58") and then create individual assets from it.

- `id`, `organizationId`
- `name` (e.g., "Shure SM58")
- `manufacturer` (e.g., "Shure")
- `modelNumber` (e.g., "SM58-LC")
- `categoryId` → Category
- `description`
- `image` (primary product image URL)
- `images` (array of additional image URLs)
- `manuals` (array of file URLs — PDFs, links to manufacturer docs)
- `specifications` (JSON — key-value pairs like weight, dimensions, power draw, etc.)
- `customFields` (JSON — organization-defined fields that are inherited by assets)
- `defaultRentalPrice` (per day/per week pricing — configurable)
- `defaultPurchasePrice` (guide price for quoting)
- `replacementCost` (insurance/replacement value)
- `weight` (in kg — useful for transport calculations)
- `powerDraw` (in watts — useful for power distribution planning)
- `testAndTagIntervalDays` (how often test and tag is required, e.g., 90 days)
- `maintenanceIntervalDays` (preventative maintenance schedule)
- `assetType`: enum — `SERIALIZED` | `BULK` (critical distinction, see below)
- `barcodeLabelTemplate` (optional — custom label format)
- `isActive` (soft archive)
- `createdAt`, `updatedAt`

### Asset
Assets are individual instances of a Model. There are **two types**:

#### Serialized Assets
Each unit is individually tracked with a unique serial/asset tag. Used for high-value or uniquely identifiable equipment (e.g., a specific Allen & Heath dLive S7000 console, a specific projector with a serial number).

- `id`, `organizationId`
- `modelId` → Model (inherits all model info)
- `assetTag` (custom user-defined tag, e.g., "AV-AUD-001" — unique within org)
- `serialNumber` (manufacturer serial number)
- `customName` (optional friendly name, e.g., "FOH Console 1")
- `status`: enum — `AVAILABLE`, `CHECKED_OUT`, `IN_MAINTENANCE`, `RETIRED`, `LOST`, `RESERVED`
- `condition`: enum — `NEW`, `GOOD`, `FAIR`, `POOR`, `DAMAGED`
- `purchaseDate`
- `purchasePrice`
- `purchaseSupplier`
- `warrantyExpiry`
- `notes` (free text)
- `locationId` → Location (current storage location/warehouse)
- `customFieldValues` (JSON — values for model-defined custom fields)
- `lastTestAndTagDate`
- `nextTestAndTagDate` (auto-calculated from model interval)
- `barcode` (generated or manual)
- `qrCode` (generated)
- `images` (asset-specific photos, e.g., showing damage)
- `isActive`
- `createdAt`, `updatedAt`

#### Bulk Assets
For items tracked by quantity rather than individual serial numbers. Used for cables, consumables, generic items (e.g., SM57 microphones, XLR cables, gaffer tape). All units share the same asset tag.

- `id`, `organizationId`
- `modelId` → Model
- `assetTag` (shared tag for all units of this type, e.g., "AV-SM57")
- `totalQuantity` (total owned)
- `availableQuantity` (calculated: total - checked out - in maintenance)
- `purchasePricePerUnit`
- `locationId` → Location
- `status`: enum — `ACTIVE`, `LOW_STOCK`, `OUT_OF_STOCK`, `RETIRED`
- `reorderThreshold` (trigger low stock notification)
- `notes`
- `isActive`
- `createdAt`, `updatedAt`

### Location (Warehouse/Storage)
- `id`, `organizationId`
- `name` (e.g., "Main Warehouse", "Offsite Storage", "Venue A")
- `address`
- `type`: enum — `WAREHOUSE`, `VENUE`, `VEHICLE`, `OFFSITE`
- `isDefault` (primary warehouse)
- `notes`

### Maintenance Record
Track all maintenance, repairs, and test & tag records for serialized assets.

- `id`, `organizationId`
- `assetId` → Asset (serialized)
- `type`: enum — `REPAIR`, `PREVENTATIVE`, `TEST_AND_TAG`, `INSPECTION`, `CLEANING`, `FIRMWARE_UPDATE`
- `status`: enum — `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`
- `title` (brief description)
- `description` (detailed notes about work done)
- `reportedBy` → User
- `assignedTo` → User (who is doing the maintenance)
- `scheduledDate`
- `completedDate`
- `cost` (parts + labor)
- `partsUsed` (text description)
- `attachments` (photos, receipts)
- `result`: enum — `PASS`, `FAIL`, `CONDITIONAL` (for test and tag)
- `nextDueDate` (for recurring maintenance)
- `createdAt`, `updatedAt`

### Client
- `id`, `organizationId`
- `name` (company or individual name)
- `type`: enum — `COMPANY`, `INDIVIDUAL`, `VENUE`, `PRODUCTION_COMPANY`
- `contactName`, `contactEmail`, `contactPhone`
- `billingAddress`, `shippingAddress`
- `taxId` (ABN for Australian businesses)
- `paymentTerms` (e.g., "Net 30")
- `defaultDiscount` (percentage)
- `notes`
- `tags` (array of strings for filtering)
- `isActive`
- `createdAt`, `updatedAt`

### Project
Projects are the core operational unit — representing a gig, show, event, installation, or any job that requires equipment.

- `id`, `organizationId`
- `projectNumber` (auto-generated sequential, e.g., "GF-2025-0042")
- `name` (e.g., "Corporate Gala — Hilton Sydney")
- `clientId` → Client
- `status`: enum — `ENQUIRY`, `QUOTING`, `QUOTED`, `CONFIRMED`, `PREPPING`, `CHECKED_OUT`, `ON_SITE`, `RETURNED`, `COMPLETED`, `INVOICED`, `CANCELLED`
- `type`: enum — `DRY_HIRE`, `WET_HIRE`, `INSTALLATION`, `TOUR`, `CORPORATE`, `THEATRE`, `FESTIVAL`, `CONFERENCE`, `OTHER`
- `description`
- `venue` (name/address of event location)
- `venueContactName`, `venueContactPhone`, `venueContactEmail`
- **Two windows only (WS2 #941 — locked decision):**
  - `rentalStartDate`, `rentalEndDate` — the **chargeable** window (billing
    period start/end). Pricing reads this directly.
  - `projectStartDate`, `projectStartTime`, `projectEndDate`, `projectEndTime`
    — the **gear-committed** window (when equipment actually leaves/returns
    the warehouse — the old load-in/load-out role). Blank by default; falls
    back to the rental window when unset (`getProjectWindow`, read-time
    coalesce, not stored duplication). **Availability and conflict detection
    read this window**, never the rental window directly.
  - `loadInDate`/`loadInTime`/`loadOutDate`/`loadOutTime`/`eventStartDate`/
    `eventStartTime`/`eventEndDate`/`eventEndTime` are **deprecated** — kept
    on the schema, unwritten by any current consumer, for one rollout cycle.
    `loadInDate`/`loadOutDate` are backfilled into `projectStartDate`/
    `projectEndDate`; the event pair has no replacement and is dropped, not
    migrated. See [FEATUREDOCS/11](./FEATUREDOCS/11-availability.md) for the
    full design and the six parity-pinned overlap-math sites this touches.
- `projectManagerId` → User
- `crewNotes` (notes visible to crew/technicians)
- `internalNotes` (notes visible only to office/management)
- `clientNotes` (notes that appear on client-facing documents)
- `subtotal` (calculated from line items)
- `discountPercent`
- `discountAmount`
- `taxAmount`
- `total`
- `depositRequired`
- `depositPaid`
- `tags` (array — for filtering, e.g., ["theatre", "lighting", "priority"])
- `createdAt`, `updatedAt`

### ProjectLineItem
Individual items assigned to a project. This is where equipment is "booked" to a project and becomes unavailable for conflicting projects.

- `id`, `organizationId`, `projectId` → Project
- `type`: enum — `EQUIPMENT`, `SERVICE`, `LABOUR`, `TRANSPORT`, `MISC`
- `modelId` → Model (for equipment items)
- `assetId` → Asset (optional — for serialized, specific unit assignment)
- `bulkAssetId` → BulkAsset (optional — for bulk items)
- `description` (auto-filled from model, or manual for services/labour)
- `quantity`
- `unitPrice` (per day or flat — configurable)
- `pricingType`: enum — `PER_DAY`, `PER_WEEK`, `FLAT`, `PER_HOUR`
- `duration` (number of billing periods)
- `discount` (percentage or flat on this line)
- `lineTotal` (calculated)
- `sortOrder` (drag-and-drop ordering)
- `group` (optional grouping label, e.g., "FOH Audio", "Stage Lighting", "Backline")
- `notes`
- `isOptional` (for quoting — client can choose to include or not)
- `status`: enum — `QUOTED`, `CONFIRMED`, `PREPPED`, `CHECKED_OUT`, `RETURNED`, `CANCELLED`
- `checkedOutAt` (timestamp when scanned out of warehouse)
- `checkedOutBy` → User
- `returnedAt` (timestamp when scanned back in)
- `returnedBy` → User
- `returnCondition`: enum — `GOOD`, `DAMAGED`, `MISSING`
- `returnNotes`

### Project Conflict Resolution
**Critical feature**: When a serialized asset or bulk quantity is assigned to a project for specific dates, the system must:
1. Check availability across all other projects for overlapping dates
2. Block assignment if the asset is already booked (serialized) or insufficient quantity remains (bulk)
3. Show availability calendar/timeline for each asset or model
4. Allow "tentative" holds during quoting phase (lower priority than confirmed bookings)
5. Show warnings for assets that have upcoming maintenance or expired test & tag

### AssetScanLog
Track all warehouse check-in/check-out scanning activity.

- `id`, `organizationId`
- `assetId` → Asset | `bulkAssetId` → BulkAsset
- `projectId` → Project
- `action`: enum — `CHECK_OUT`, `CHECK_IN`, `SCAN_VERIFY`, `TRANSFER`
- `scannedBy` → User
- `scannedAt` (timestamp)
- `notes`
- `location` (where the scan happened)

---

## Key Features to Build

### 1. Dashboard
- Overview stats: total assets, assets checked out, projects this week/month, overdue returns
- Upcoming projects timeline
- Maintenance alerts (overdue test & tag, scheduled maintenance)
- Low stock alerts for bulk items
- Recent activity feed
- Quick actions: new project, scan asset, search

### 2. Asset Management
- **Model Library**: Browse/search/filter all equipment models with images, specs, and manuals. Create new models with all fields. Import from CSV.
- **Asset Registry**: List all serialized assets and bulk stock. Filter by category, status, location, condition. Search by asset tag, serial number, or name.
- **Asset Detail Page**: Full history — which projects it's been on, maintenance history, scan log, photos, notes. For bulk assets: quantity tracking, usage history.
- **Create Asset from Model**: Select a model → auto-populate fields → add asset tag, serial number, purchase info, location.
- **Barcode/QR Generation**: Auto-generate QR codes for each serialized asset. Print barcode labels.
- **Barcode Scanning**: Scan an asset barcode to instantly pull up its details, or scan into a project for check-out/check-in.
- **Availability Calendar**: Visual timeline showing when each asset (or model stock) is booked across projects. Similar to Rentman's timeline view.

### 3. Maintenance & Test and Tag
- **Maintenance Dashboard**: List all upcoming, overdue, and in-progress maintenance tasks.
- **Test and Tag Tracking**: Each asset knows its test interval. Auto-calculate next due date. Flag overdue items. Prevent checkout of overdue assets (configurable — warning or hard block).
- **Create Maintenance Record**: Log repairs, preventative work, test results. Attach photos and receipts.
- **Notifications**: Email/in-app alerts when test and tag is due within X days. Alert when maintenance is overdue.

### 4. Project Management
- **Project List**: Filter by status, date range, client, type. Kanban board view by status. Calendar view.
- **Project Detail Page**: All project info, line items, assigned equipment, documents, notes, timeline.
- **Quoting Workflow**:
  1. Create project in ENQUIRY status
  2. Add line items (equipment from model library, services, labour, transport)
  3. Set pricing (guide prices from model, override per-line)
  4. Group line items (e.g., "FOH Audio Package", "Stage Lighting")
  5. Mark items as optional
  6. Generate PDF quote to send to client
  7. Client approves → status moves to CONFIRMED
  8. Equipment is now firmly reserved for those dates
- **Equipment Assignment**:
  - Add a Model to a project → system reserves quantity from available stock
  - For serialized: optionally assign specific units, or leave generic until prep phase
  - For bulk: specify quantity needed (e.g., "4x SM57")
  - System shows conflicts if equipment is unavailable for the project dates
  - Prep phase: assign specific serialized units, or scan bulk items to the project
- **Warehouse Workflow** (inspired by CurrentRMS and Rentman):
  1. **Prep/Pull**: Generate a pull sheet listing all equipment needed for a project. Warehouse staff picks items.
  2. **Scan Out**: Scan each asset's barcode to confirm it's been loaded. For bulk items, scan then confirm quantity. System marks items as CHECKED_OUT.
  3. **On Site**: Project is active. Any issues logged here.
  4. **Return/Scan In**: Equipment returns to warehouse. Scan each item back in. Log condition. Flag damaged items.
  5. **Reconciliation**: System compares what was sent vs. what came back. Flag missing items.

### 5. Document Generation (PDF)
Generate professional PDF documents from project data:

- **Quote/Proposal**: Branded document with company logo, client details, itemized equipment list with pricing, terms and conditions, signature line. Optional items clearly marked.
- **Picking/Pull Sheet**: Warehouse-focused — list of all items to pull, organized by category or location in warehouse. Checkboxes. Quantities. Asset tags where assigned.
- **Packing List**: What's going on the truck — organized by case/container. Weight totals. Item counts.
- **Delivery Docket**: Client-facing document confirming what was delivered. Signature capture.
- **Return Sheet**: Checklist for return processing. Condition notes column.
- **Invoice**: Based on confirmed project line items. Tax calculations. Payment terms.

### 6. Client Management (Basic CRM)
- Client list with search/filter
- Client detail page: contact info, project history, notes
- Quick client creation from project workflow

### 7. Settings & Configuration
- Organization profile (name, logo, address, tax settings)
- Custom fields management (define additional fields for models/assets)
- User management (invite, roles, permissions)
- Notification preferences
- Default pricing rules (day rates, week rates, discount tiers)
- Document templates (logo placement, terms and conditions text)
- Category management
- Location/warehouse management

---

## UI/UX Design Direction

This is a **professional business tool** — design it to be clean, efficient, and information-dense without being overwhelming. Take cues from modern SaaS tools like Linear, Notion, and the better parts of CurrentRMS.

### Design Principles:
- **Information density**: Users need to see a lot of data at once — tables, lists, dashboards. Don't over-space things.
- **Speed**: Fast navigation, keyboard shortcuts, quick search (Cmd+K global search).
- **Dark mode support**: Many AV techs work in dark environments. Default to a dark theme option.
- **Mobile-responsive**: The warehouse scanning workflow must work well on phones/tablets.
- **Consistent patterns**: Every list page has the same filter/sort/search pattern. Every detail page follows the same layout conventions.

### Layout:
- Sidebar navigation (collapsible) with: Dashboard, Assets (Models, Registry, Availability), Projects, Clients, Maintenance, Reports, Settings
- Top bar with: Global search, notifications bell, user menu, organization switcher
- Breadcrumb navigation throughout
- Modal/slide-over panels for quick create/edit actions

### Color Palette Suggestion:
- Primary: Deep teal or electric blue (professional but distinctive — avoid generic purple SaaS look)
- Neutral: Slate grays
- Accent: Amber/orange for warnings, green for available/good, red for alerts/critical
- The brand is "RVLT Flow" — consider a two-tone design motif in the UI

---

## Implementation Plan (Suggested Order)

### Phase 1: Foundation
1. Next.js project setup with TypeScript, Tailwind, shadcn/ui
2. Better Auth integration with Organization plugin
3. PostgreSQL + Prisma schema (all models above)
4. Layout shell (sidebar, top bar, organization switcher)
5. Authentication flows (login, register, create organization, invite members)
6. Role-based middleware and data scoping

### Phase 2: Asset Management Core
1. Category CRUD
2. Model CRUD (with image upload, specs, custom fields)
3. Serialized Asset CRUD (create from model, asset tags, status)
4. Bulk Asset CRUD (quantity tracking)
5. Asset list views with filtering, sorting, search
6. Asset detail pages with tabbed layout (Details, History, Maintenance, Photos)
7. QR/barcode generation

### Phase 3: Project Management Core
1. Client CRUD
2. Project CRUD with full status workflow
3. Project line items (add equipment, services, labour)
4. Availability checking and conflict detection
5. Project detail page with equipment assignment
6. Project list with Kanban and calendar views

### Phase 4: Warehouse Operations
1. Pull sheet generation
2. Barcode scanning interface (mobile-optimized)
3. Check-out workflow (scan assets to project)
4. Check-in workflow (return and condition logging)
5. Scan log and reconciliation

### Phase 5: Documents & Polish
1. PDF quote generation
2. Packing list, delivery docket, return sheet, invoice PDFs
3. Maintenance and test & tag tracking with notifications
4. Dashboard with real-time stats
5. Global search (Cmd+K)
6. Settings and configuration pages

---

## Important Technical Considerations

### Availability Engine
The availability calculation is the **most critical piece of business logic**. It must:
- For serialized assets: check if the specific unit is booked on any overlapping project dates
- For bulk assets: sum up all quantities booked across overlapping projects and compare to total stock
- Handle different project statuses differently (CONFIRMED bookings take priority over QUOTING holds)
- Be performant — this query runs every time someone adds equipment to a project
- Consider "buffer days" — time for transit and prep between projects
- Account for maintenance windows (asset unavailable during scheduled maintenance)

### Scanning Workflow
- Support both QR code scanning (camera-based, for mobile) and barcode scanner input (USB/Bluetooth, for warehouse)
- Scanning an asset tag should be context-aware: if on a project check-out page, it adds to that project; if on the asset page, it shows asset details
- Audible feedback on scan (success/error sounds)
- Batch scanning mode for efficiency

### Data Integrity
- Soft deletes on all major entities (never hard delete assets or projects)
- Full audit trail — log who changed what and when on critical records
- Optimistic locking on availability checks to prevent double-booking race conditions

### Performance
- Paginate all list views (cursor-based pagination for large datasets)
- Index all frequently queried columns (status, dates, organizationId, asset tags)
- Use React Query for client-side caching and optimistic updates
- Consider database views for complex availability calculations

---

## AV & Theatre Industry Context

This platform serves professionals who:
- Manage warehouses full of audio consoles, speakers, microphones, lighting fixtures, LED screens, projectors, cabling, rigging, staging, and more
- Prep equipment for shows/events, load trucks, set up on site, then return and check everything back in
- Need to know instantly: "Do we have 4x SM58s available for Saturday?" or "Where is our dLive console right now?"
- Work on tight timelines — a festival one weekend, a corporate gig the next, and a theatre run starting Monday
- Must comply with electrical safety regulations (test and tag requirements in Australia)
- Often work late nights and weekends in dark venues (dark mode is essential)
- Need to generate quotes quickly to win business, then convert those quotes to confirmed bookings seamlessly

Common equipment categories in this industry: FOH (Front of House) Audio, Monitor Audio, RF/Wireless, Playback, Lighting (Conventional, LED, Moving Lights), Video (Projection, LED Screens, Cameras), Staging/Decks, Rigging (Chain Hoists, Truss), Power Distribution, Cabling (Audio, Data, Power), Comms (Intercom/Clearcom), Scenic/Set Pieces, Backline (Musical Instruments & Amps), Cases/Road Cases, Tools & Consumables.

---

## Summary

Build this as a modern, fast, professional-grade tool that a small AV company would genuinely prefer over a spreadsheet or over paying $500+/month for CurrentRMS or Flex. Focus on getting the data model right, the availability engine solid, and the warehouse scanning workflow smooth. Everything else builds on those foundations.

Start with Phase 1 and work through sequentially. Each phase should produce a working, usable increment. Ask clarifying questions if any business logic is ambiguous.

The name of the platform is **"RVLT Flow"**.
