# GearFlow — Architecture Overview

Multi-tenant asset and rental management platform for AV/theatre production companies. Built with Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui, Better Auth, PostgreSQL + Prisma.

## Quick Reference

| Stack | Details |
|-------|---------|
| Framework | Next.js 16, React 19, Turbopack |
| UI | shadcn/ui v4 (Base UI, `render` prop — NOT `asChild`), Tailwind CSS v4 |
| Database | PostgreSQL + Prisma v6 (client at `src/generated/prisma/`) |
| Auth | Better Auth (Organization, TwoFactor, Admin, Passkey plugins) |
| State | React Query (60s stale), React Hook Form + Zod |
| PDF | pdfme (@pdfme/generator + custom plugins, Helvetica only, no Unicode) |
| Storage | S3/MinIO, org-prefixed paths |

## Commands
```bash
npm run dev          # Dev server (Turbopack)
npm run build        # Production build + type check
npm run lint         # ESLint
npm test             # Run all unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npx prisma generate  # Regenerate Prisma client
npx prisma migrate dev --name <name>  # Create + apply migration
```

## Feature Documentation

Detailed docs for each system are in the [`FEATUREDOCS/`](./FEATUREDOCS/) folder:

| # | Document | Covers |
|---|----------|--------|
| 01 | [Tech Stack](./FEATUREDOCS/01-tech-stack.md) | Dependencies, env vars, config files |
| 02 | [Project Structure](./FEATUREDOCS/02-project-structure.md) | Directory layout, all files |
| 03 | [Database Schema](./FEATUREDOCS/03-database-schema.md) | All Prisma models and relations |
| 04 | [Auth & Permissions](./FEATUREDOCS/04-auth-permissions.md) | Better Auth, multi-tenancy, roles, permissions, user customisation |
| 05 | [Server Actions & API](./FEATUREDOCS/05-server-actions-api.md) | Server action pattern, all actions, API routes |
| 06 | [Pages & Layouts](./FEATUREDOCS/06-pages-layouts.md) | All page routes, layout architecture |
| 07 | [UI Components](./FEATUREDOCS/07-ui-components.md) | shadcn/ui conventions, custom components, gotchas |
| 08 | [Assets](./FEATUREDOCS/08-assets.md) | Serialized/bulk assets, auto-incrementing tags, categories |
| 09 | [Kits](./FEATUREDOCS/09-kits.md) | Kit system, pricing modes, nested kits, verification |
| 10 | [Projects](./FEATUREDOCS/10-projects.md) | Project management, line items, groups, templates, subhire, custom items |
| 11 | [Availability](./FEATUREDOCS/11-availability.md) | Overbooking engine, reduced stock |
| 12 | [Warehouse](./FEATUREDOCS/12-warehouse.md) | Deploy/return flows, kit verification, conflict detection |
| 13 | [PDFs](./FEATUREDOCS/13-pdfs.md) | Document generation, nested kit rendering, T&T reports |
| 14 | [Test & Tag](./FEATUREDOCS/14-test-and-tag.md) | AS/NZS 3760:2022 compliance module |
| 15 | [Maintenance](./FEATUREDOCS/15-maintenance.md) | Maintenance records, multi-asset |
| 16 | [Search](./FEATUREDOCS/16-search.md) | Global search, command palette, @ navigation |
| 17 | [Notifications](./FEATUREDOCS/17-notifications.md) | Alert types, dismiss behaviour |
| 18 | [Media & Storage](./FEATUREDOCS/18-media-storage.md) | File uploads, S3 proxy, photo cascade |
| 19 | [Mobile & PWA](./FEATUREDOCS/19-mobile-pwa.md) | PWA config, safe areas, barcode scanning |
| 20 | [CSV Import/Export](./FEATUREDOCS/20-csv-import-export.md) | Bulk data operations |
| 21 | [Org Transfer](./FEATUREDOCS/21-org-transfer.md) | Organization export/import (site admin) |
| 22 | [Suppliers](./FEATUREDOCS/22-suppliers.md) | Supplier CRUD, purchase orders |
| 24 | [Activity Log](./FEATUREDOCS/24-activity-log.md) | Audit trail, change tracking |
| 25 | [DataTable](./FEATUREDOCS/25-datatable.md) | Shared table component, filters, column visibility |
| 26 | [Tags](./FEATUREDOCS/26-tags.md) | Universal tags system |
| 27 | [Settings & Admin](./FEATUREDOCS/27-settings-admin.md) | Org settings, branding, site admin, dashboard |
| 28 | [Patterns](./FEATUREDOCS/28-patterns.md) | Key conventions, gotchas, code patterns |
| 29 | [Integration Checklist](./FEATUREDOCS/29-integration-checklist.md) | What to update when adding new features |
| 30 | [Maps Integration](./FEATUREDOCS/30-maps-integration.md) | Address autocomplete (Nominatim), Leaflet maps, coordinate fields |
| 31 | [Crew Management](./FEATUREDOCS/31-crew-management.md) | Crew members, roles, skills, certifications |
| 32 | [Preps](./FEATUREDOCS/32-preps.md) | Prep-kits (temporary kits), case assets, project staging |
| 33 | [Enterprise SSO](./FEATUREDOCS/33-enterprise-sso.md) | SAML 2.0/OIDC SSO, provisioning modes, group mapping, enforcement |
| 34 | [Reporting System](./FEATUREDOCS/34-reporting-system.md) | Report engine, ~30 pre-built reports, custom report builder, CSV export |
| 35 | [WooCommerce Integration](./FEATUREDOCS/35-woocommerce-integration.md) | Webhook-driven order import, client/product matching, location auto-creation |
| 36 | [Testing](./FEATUREDOCS/36-testing.md) | Vitest unit tests, Playwright E2E scaffold, coverage config |
| 37 | [Check Items](./FEATUREDOCS/37-check-items.md) | Quality checks, check item library, warehouse integration, close-out |
| 38 | [Pricing Optimization](./FEATUREDOCS/38-pricing-optimization.md) | Auto min-cost pricing from daily/weekly/monthly rates + billing periods |
| 39 | [Sub-Hires](./FEATUREDOCS/39-sub-hires.md) | First-class sub-hire orders with dual pricing, margin analysis, and supplier rate memory |
| 40 | [Damage Capture](./FEATUREDOCS/40-damage-capture.md) | Camera-first damage reporting at checkin, severity, charge-back, auto workshop ticket |
| 41 | [Workshop Kanban](./FEATUREDOCS/41-workshop-kanban.md) | Repair queue board, extended maintenance state machine (Awaiting Parts, QA) |
| 42 | [Asset Utilization](./FEATUREDOCS/42-asset-utilization.md) | Booking rate, revenue, cost, net contribution per asset; idle/lossy filters |
| 43 | [Stocktake](./FEATUREDOCS/43-stocktake.md) | Scan-driven inventory counts, discrepancy resolution, state machine |
| 44 | [Reorder Dashboard](./FEATUREDOCS/44-reorder.md) | Low-stock items grouped by preferred supplier, one-click draft supplier orders |
| 45 | [Error UX](./FEATUREDOCS/45-error-ux.md) | UserFacingError, Prisma-error translator, showError client helper |
| 46 | [Custom Fields](./FEATUREDOCS/46-custom-fields.md) | Operator-defined entity attributes, definition CRUD, form rendering |
| 47 | [Cross-Type Equipment Unification](./FEATUREDOCS/47-cross-type-equipment-unification.md) | CategorySlot, mixedGroups query, UnifiedAddDialog, SubHireGroupRow, PriceEditDialog, Drop Matrix 8C |

**When making changes**: Read the relevant feature doc(s) first, follow documented patterns, and update the relevant doc(s) after. If no doc exists for the feature you're working on, create a new numbered file in `FEATUREDOCS/` and add it to the table above.

All new features and non-trivial changes must go on a dedicated branch — never commit feature work directly to `main`.
