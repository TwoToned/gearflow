# RVLT Flow — Architecture Overview

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-18 (review quarterly — POLICY.md R-5.5)_

Multi-tenant asset and rental management platform for AV/theatre production companies. Built with Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui, Better Auth, PostgreSQL + Prisma.

## Quick Reference

| Stack | Details |
|-------|---------|
| Framework | Next.js 16, React 19, Turbopack |
| UI | shadcn/ui v4 — overlay primitives are Radix (`asChild`), Sidebar/Breadcrumb are Base UI (`render`), Tailwind CSS v4 |
| Database | Convex (sole copy of domain data) + PostgreSQL/Prisma v7 for Better Auth + activity log only |
| Auth | Better Auth (Organization, TwoFactor, Admin, Passkey plugins) |
| State | Convex `useQuery`/`useMutation` (reactive, no polling), React Hook Form + Zod |
| PDF | pdfme (@pdfme/generator + custom plugins, Helvetica only, no Unicode) |
| Storage | Convex file storage (`_storage`), per-org access records |

## Commands

This repo is pnpm-only — use `pnpm` / `pnpm exec`, never `npm`/`npx`.

```bash
pnpm dev             # Dev server (Turbopack)
pnpm build           # Production build + type check
pnpm lint            # ESLint
pnpm test            # Run all unit tests
pnpm test:watch      # Run tests in watch mode
pnpm test:coverage   # Run tests with coverage report
pnpm exec prisma generate  # Regenerate Prisma client
pnpm exec prisma migrate dev --name <name>  # Create + apply migration
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
| 35 | [WooCommerce Integration](./FEATUREDOCS/35-woocommerce-integration.md) | Webhook-driven order import, client/product matching, location auto-creation |
| 36 | [Testing](./FEATUREDOCS/36-testing.md) | Vitest unit tests, Playwright E2E scaffold, coverage config |
| 37 | [Check Items](./FEATUREDOCS/37-check-items.md) | Quality checks, check item library, warehouse integration, close-out |
| 39 | [Sub-Hires](./FEATUREDOCS/39-sub-hires.md) | First-class sub-hire orders with dual pricing, margin analysis, and supplier rate memory |
| 45 | [Error UX](./FEATUREDOCS/45-error-ux.md) | UserFacingError, Prisma-error translator, showError client helper |
| 46 | [Custom Fields](./FEATUREDOCS/46-custom-fields.md) | Operator-defined entity attributes, definition CRUD, form rendering |
| 47 | [Cross-Type Equipment Unification](./FEATUREDOCS/47-cross-type-equipment-unification.md) | CategorySlot, mixedGroups query, UnifiedAddDialog, SubHireGroupRow, PriceEditDialog, Drop Matrix 8C |
| 48 | [Child Assets / Accessories](./FEATUREDOCS/48-child-assets-accessories.md) | Asset.parentAssetId + AssetBulkChild, SHIPS_WITH/DEDICATED allocation, childKind, project auto-expansion, warehouse cascade, PDF indented render |
| 51 | [Project Numbering](./FEATUREDOCS/51-project-numbering.md) | Configurable auto project codes, %-token template engine, ProjectNumberSequence atomic counter, reset periods, settings UI + live preview |
| 50 | [Project Tasks](./FEATUREDOCS/50-project-tasks.md) | ProjectTask model (status/priority/dueDate/checklist), user-or-crew assignee, Tasks tab panel, getMyOpenTasks cross-project query |
| 52 | [Bulk Check-In Totals](./FEATUREDOCS/52-bulk-checkin.md) | **UI removed** — backend retained but dormant. Project-wide accessory totals check-in: aggregate deployed accessory children by identity, deterministic distribution back to child lines, over-return rejection, idempotent/empty-safe submit |
| 53 | [Real-Time Sync](./FEATUREDOCS/53-realtime-sync.md) | ⚠️ SUPERSEDED & REMOVED (2026-06-11) — the SSE + Event Bus + RQ-invalidation system was a dead no-op; torn out in the Phase 6 Convex migration. Liveness is now Convex's reactive engine. See [54](./FEATUREDOCS/54-convex-data-layer.md). |
| 54 | [Convex Data Layer](./FEATUREDOCS/54-convex-data-layer.md) | Convex data layer — all domain reads/writes are native/browser-direct on Convex Cloud; Postgres holds Better Auth + a dormant custom-API pair + a frozen audit log only. Write security bar, service-token read helpers, and the permanent server-action carve-outs. |
| 55 | [Project Collaboration](./FEATUREDOCS/55-project-collaboration.md) | Convex-backed collaboration substrate: presence + edit locks (entity/section/group/line/record targets, stale takeover), comment threads (blocking, resolve/reopen, mentions), review markers, group-level blocking gates, live row pulse/changed-flash (reduced-motion aware), and a realtime activity feed (incl. grouped imports). Wired on projects + client/supplier/asset records. All state persists to Convex. |
| 56 | [Agent-Accessible API + MCP](./FEATUREDOCS/56-api-mcp.md) | **REMOVED 2026-07-14 (dormant, to be reinstated).** The agent-API request surface (`src/lib/api/*`, `/api/v1/*`, `llms.txt`, registry generator, `/settings/api-keys` UI) was deleted during the Convex-native migration — its generated registry coupled the API contract to the `src/server/*` data layer being torn down. `ApiKey` backend kept dormant; reinstate over the native Convex queries/mutations once domains are native. See FEATUREDOCS/56 for the blueprint. |
| 57 | [Revenue Allocation & Gear ROI](./FEATUREDOCS/57-revenue-allocation-roi.md) | Splits a kit's or bundle's price across the gear inside it (`allocatedRevenue` + `allocationBasis` on every line item), so per-**model** ROI is answerable for gear that only ever ships inside a kit. One recursive walk of the line-item tree, integer-cent largest-remainder rounding, run from the tail of `recalcProjectTotals` so no write path can forget it. Surfaces: kit allocation panel, model ROI tab, `/assets/roi` fleet leaderboard. Design: [docs/revenue-allocation-design.md](./docs/revenue-allocation-design.md) |
| 58 | [Webhooks](./FEATUREDOCS/58-webhooks.md) | Signed outbound events (project.status_changed, line_item.added, warehouse.checked_out, maintenance.created) with HMAC signing, secret rotation, exponential-backoff retries, a delivery log, auto-disable, and a strict SSRF policy. Design: [docs/designs/webhooks.md](./docs/designs/webhooks.md) |
| 59 | [Bulk Operations](./FEATUREDOCS/59-bulk-operations.md) | Multi-select + bulk actions across all four project surfaces — **Equipment** (delete/move/edit), **Services** (status/delete), **Crew** (status/remove), **Tasks** (move/priority/delete). Shared `useSelection` + `BulkActionBar` + `BulkDeleteDialog`; batched server actions loop single-item Convex mutations with one recalc + one audit each. |
| 60 | [Assets on a Job](./FEATUREDOCS/60-assets-on-a-job.md) | Project Equipment tab shows which specific serialised assets are prepped/deployed/returned on a job (inline tag for single, expandable per-unit rows + status badge for multi-qty, kit-member tags), with a per-unit "reassign to another same-model line" picker to correct the scan auto-pick. RETURNED units are retained through check-in/close-out (+ deprep guard + `assetScanLog` backstop), so a finished job still shows what went out. Extends [line-item-fulfillment-model](./docs/designs/archive/line-item-fulfillment-model.md). |
| 61 | [Observability](./FEATUREDOCS/61-observability.md) | Analytics + error tracking on PostHog (`posthog-js`/`posthog-node`), PII-hardened. Replaced Sentry entirely (#650) — client/server exception capture, Core Web Vitals, and deploy-pipeline sourcemap upload (`@posthog/nextjs-config`, BuildKit-secret-mounted CLI token) that hard-fails the build if misconfigured rather than silently skipping. |
| 62 | [Project Lifecycle Locks](./FEATUREDOCS/62-project-lifecycle-locks.md) | Status-tier lock model (#957): finance soft-lock at CONFIRMED+ (#791), ON_SITE justification gate (#793), COMPLETED hard-lock + whole-project version snapshots + Versions/diff UI (#792). One shared `assertLifecycleGuard` + lock-tier module every gate site calls; unlock sessions (FINANCIAL/FULL scope) with justified-open/commit/discard + snapshot-backed restore. |

See also [`docs/glossary.md`](./docs/glossary.md) for core domain terms and documented
aliases (POLICY.md R-3.10).

**When making changes**: Read the relevant feature doc(s) first, follow documented patterns, and update the relevant doc(s) after. If no doc exists for the feature you're working on, create a new numbered file in `FEATUREDOCS/` and add it to the table above.

All new features and non-trivial changes must go on a dedicated branch — never commit feature work directly to `main`.
