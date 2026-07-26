# Database Schema & Data Models

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The domain schema (assets, projects, kits, crew, everything the app is *for*)
lives in **Convex** (`convex/schema.ts`, 100+ tables) — Postgres/Prisma holds
only Better Auth and a couple of permanent carve-outs. See
[FEATUREDOCS/54-convex-data-layer.md](./54-convex-data-layer.md) for why.

## Prisma models (`prisma/schema.prisma`) — 16 models total

### Auth (Better Auth)
- **User** — `id, name, email, emailVerified, image, role ("user"|"admin"), banned, banReason, twoFactorEnabled`
- **Session** — `id, token, expiresAt, userId, activeOrganizationId, ipAddress, userAgent`
- **Account** — OAuth/credential provider accounts
- **Verification** — Email verification tokens
- **Jwks** — Better Auth JWT signing keys (Convex trusts this as the JWT issuer)
- **TwoFactor** / **BackupCode** — TOTP 2FA storage
- **Passkey** — `credentialID (unique), publicKey, counter, deviceType, backedUp, transports, name`

### Organization & SSO
- **Organization** — `id, name, slug (unique), logo, metadata (JSON), defaultTaxRate, apiKillSwitchAt`
- **Member** — `id, organizationId, userId, role (owner|admin|manager|member|staff|warehouse|viewer)`
- **Invitation** — `id, organizationId, email, role, status, expiresAt, inviterId`
- **SsoProvider** — Better Auth SSO plugin config (OIDC/SAML)
- **PendingSSOApproval** — JIT-provisioning approval queue for SSO logins

### Dormant / frozen
- **ApiKey** / **ApiIdempotency** — the agent-accessible API/MCP key + replay-guard
  models. The feature was pulled from prod 2026-07-14 (dormant, not deleted —
  see FEATUREDOCS/56). Note: `apiKeys` also exists as a Convex table
  (`convex/schema.ts`); which side is authoritative is in flux — check current
  code before building on either.
- **ActivityLog** — **frozen**: still holds pre-cutover audit history, but the
  domain layer no longer writes to it. The live audit trail is the Convex
  `activityLogs` table (`convex/activityLog.ts` / `activityLogWrites.ts`).

Everything else that used to be a Prisma model — Category, Model, Asset,
BulkAsset, Kit + kit items, Client, Location, Supplier, SupplierOrder,
Project, ProjectLineItem (+ Unit), MaintenanceRecord, TestTagAsset/Record,
FileUpload + `*Media` tables, CrewMember and the rest of crew, ProjectService,
Prep, DocumentTemplate, AssetScanLog, CustomRole, SiteSettings — was dropped
at the Convex cutover. Don't add a Prisma model for a new domain entity; add
a Convex table + `*Writes.ts` mutations instead.

## Convex domain schema (`convex/schema.ts`) — ~99 tables

Grouped by area (table names are the Convex identifiers, e.g. `assets`,
`projectLineItems`):

- **Auth mirror** — `users`, `sessions`, `accounts`, `organizations`,
  `members`, `invitations`, `ssoProviders`, `pendingSSOApprovals`,
  `twoFactors`, `backupCodes`, `passkeys` — Convex-side mirrors of the Better
  Auth Postgres rows (`createIfMissing`, never `create` — see CLAUDE.md),
  kept so Convex mutations can read caller identity without a Postgres round-trip.
- **Org config** — `orgSettings` (business settings, migrated off
  `organization.metadata`), `siteSettings`, `systemFlags` (the global write
  kill-switch).
- **Assets & catalog** — `categories`, `models`, `assets`, `bulkAssets`,
  `assetBulkChildren`, `modelBulkAccessories`, `locations`, `assetScanLogs`.
- **Kits** — `kits`, `kitSerializedItems`, `kitBulkItems`,
  `kitRevenueAllocations`.
- **Suppliers & sub-hire** — `suppliers`, `supplierOrders`,
  `supplierOrderItems`, `supplierModelRates`, `subHires`, `subHireItems`,
  `subHireGroups`.
- **Projects & line items** — `projects`, `projectLineItems`,
  `projectLineItemUnits` (the per-unit fulfillment model — see
  `docs/designs/archive/line-item-fulfillment-model.md`), `lineItemMergeMaps`,
  `projectCategories`, `categorySlots`, `projectGroups`, `projectManagers`,
  `projectModelRevenues`, `groupTemplates` + `groupTemplateItems`,
  `projectTasks`, `projectNumberSequences`.
- **Clients** — `clients`. `defaultDiscount` snapshots onto `Project.discountPercent`
  at project-create time only (server-side in `projectWrites.createNative`, plus the
  WooCommerce order-assembly path) — see FEATUREDOCS/10 "Discount default cascade".
- **Crew** — `crewMembers`, `crewRoles`, `crewSkills`, `crewAssignments`,
  `crewShifts`, `crewAvailabilities`, `crewTimeEntries`.
- **Project services** — `projectServices`, `serviceTemplates`.
- **Maintenance** — `maintenanceRecords`, `maintenanceRecordAssets`.
- **Test & Tag** — `testProfiles`, `testTagAssets`, `testTagRecords`,
  `subTestRecords`, `testTagAuditorTokens`.
- **Warehouse checks** — `checkItems`, `modelCheckItems`, `kitCheckItems`,
  `checkRecords`, `warehouseCloses`, `warehouseDashboardTokens`.
- **Media** — `fileUploads`, `storedFiles` (Convex-storage byte owner —
  Convex is the sole copy of uploaded files, no S3 fallback), plus one join
  table per entity: `modelMedia`, `assetMedia`, `kitMedia`, `projectMedia`,
  `clientMedia`, `locationMedia`, `subHireMedia`.
- **Notifications** — `notificationDismissals`,
  `userNotificationPreferences`, `notificationEmailLogs`, `sentEmails`
  (idempotency ledger for Convex-scheduled emails).
- **Custom fields** — `customFieldDefinitions`.
- **Saved views** — `savedTableViews`.
- **Collaboration substrate** — `collaborationPresence`, `collaborationLocks`,
  `commentThreads`, `comments`, `reviewMarkers`, `activityEvents` (a
  lightweight per-project feed, distinct from the audit trail below).
- **Audit** — `activityLogs` (the live audit trail — see "Dormant / frozen" above).
- **Webhooks** — `webhooks`, `webhookDeliveries`.
- **WooCommerce** — `wooCommerceIntegrations`, `wooCommerceOrderLogs`.
- **API keys** — `apiKeys` (see "Dormant / frozen" above).
- **Dashboard** — `dashboardCounters` (denormalised O(1) stat counters,
  maintained in-transaction on every counted write, reconciled periodically —
  see `convex/lib/counters.ts`).

For exact field shapes, indexes, and validators, read `convex/schema.ts`
directly — it's the only source of truth and this list will drift the moment
a table is added, same as the old file-by-file version of this doc did.
