<!-- GENERATED FILE — DO NOT EDIT. Run `pnpm run api:registry`. -->
# API/MCP coverage

Printed by `scripts/generate-api-registry.mts` on every PR. "Agent-reachable"
means the function's guard admits an AGENT token — i.e. it calls
`requireOrgPermission`, `requireOrgReadFor`/`requireOrgReadDocFor`, or
`requireSelfScope`. Everything else is unreachable *by construction*, not by
convention:

- **SERVICE-only** — `requireService` throws for any non-service identity, so
  raw generated CRUD, mirror writes and backfills cannot be addressed from the
  API/MCP surface at all. This is the load-bearing invariant of the whole design
  (§3), machine-checked in `convex/agentServiceUnreachable.test.ts`.
- **Org-read** — still on the resource-less `requireOrgRead`/`requireOrgReadDoc`
  guard, which carries no resource to intersect an API key's scopes against, so it
  fails closed for agents (decision 2). Migrating one is a one-argument change.
- **Unclassified** — the static classifier found no guard it recognises (usually
  a guard reached through more than one level of local indirection). Treated as
  NOT reachable, which is the safe default; worth a look if the count grows.

## Totals

| | Total public | Agent-reachable | SERVICE-only | Org-read (fails closed for agents) | Unclassified |
|---|---|---|---|---|---|
| Queries | 395 | 67 | 158 | 168 | 2 |
| Mutations | 724 | 264 | 453 | 1 | 6 |
| **Total** | **1119** | **331** | **611** | **169** | **8** |

<!-- reachability-floor: 331 -->

The reachability floor above is a CI gate: the agent-reachable count may not drop
below it. Lowering it is allowed but must be a visible, explained line in a PR
diff — that is the whole mechanism. Raising it happens naturally as Phase 5
migrates `requireOrgRead` call sites to `requireOrgReadFor`.

## Modules with no agent-reachable operation

Each of these is either genuinely closed (site-admin surfaces, mirrors, backfills,
org export) or simply not migrated yet. Phase 5 triages them per domain — widen,
add a redacted sibling, or record as permanently denied with a reason.

| Module | Public operations |
|---|---|
| `activityLogWrites` | 2 |
| `activityLog` | 3 |
| `apiIdempotency` | 4 |
| `apiKeys` | 6 |
| `apiRequestLog` | 3 |
| `assetAccessories` | 1 |
| `assetBulkChildren` | 6 |
| `assetMedia` | 8 |
| `assetScanLogs` | 10 |
| `availabilityCheck` | 1 |
| `backfillClientContacts` | 1 |
| `backfillKitUnits` | 1 |
| `backfillMaintenanceSchedules` | 1 |
| `backfillProjectWindow` | 1 |
| `backfillQuoteRevisions` | 2 |
| `backfillStripProjectDepositPercent` | 1 |
| `categorySlots` | 11 |
| `checkItems` | 7 |
| `checkRecordOps` | 8 |
| `checkRecords` | 8 |
| `clientContacts` | 8 |
| `clientMedia` | 7 |
| `clientXeroWrites` | 2 |
| `crewAvailabilities` | 8 |
| `crewDashboard` | 6 |
| `crewRoles` | 8 |
| `crewShifts` | 9 |
| `crewSkills` | 6 |
| `crewTimeEntries` | 12 |
| `customFieldDefinitions` | 7 |
| `dashboardActivity` | 1 |
| `dashboardCounters` | 4 |
| `dashboardLists` | 3 |
| `dashboardStats` | 1 |
| `dashboardSubHire` | 1 |
| `emails` | 1 |
| `fileUploads` | 8 |
| `files` | 4 |
| `financeArtifacts` | 4 |
| `globalSearch` | 1 |
| `groupTemplateItems` | 6 |
| `groupTemplates` | 6 |
| `invoiceLines` | 1 |
| `invoices` | 3 |
| `kitAllocations` | 1 |
| `kitBulkItems` | 8 |
| `kitCheckItems` | 11 |
| `kitMedia` | 8 |
| `kitSerializedItems` | 9 |
| `lineItemMergeMaps` | 6 |
| `locationMedia` | 7 |
| `locations` | 9 |
| `maintenanceRecordAssets` | 9 |
| `mediaWrites` | 4 |
| `members` | 5 |
| `modelBulkAccessories` | 7 |
| `modelCheckItems` | 13 |
| `modelMedia` | 9 |
| `notificationDismissals` | 7 |
| `notificationEmailLogs` | 6 |
| `orgExport` | 6 |
| `orgSettings` | 8 |
| `parity` | 1 |
| `pendingSSOApprovals` | 5 |
| `projectCategories` | 11 |
| `projectLineItemUnits` | 9 |
| `projectManagers` | 8 |
| `projectMedia` | 7 |
| `projectNumberSequences` | 7 |
| `projectServices` | 8 |
| `projectTasks` | 12 |
| `quotes` | 2 |
| `returnsLookup` | 1 |
| `roi` | 4 |
| `savedTableViews` | 8 |
| `scanLookup` | 1 |
| `search` | 4 |
| `serviceSchedules` | 1 |
| `serviceTemplates` | 7 |
| `siteSettings` | 8 |
| `subHireGroups` | 8 |
| `subHireItems` | 7 |
| `subHireMedia` | 7 |
| `subHires` | 9 |
| `subTestRecords` | 8 |
| `supplierModelRates` | 7 |
| `supplierOrderItems` | 7 |
| `supplierOrders` | 7 |
| `suppliers` | 11 |
| `systemFlags` | 2 |
| `tags` | 1 |
| `testProfiles` | 7 |
| `testTagAssets` | 16 |
| `testTagAuditorTokens` | 7 |
| `testTagRecords` | 11 |
| `users` | 5 |
| `warehouseDashboardTokens` | 7 |
| `warehouseOps` | 24 |
| `webhooks` | 14 |
| `wooCommerceIntegrations` | 7 |
| `wooCommerceOrderLogs` | 7 |
| `xeroIntegrations` | 4 |
| `xeroPush` | 4 |
| `xeroSyncLogs` | 3 |

## Deliberately denied (Phase 5 triage, #1001)

Operations annotated `agentAccess: "denied"` in their module's `agentOps`
export (`convex/lib/agentOps.ts`) — a recorded decision to keep the surface
closed, not an oversight. Every row here has a written reason; the generator
fails the build otherwise.

| Operation | Reason |
|---|---|
| _(none yet)_ | |
