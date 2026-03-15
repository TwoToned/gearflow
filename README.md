# GearFlow
[![Deploy GearFlow](https://github.com/TwoToned/gearflow/actions/workflows/main.yml/badge.svg)](https://github.com/TwoToned/gearflow/actions/workflows/main.yml)

Professional asset and rental management for AV, theatre, and production companies.

## Overview

GearFlow is a multi-tenant SaaS platform that manages the full lifecycle of production equipment — from procurement and inventory tracking through project quoting, warehouse operations, and compliance testing. Built as a modern web application with full mobile/PWA support for warehouse floor operations.

## Features

### Asset Management
- **Serialized assets** — Individual tracking with unique asset tags, QR codes, serial numbers, and full lifecycle status (Available, Checked Out, In Maintenance, Lost, Retired)
- **Bulk assets** — Quantity-tracked consumables and non-serialized items with stock levels and reorder thresholds
- **Equipment models** — Shared templates defining manufacturer, specs, pricing defaults, maintenance intervals, and test & tag requirements
- **Kit system** — Physical containers (road cases, racks) holding fixed sets of serialized and bulk assets. Kits have their own asset tags and check out/in as a unit
- **Categories** — Hierarchical organization with custom icons
- **Auto-incrementing tags** — Configurable prefix, digit count, and counter per organization
- **CSV import/export** — Bulk data operations with flexible column matching
- **Media attachments** — Photos, manuals, and documents with drag-to-reorder and primary selection

### Project & Rental Management
- **Full project lifecycle** — Enquiry → Quoting → Confirmed → Prepping → Checked Out → On Site → Returned → Completed → Invoiced
- **Line items** — Equipment, services, labour, transport, and miscellaneous with per-day/week/flat/hourly pricing
- **Visual grouping** — Drag-and-drop line item groups
- **Subhire tracking** — Third-party equipment with supplier details, optionally shown on client documents
- **Financial calculations** — Auto-calculated subtotals, configurable discount/deposit percentages, 10% GST, invoiced total override
- **Availability checking** — Real-time stock checks with date-range overlap detection across all active projects
- **Overbooking warnings** — Allowed with explicit confirmation, shown as badges on project lists and all PDF documents
- **Reduced stock detection** — Assets in maintenance or lost reduce effective availability with purple badges
- **Project templates** — Save and reuse equipment lists. Fully isolated from live project queries and availability

### Warehouse Operations
- **Barcode/QR scanning** — Camera-based scanning with audio chime feedback for mobile warehouse use
- **Check out flow** — Scan or select assets to assign to project line items. Kit scanning checks out entire kit contents atomically
- **Check in flow** — Return with condition tracking (Good, Damaged, Missing) that auto-updates asset status
- **Pull sheets** — Online pick list and printable packing list with per-unit checkboxes
- **Conflict detection** — Blocks checkout if asset is already out on another project, showing which one

### Documents (PDF Generation)
- **Quote** — Client-facing price quotation
- **Invoice** — Tax invoice with deposit tracking
- **Packing list** — Warehouse pull slip with checkboxes
- **Return sheet** — Check-in condition recording form
- **Delivery docket** — Goods dispatch documentation
- All documents show kit contents as indented children, line item notes, overbooking/reduced stock badges

### Test & Tag (AS/NZS 3760:2022)
- **Equipment register** — Track items with equipment class, appliance type, test intervals
- **Test records** — Visual inspection + electrical tests (earth continuity, insulation, leakage, polarity, RCD trip time)
- **Status lifecycle** — Not Yet Tested → Current → Due Soon → Overdue / Failed / Retired
- **Quick test** — Streamlined single-item test entry
- **10 report types** — Full register, overdue/non-compliant, test session, item history, due schedule, class summary, tester activity, failed items, bulk asset summary, compliance certificate (PDF + CSV)
- **Bulk asset linking** — Auto-populate T&T items from existing bulk asset records

### Maintenance
- **Multi-asset records** — One maintenance task can cover multiple assets
- **Types** — Repair, preventative, test & tag, inspection, cleaning, firmware update
- **Status tracking** — Scheduled → In Progress → Completed / Cancelled with result (Pass/Fail/Conditional)
- **Notifications** — Overdue maintenance alerts in the notification bell

### Clients & Locations
- **Client management** — Companies, individuals, venues, production companies with contact details, billing info, payment terms
- **Hierarchical locations** — Warehouses, venues, vehicles, offsite locations with parent/child structure
- **Supplier directory** — Vendor contacts for purchase tracking and subhire

### Search & Navigation
- **Global search** — Full-text search across all entity types with child result expansion
- **@ page navigation** — Type `@` to navigate directly to any page with Tab drill-down
- **Date shortcuts** — Type a date to jump to availability calendar
- **Keyboard driven** — Full keyboard navigation with Shift+arrows, Tab, Escape

### User Management & Security
- **Multi-tenant** — Organizations with isolated data, configurable branding, and independent settings
- **Role-based access** — Owner, Admin, Manager, Member, Viewer with granular per-resource permissions (14 resources x CRUD actions)
- **Custom roles** — Per-organization role definitions with fine-grained permission matrices
- **Two-factor authentication** — TOTP-based 2FA with backup codes and global enforcement policies
- **Team invitations** — Email-based invites with configurable registration policies (Open, Invite Only, Disabled)
- **Site admin panel** — Platform-wide management of organizations, users, settings
- **Organization export/import** — Full backup and restore of org data including media files

### Mobile & PWA
- **Progressive Web App** — Installable on iOS/Android home screens with offline support
- **iOS safe area handling** — Proper insets for notch, Dynamic Island, and home indicator
- **Bottom navigation** — Quick access to Home, Assets, Scan, Projects, Warehouse
- **Camera scanning** — Barcode/QR reader with audio chime for warehouse operations
- **Responsive tables** — Progressive column hiding on smaller screens
- **Touch-optimized** — 44px minimum touch targets on interactive elements

### Reporting & Analytics
- **Dashboard** — Active projects, asset counts, recent activity feed, upcoming projects
- **Project status reports** — Revenue, utilization, status distribution
- **Notification center** — Overdue returns, upcoming projects, maintenance due, low stock alerts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS v4, shadcn/ui (Base UI primitives) |
| Database | PostgreSQL + Prisma v6 |
| Auth | Better Auth (Organization, 2FA, Admin plugins) |
| State | React Query, React Hook Form + Zod |
| PDF | @react-pdf/renderer |
| Storage | AWS S3 / MinIO |
| Email | Resend |
| Icons | Lucide React |
| PWA | @ducanh2912/next-pwa |

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- S3-compatible storage (AWS S3 or MinIO)

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL, S3 credentials, auth secret, etc.

# Run database migrations
npx prisma migrate deploy
npx prisma generate

# Start development server
npm run dev
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Session encryption key |
| `S3_ACCESS_KEY_ID` | S3/MinIO access key |
| `S3_SECRET_ACCESS_KEY` | S3/MinIO secret key |
| `S3_REGION` | S3 region (default: `ap-southeast-2`) |
| `S3_ENDPOINT` | MinIO endpoint (omit for AWS S3) |
| `S3_BUCKET` | Bucket name (default: `gearflow-uploads`) |
| `RESEND_API_KEY` | Email provider API key |
| `SITE_ADMIN_REGISTRATION_ENABLED` | Enable secret admin registration (`true`/`false`) |
| `SITE_ADMIN_SECRET_TOKEN` | Token for `/register/admin?token=...` |

## Development

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build + type check
npm run lint         # ESLint
```

## License

Proprietary. All rights reserved.
