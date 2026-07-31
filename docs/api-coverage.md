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
| Queries | 402 | 287 | 113 | 1 | 1 |
| Mutations | 740 | 271 | 460 | 0 | 9 |
| **Total** | **1142** | **558** | **573** | **1** | **10** |

<!-- reachability-floor: 558 -->

The reachability floor above is a CI gate: the agent-reachable count may not drop
below it. Lowering it is allowed but must be a visible, explained line in a PR
diff — that is the whole mechanism. Raising it happens naturally as Phase 5
migrates `requireOrgRead` call sites to `requireOrgReadFor`.

## Danger classification (Phase 4, #1000)

Every agent-reachable mutation carries a `low`/`medium`/`high` `danger` tier from
its module's colocated `agentOps` export. `high` requires `confirm: true` (and an
idempotency key, already required of every mutation) at the dispatcher — see
`src/lib/api/dispatcher.ts`.

| Tier | Agent-reachable mutations |
|---|---|
| `high` | 91 |
| `medium` | 142 |
| `low` | 38 |

## Modules with no agent-reachable operation

Each of these is either genuinely closed (site-admin surfaces, mirrors, backfills,
org export) or simply not migrated yet. Phase 5 triages them per domain — widen,
add a redacted sibling, or record as permanently denied with a reason.

| Module | Public operations |
|---|---|
| `activityLogWrites` | 2 |
| `apiIdempotency` | 4 |
| `apiKeys` | 10 |
| `apiRequestLog` | 3 |
| `availabilityCheck` | 1 |
| `backfillClientContacts` | 1 |
| `backfillKitUnits` | 1 |
| `backfillMaintenanceSchedules` | 1 |
| `backfillProjectWindow` | 1 |
| `backfillQuoteRevisions` | 2 |
| `backfillStripProjectDepositPercent` | 1 |
| `categorySlots` | 11 |
| `checkRecordOps` | 8 |
| `clientXeroWrites` | 2 |
| `crewShifts` | 9 |
| `emails` | 1 |
| `financeArtifacts` | 4 |
| `globalSearch` | 1 |
| `mediaWrites` | 4 |
| `miraKeys` | 2 |
| `notificationDismissals` | 7 |
| `oauthAuthorizationCodes` | 2 |
| `oauthClients` | 3 |
| `orgExport` | 6 |
| `orgSettings` | 8 |
| `parity` | 1 |
| `pendingSSOApprovals` | 5 |
| `projectNumberSequences` | 7 |
| `siteSettings` | 8 |
| `subHireGroups` | 8 |
| `subHireItems` | 7 |
| `supplierOrderItems` | 7 |
| `systemFlags` | 2 |
| `testTagAuditorTokens` | 7 |
| `users` | 5 |
| `warehouseDashboardTokens` | 7 |
| `warehouseOps` | 24 |
| `webhooks` | 14 |
| `wooCommerceIntegrations` | 7 |
| `wooCommerceOrderLogs` | 7 |

## Deliberately denied (Phase 5 triage, #1001)

Operations annotated `agentAccess: "denied"` in their module's `agentOps`
export (`convex/lib/agentOps.ts`) — a recorded decision to keep the surface
closed, not an oversight. Every row here has a written reason; the generator
fails the build otherwise.

| Operation | Reason |
|---|---|
| `apiKeys.getByRefreshTokenHash` | The API key management surface itself must not be self-servable by an API key (privilege escalation risk). |
| `apiKeys.getByTokenHash` | The API key management surface itself must not be self-servable by an API key (privilege escalation risk). |
| `apiKeys.list` | The API key management surface itself must not be self-servable by an API key (privilege escalation risk). |
| `apiKeys.mintOAuthGrant` | The API key management surface itself must not be self-servable by an API key (privilege escalation risk). |
| `apiKeys.rotateOAuthTokens` | The API key management surface itself must not be self-servable by an API key (privilege escalation risk). |
| `assetScanLogs.listByScannedById` | Cross-org GDPR-cascade lookup by scannedById with no org filter at all (not org-scoped even in JS) — an internal user-delete helper, not a real read surface. |
| `categorySlots.getById` | No organizationId column and no orgId arg; a single slot has no org to check against without an extra parent lookup — revisit under a projects-domain slice. |
| `categorySlots.list` | No organizationId column and no orgId arg; org-scoping needs a parent projectCategory lookup not done here — revisit under a projects-domain slice. |
| `categorySlots.listByProjectGroupId` | No organizationId column and no orgId arg; org-scoping needs a parent projectGroup lookup not done here — revisit under a projects-domain slice. |
| `categorySlots.listBySubHireGroupId` | No organizationId column and no orgId arg; org-scoping needs a parent subHireGroup lookup not done here — revisit under a projects-domain slice. |
| `clientMedia.getById` | Fetches by global cuid index with no orgId argument to check against; opening it risks a cross-tenant read (R-8.4.3). |
| `clientMedia.listByParent` | Fetches by global by_clientId index with no orgId argument to check against; opening it risks a cross-tenant read (R-8.4.3). |
| `crewShifts.getById` | crewShifts has no organizationId column; fetches by global cuid with no org check, so opening it risks a cross-tenant read (R-8.4.3). |
| `crewShifts.list` | crewShifts has no organizationId column; this query has no orgId to check the assignmentId argument against, so opening it risks a cross-tenant read (R-8.4.3). |
| `crewShifts.listByAssignmentIds` | crewShifts has no organizationId column; this query has no orgId to check the assignmentIds argument against, so opening it risks a cross-tenant read (R-8.4.3). |
| `fileUploads.getByThumbnailUrl` | Cross-org lookup with no orgId argument to check the caller's org against — structurally not an org-scoped read (see the function's own doc comment). |
| `fileUploads.isReferencedByMedia` | Cross-org lookup with no orgId argument to check the caller's org against — structurally not an org-scoped read (see the function's own doc comment). |
| `financeArtifacts.invoiceArtifactContext` | Same as quoteArtifactContext: SERVICE-gated by design (module docstring), exposes pdfFileId into the deliberately-closed finance-document subsystem; non-sensitive fields are already agent-reachable via invoices.ts. |
| `financeArtifacts.quoteArtifactContext` | Module docstring is explicit: SERVICE-gated with NO agent escape hatch for any function here, mirroring convex/files.ts. Exposes pdfFileId (a _storage pointer into the render-once/stored-bytes subsystem); the non-sensitive fields (status/dates) are already agent-reachable via quotes.ts, so widening only adds a new pointer surface into the deliberately-closed finance-document pipeline for no net capability gain. |
| `globalSearch.search` | Cross-resource search spans multiple RBAC domains; needs per-result-type scope design, not a single blanket resource. |
| `kitBulkItems.listByAddedById` | Cross-org GDPR-cascade lookup by addedById with no org filter at all — an internal user-delete helper, not a real read surface. |
| `maintenanceRecordAssets.listByAssetIds` | Batch join across caller-supplied assetIds with no per-id org check — would need a verify-and-filter redesign to scope safely. |
| `maintenanceRecordAssets.listByMaintenanceRecordIds` | Batch join across caller-supplied maintenanceRecordIds with no per-id org check — would need a verify-and-filter redesign to scope safely. |
| `members.listAll` | Full cross-tenant dump of every org's membership rows (no orgId argument to scope by); an auth-mirror reconcile utility, not an org-scoped read — would leak other orgs' membership/roles (R-8.4.3). |
| `modelBulkAccessories.getById` | No orgId/organizationId arg; fetched by a global by_cuid index with no org check to swap in without a parent-derivation step — revisit. |
| `modelMedia.getById` | No orgId arg; fetched by a global by_cuid index with no org check to swap in without a parent-derivation step — revisit. |
| `modelMedia.listByParent` | No orgId arg; modelId is a global foreign key with no org check to swap in without fetching the parent model first — revisit. |
| `oauthAuthorizationCodes.create` | OAuth authorization-code exchange is trusted-backend infrastructure, not agent-reachable. |
| `oauthAuthorizationCodes.redeem` | OAuth authorization-code exchange is trusted-backend infrastructure, not agent-reachable. |
| `oauthClients.getById` | OAuth client registration storage is trusted-backend infrastructure, not agent-reachable (same posture as apiKeys.list). |
| `oauthClients.listByIds` | OAuth client registration storage is trusted-backend infrastructure, not agent-reachable (same posture as apiKeys.list). |
| `oauthClients.register` | OAuth client registration storage is trusted-backend infrastructure, not agent-reachable (same posture as apiKeys.list). |
| `orgExport.childRowsByParentIds` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgExport.countTable` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgExport.exportTablePage` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgExport.getOrgRow` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgExport.listOrgIds` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgExport.scanTableFiltered` | Full unredacted org data export; bypasses per-resource redaction and has no scope model (design §4). |
| `orgSettings.getByIcalToken` | Global secret-token lookup (no orgId argument to scope against) — structurally not an org-scoped read. |
| `orgSettings.getByOrg` | Row/lookup exposes apiKillSwitchAt (the org's own write-kill-switch state) and/or icalToken (a bearer credential for the public iCal feed); no redacted projection exists here (contrast xeroIntegrations.getForOrg). |
| `parity.countPage` | Internal migration-parity diagnostic tool, not an application read surface. |
| `pendingSSOApprovals.getByOrgUser` | Site-admin SSO approval queue; platform-operator surface, not an org-scoped agent concern. |
| `pendingSSOApprovals.list` | Site-admin SSO approval queue; platform-operator surface, not an org-scoped agent concern. |
| `projectLineItemUnits.getById` | Point-read by global by_cuid with no orgId arg to verify the result against — would let an agent read another org's unit by guessing its cuid. |
| `projectLineItemUnits.listByLineItem` | by_lineItemId is a global index and the query takes no orgId arg, so a caller-supplied lineItemId can't be checked against the caller's org. |
| `projectLineItemUnits.listByLineItemIds` | Same gap as listByLineItem: no orgId arg to check the (global, cross-org) lineItemIds against. |
| `projectMedia.getById` | Point-read by global by_cuid with no orgId arg to verify the result against — would let an agent read another org's media row by guessing its cuid. |
| `projectMedia.listByParent` | by_projectId is a global index and the query takes no orgId arg, so a caller-supplied parentId can't be checked against the caller's org. |
| `projectNumberSequences.getById` | Internal sequence-counter bookkeeping, not a meaningful read for an agent. |
| `projectNumberSequences.getByOrgAndScopeKey` | Internal sequence-counter bookkeeping, not a meaningful read for an agent. |
| `revenueAllocation.listProjectIdsPage` | Backfill-only pagination helper for scripts/convex-backfill-revenue-allocation.ts, not a runtime read; a raw project-id enumeration doesn't fit the normal resource/scope model and financial allocation detail is out of scope pending Phase 4's no_financials flag. |
| `siteSettings.getById` | Site-admin/platform-level configuration, not org-scoped; no agent should ever see or need this. |
| `siteSettings.getSingleton` | Site-admin/platform-level configuration, not org-scoped; no agent should ever see or need this. |
| `siteSettings.list` | Site-admin/platform-level configuration, not org-scoped; no agent should ever see or need this. |
| `subHireGroups.getById` | Doc has no organizationId field (parent-join table), so requireOrgReadDocFor can't check it against the caller's org; would need to resolve the parent sub-hire's org first. |
| `subHireGroups.list` | subHireGroups has no organizationId column and this query takes only a subHireId (no orgId to verify) — can't be safely org-scoped without a signature change. |
| `subHireItems.getById` | Doc has no organizationId field (parent-join table), so requireOrgReadDocFor can't check it against the caller's org; would need to resolve the parent sub-hire's org first. |
| `subHireItems.list` | subHireItems has no organizationId column and this query takes only a subHireId (no orgId to verify) — can't be safely org-scoped without a signature change. |
| `subHireMedia.listByParent` | Takes only a subHireId (parentId), no orgId argument to verify against even though the row carries organizationId — widening would let an agent enumerate another org's sub-hire media by guessing/enumerating a subHireId; needs a signature change (add orgId) to check safely. |
| `subTestRecords.listByRecordIds` | Batch join across caller-supplied recordIds with no per-id org check — would need a verify-and-filter redesign to scope safely. |
| `supplierOrderItems.getById` | Doc has no organizationId field (parent-join table), so requireOrgReadDocFor can't check it against the caller's org; would need to resolve the parent order's org first. |
| `supplierOrderItems.list` | supplierOrderItems has no organizationId column and this query takes only an orderId (no orgId to verify) — a PARENT_JOIN table read that can't be safely org-scoped without a signature change; revisit alongside a supplierOrders-joined variant. |
| `supplierOrderItems.listByOrderIds` | Same parent-join shape as list/getById — no organizationId column and no orgId argument to verify against. |
| `systemFlags.getFlags` | This IS the platform-global browser-mutation write-kill-switch; an agent must never be able to inspect (let alone influence timing around) its own kill switch. Also platform-global, not org-scoped, so no Resource fits. |
| `testTagAuditorTokens.getById` | Returns the plaintext auditor-portal `token` field, not just metadata — sensitive token material. |
| `testTagAuditorTokens.getByTokenHash` | Returns the plaintext auditor-portal `token` field, not just metadata — sensitive token material. |
| `testTagAuditorTokens.list` | Returns the plaintext auditor-portal `token` field, not just metadata — sensitive token material. |
| `users.getById` | Global (non-org-scoped) user mirror — no per-row organizationId and no join against `members` to check the target user shares the caller's org; widening would let an agent read another org's members' name/email/image (cross-tenant PII, R-8.4.3). |
| `users.listAll` | Unfiltered platform-wide dump of every user's name/email (auth-mirror reconcile utility), not an org-scoped read. |
| `users.listByIds` | Global (non-org-scoped) user mirror — no per-row organizationId and no join against `members` to check the target user shares the caller's org; widening would let an agent read another org's members' name/email/image (cross-tenant PII, R-8.4.3). |
| `warehouseDashboardTokens.getById` | Returns the plaintext kiosk dashboard `token` field, not just metadata — sensitive token material. |
| `warehouseDashboardTokens.getByTokenHash` | Returns the plaintext kiosk dashboard `token` field, not just metadata — sensitive token material. |
| `warehouseDashboardTokens.list` | Returns the plaintext kiosk dashboard `token` field, not just metadata — sensitive token material. |
| `wooCommerceIntegrations.getById` | Row includes webhookSecret (a live credential) in the raw shape; no redacted projection exists here (contrast xeroIntegrations.getForOrg). |
| `wooCommerceIntegrations.list` | Row includes webhookSecret (a live credential) in the raw shape; no redacted projection exists here (contrast xeroIntegrations.getForOrg). |
| `wooCommerceOrderLogs.findCompletedByOrder` | The raw `payload` field stores the full WooCommerce webhook order body, which includes customer billing PII (name/email/phone/address) per src/lib/validations/woocommerce.ts — not a credential, but real customer PII with no redacted projection available (R-8.12). |
| `wooCommerceOrderLogs.getById` | The raw `payload` field stores the full WooCommerce webhook order body, which includes customer billing PII (name/email/phone/address) per src/lib/validations/woocommerce.ts — not a credential, but real customer PII with no redacted projection available (R-8.12). |
| `wooCommerceOrderLogs.list` | The raw `payload` field stores the full WooCommerce webhook order body, which includes customer billing PII (name/email/phone/address) per src/lib/validations/woocommerce.ts — not a credential, but real customer PII with no redacted projection available (R-8.12). |
| `xeroIntegrations.getByOrgId` | Raw row includes refreshTokenEncrypted; only the redacted getForOrg projection is agent-safe. Still requireService-only — untouched, not agent-reachable. |
