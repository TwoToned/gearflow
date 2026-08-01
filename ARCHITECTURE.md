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
| 12 | [Warehouse](./FEATUREDOCS/12-warehouse.md) | Deploy/return flows, kit verification, conflict detection, org-wide returns station |
| 13 | [PDFs](./FEATUREDOCS/13-pdfs.md) | Document generation, nested kit rendering, T&T reports |
| 14 | [Test & Tag](./FEATUREDOCS/14-test-and-tag.md) | AS/NZS 3760:2022 compliance module |
| 15 | [Maintenance](./FEATUREDOCS/15-maintenance.md) | Maintenance records, multi-asset, recurring preventative-maintenance schedules |
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
| 52 | [Bulk Check-In Totals](./FEATUREDOCS/52-bulk-checkin.md) | Convex-native bulk check-in engine (aggregate deployed items by identity, deterministic distribution, over-return rejection) — live caller as of issue #944: the returns station's bulk-tag scan (`returnsWrites.returnBulkNative`) |
| 53 | [Real-Time Sync](./FEATUREDOCS/53-realtime-sync.md) | ⚠️ SUPERSEDED & REMOVED (2026-06-11) — the SSE + Event Bus + RQ-invalidation system was a dead no-op; torn out in the Phase 6 Convex migration. Liveness is now Convex's reactive engine. See [54](./FEATUREDOCS/54-convex-data-layer.md). |
| 54 | [Convex Data Layer](./FEATUREDOCS/54-convex-data-layer.md) | Convex data layer — all domain reads/writes are native/browser-direct on Convex Cloud; Postgres holds Better Auth + a dormant custom-API pair + a frozen audit log only. Write security bar, service-token read helpers, and the permanent server-action carve-outs. |
| 55 | [Project Collaboration](./FEATUREDOCS/55-project-collaboration.md) | Convex-backed collaboration substrate: comment threads (blocking, resolve/reopen, mentions), review markers, group-level blocking gates, live row changed-flash (reduced-motion aware), and a realtime activity feed (incl. grouped imports). Wired on projects + client/supplier/asset records. All state persists to Convex. |
| 56 | [Agent-Accessible API + MCP](./FEATUREDOCS/56-api-mcp.md) | **Reinstatement underway — phases 0-7 landed (#996-#1003).** The API mints a short-lived AGENT token (`sub` = the key's acting user, `akid` = the key, never `svc`) instead of the SERVICE token, so every in-mutation gate applies with no per-operation security code and the `requireService`-gated functions are unreachable by construction. A real HTTP API is live: `POST /api/v1/ops/{operation}` (the universal dispatcher), `GET /api/v1/operations{,/[operation]}`, `GET /api/v1/whoami`, curated REST aliases, OpenAPI 3.1 + `llms.txt` — **and a streamable HTTP MCP server at `/api/v1/mcp`**, 21 curated tools + discovery (`list_operations`/`describe_operation`/`call_operation`) + resources/prompts + a local stdio proxy, all generated from the same registry (`pnpm run api:mcp:check`, CI-gated). One curated tool, `get_project_document` (added 2026-07-30), fetches a project's PDFs (delivery docket, pick slip, return sheet, quote, invoice) — it doesn't go through `dispatch()` since PDF rendering needs Node/Prisma the Convex-only dispatcher can't reach (`src/lib/api/documents.ts`, also served at `GET /api/v1/documents/{projectId}`), but its result is JSON like every other tool: a short-lived download URL + metadata, not the PDF bytes inline (an initial base64-blob version broke in real client use and was replaced same-day). **Phase 4 (#1000) added the safety rails**: every agent-reachable mutation carries a CI-gated `danger` classification, `danger:"high"` requires `confirm:true` at the dispatcher, the §6 privileged-arg table is fully enforced (`project:unlock_session` denied by default), the `noFinancials` key flag extends to models/crew-assignment cost fields, the activity log has an agent-authored badge/filter, and `revertAgentWindow` lets an operator reverse a bad agent warehouse run. **Phase 5's coverage sweep took agent-reachable operations from 331 to 549** (284 queries + 265 mutations) — essentially every `requireOrgRead`/`requireOrgReadDoc` call site is now migrated, and the `agentOps` colocated annotation format (`convex/lib/agentOps.ts`) records every SERVICE-only-query triage decision (widen/deny) with a reason. **`/settings/api-keys`** (Phase 6) mints/rotates/revokes keys, four scope presets, the org-wide kill switch, a per-key request log, and a one-click "Connect an AI Agent" MCP flow. **Phase 7 (#1003) added MCP OAuth 2.1** — `.well-known` authorization-server + protected-resource metadata, RFC 7591 dynamic client registration, a session-gated consent screen at `/oauth/authorize` that narrows requested scopes to the consenting user's live RBAC, a token endpoint (`authorization_code`+PKCE and `refresh_token` grants), and RFC 7009 revocation. An OAuth grant is a plain `apiKeys` row (`origin: "oauth"`) — a pure auth adapter with zero new gate logic, unlocking claude.ai + desktop connectors for non-technical staff with no admin involvement. Coverage table: [`docs/api-coverage.md`](./docs/api-coverage.md). |
| 57 | [Revenue Allocation & Gear ROI](./FEATUREDOCS/57-revenue-allocation-roi.md) | Splits a kit's or bundle's price across the gear inside it (`allocatedRevenue` + `allocationBasis` on every line item), so per-**model** ROI is answerable for gear that only ever ships inside a kit. One recursive walk of the line-item tree, integer-cent largest-remainder rounding, run from the tail of `recalcProjectTotals` so no write path can forget it. Surfaces: kit allocation panel, model ROI tab, `/assets/roi` fleet leaderboard. Design: [docs/revenue-allocation-design.md](./docs/revenue-allocation-design.md) |
| 58 | [Webhooks](./FEATUREDOCS/58-webhooks.md) | Signed outbound events (project.status_changed, line_item.added, warehouse.checked_out, maintenance.created) with HMAC signing, secret rotation, exponential-backoff retries, a delivery log, auto-disable, and a strict SSRF policy. Design: [docs/designs/webhooks.md](./docs/designs/webhooks.md) |
| 59 | [Bulk Operations](./FEATUREDOCS/59-bulk-operations.md) | Multi-select + bulk actions across all four project surfaces — **Equipment** (delete/move/edit), **Services** (status/delete), **Crew** (status/remove), **Tasks** (move/priority/delete). Shared `useSelection` + `BulkActionBar` + `BulkDeleteDialog`; batched server actions loop single-item Convex mutations with one recalc + one audit each. |
| 60 | [Assets on a Job](./FEATUREDOCS/60-assets-on-a-job.md) | Project Equipment tab shows which specific serialised assets are prepped/deployed/returned on a job (inline tag for single, expandable per-unit rows + status badge for multi-qty, kit-member tags), with a per-unit "reassign to another same-model line" picker to correct the scan auto-pick. RETURNED units are retained through check-in/close-out (+ deprep guard + `assetScanLog` backstop), so a finished job still shows what went out. Extends [line-item-fulfillment-model](./docs/designs/archive/line-item-fulfillment-model.md). |
| 61 | [Observability](./FEATUREDOCS/61-observability.md) | Analytics + error tracking on PostHog (`posthog-js`/`posthog-node`), PII-hardened. Replaced Sentry entirely (#650) — client/server exception capture, Core Web Vitals, and deploy-pipeline sourcemap upload (`@posthog/nextjs-config`, BuildKit-secret-mounted CLI token) that hard-fails the build if misconfigured rather than silently skipping. |
| 62 | [Project Lifecycle Locks](./FEATUREDOCS/62-project-lifecycle-locks.md) | Status-tier lock model (#957): finance soft-lock at CONFIRMED+ (#791), ON_SITE justification gate (#793), COMPLETED hard-lock + whole-project version snapshots + Versions/diff UI (#792). One shared `assertLifecycleGuard` + lock-tier module every gate site calls; unlock sessions (FINANCIAL/FULL scope) with justified-open/commit/discard + snapshot-backed restore. |
| 63 | [Client Contacts](./FEATUREDOCS/63-client-contacts.md) | Multiple contacts per client (#948, WS9) — a new `clientContacts` child table (fully optional, exclusive `isPrimary`), a per-project `clientContactId` picker, and one shared `getPrimaryContact` resolver used by the client detail page, PDFs, search, and WooCommerce matching. Expand-migrate phase only — the legacy embedded `clients.contactName/Email/Phone` fields stay live as a read-only fallback; dropping them is a separate follow-up. |
| 64 | [Incident Reporting](./FEATUREDOCS/64-incident-reporting.md) | "Report Issue" — the in-app successor to the deleted Discord `/fault` command (#898). Reuses `MaintenanceRecord` (type=REPAIR, `incidentType`/`incidentSeverity` set) rather than a parallel model; flips the reported asset's status immediately (IN_MAINTENANCE / LOST). Available on CHECKED_OUT project lines, the warehouse deploy/return tabs, and the asset detail page. A check-item FAIL now also opens an immediate REPAIR record (alongside the existing 2-of-3-fails predictive trigger, unchanged). |
| 65 | [Overbookings & Gaps Board](./FEATUREDOCS/65-overbookings-gaps-board.md) | Org-wide two-layer (hard/pencilled) gear + crew-gap risk board (#942, WS3) — `/overbookings`, six sections (overbooked gear, pencilled collisions, sale stock to procure, services missing crew, unconfirmed crew, crew double-bookings), the confirm-time gate preview, and dashboard chips. Builds on WS2's `getProjectWindow` (#941, [11-availability.md](./FEATUREDOCS/11-availability.md)). |
| 66 | [Finance — Quotes, Invoices, Xero](./FEATUREDOCS/66-finance-quotes-invoices-xero.md) | The finance model (#940, WS1) — reverses the earlier "no Flow-side finance" stance: RVLT Flow owns Quote (snapshot-on-publish, versioned) + Invoice/InvoiceLine (Flow-numbered, immutable once issued) generation; Xero owns the ledger/payments via a first-class OAuth2 integration (account-coding cascade, draft-invoice push, client contact mapping with duplicate protection). Client payment profiles (FULL_UPFRONT/DEPOSIT_BALANCE) replace the old hand-typed project deposit fields; `depositPaid`/`invoicedTotal` are now recalc-derived. |
| 67 | [Sales Line Items](./FEATUREDOCS/67-sales-line-items.md) | New `LineItemType: "SALE"` (#950, WS11) — every model sellable, bulk + serialised. Hybrid taxonomy: `type: "SALE"` + `saleMode` (`NEW_STOCK` decrements `Model.saleStockQuantity`, no rental impact; `FROM_RENTAL_STOCK` disposes of an owned unit — serialised flips to terminal `AssetStatus: "SOLD"` via a reversible "un-sell" action, bulk decrements total/available floored at deployed qty). Always `pricingType: FLAT, duration: 1`, auto-priced from `Model.salePrice`. New `projects.saleRevenue`/`saleCostTotal` P&L buckets + `AllocationBasis: "EXCLUDED_SALE"` (no rental-ROI weight). PDF: SALE badge on quote/invoice, always included on docket/packing-list, excluded from the return sheet. Feeds the Overbookings & Gaps board's "Sale stock to procure" section. |
| 68 | [Mira Assistant](./FEATUREDOCS/68-mira-assistant.md) | Phase 8 (#1004) — Mira's first real wiring on top of the pre-existing `MiraContextProvider`: it answers a page-contextual question by calling the SAME agent-accessible dispatch()/MCP surface (FEATUREDOCS/56) an external agent uses, acting as the asking user via a per-(org, user) `apiKeys` row it provisions itself (`miraKeys` table, encrypted at rest). A small deterministic keyword/page-context router (`src/lib/mira/intent-router.ts`), not an LLM — the plumbing this phase asked for. |
| 69 | [Project Overview Tab](./FEATUREDOCS/69-project-overview.md) | #1061 — the project detail's home tab, and the IA change around it: the page-wide right sidebar (Schedule/Location/Team/Activity) moved into Overview so every other tab renders FULL WIDTH, and the summary strip + conflicts banner came off the top of the page. Leads with a **Readiness** checklist (gear shortage, double-booked assets, unconfirmed/understaffed crew, unpriced lines, stale pricing) that always renders every check — including passing ones, collapsing to one line when all pass — with the fixing action inline on each failing row. Paired **Quote**/**Invoicing** cards carry only the single next action each; the Finance tab stays the owner of the full revision rail, invoice list, payments and P&L. Backed by a new `projectReadiness.forProject` query reusing the org board's bounded reads, and it collapsed three pre-existing rule duplications rather than adding a fourth. |

See also [`docs/glossary.md`](./docs/glossary.md) for core domain terms and documented
aliases (POLICY.md R-3.10).

**When making changes**: Read the relevant feature doc(s) first, follow documented patterns, and update the relevant doc(s) after. If no doc exists for the feature you're working on, create a new numbered file in `FEATUREDOCS/` and add it to the table above.

All new features and non-trivial changes must go on a dedicated branch — never commit feature work directly to `main`.
