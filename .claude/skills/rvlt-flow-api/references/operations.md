# Operation finder — beyond the curated tools

Operation names are `<module>.<fn>`. Call them with
`call_operation { operation, args, idempotencyKey?, confirm? }` (MCP) or
`POST /api/v1/ops/<module>.<fn>` (REST). Everything here is
`stability: tracks-app`: **run `describe_operation` before calling** — the
arg lists below are a map, not the contract, and the live schema wins.

Conventions in the tables: `?` = optional; dates are epoch ms; injected args
(`orgId`, `organizationId`, `actor`, `auditId`, `now`, create-shaped `id`)
are omitted because you never send them. Danger: `L`/`M`/`H`; `H` needs
`confirm: true` after a human has seen the summary.

## Projects (jobs)

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Full detail incl. line items | `projectDetail.bundle` | read | `project:read` | `projectId` |
| Plain row | `projects.getById` | read | `project:read` | `id` |
| By job number | `projects.getByOrgAndNumber` | read | `project:read` | `projectNumber` |
| Paginated / searched list | `projects.listPage` | read | `project:read` | `search?`, `statusIn?[]`, `typeIn?[]`, `page?`, `pageSize?`, `sortBy?`, `sortOrder?` |
| Everything (unpaginated) | `projects.list` | read | `project:read` | — |
| Several by id | `projects.listByIds` | read | `project:read` | `ids[]` |
| Readiness checks (gear / conflicts / crew / services / pricing) | `projectReadiness.forProject` | read | `project:read` | `projectId` |
| Dashboard lists | `dashboardLists.home` / `.upcoming` / `.blocking` / `.needsYou` / `.pendingCrewOffers` | read | `project:read` | — |
| Create | `projectWrites.createNative` | M | `project:create` | `name`, `clientId?`, `type?`, `status?`, `rentalStartDate?`, `rentalEndDate?`, `projectStartDate?`, `projectEndDate?`, `locationId?`, `projectManagerId?`, `description?`, `tags?[]`, notes fields |
| Edit fields | `projectWrites.updateNative` | M | `project:update` | `id`, `set{…}` (send `null`/`""` in `set` to clear; `clear[]` is synthesised) |
| Edit a notes field only | `projectWrites.updateNotesNative` | L | `project:update` | `id`, `field`, `notes` |
| Change status | `projectWrites.updateStatusNative` | **H** | `project:update` | `id`, `status` — prefer letting automation move it |
| Duplicate | `projectWrites.duplicateNative` | M | `project:create` | `sourceId`, `newId`, `newName`, `newProjectNumber` |
| Archive | `projectWrites.archiveNative` | **H** | `project:update` | `id` |
| Delete | `projectWrites.deleteNative` | **H** | `project:delete` | `id`, `defaultLocationId` — no preset grants delete |

Project types: `DRY_HIRE, WET_HIRE, INSTALLATION, TOUR, CORPORATE, THEATRE,
FESTIVAL, CONFERENCE, OTHER`.

## Line items (gear on a job)

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| List for a job | `projectLineItems.listByProject` | read | `project:read` | `projectId`, `versionId?` |
| One line | `projectLineItems.getById` | read | `project:read` | `id` |
| Lines using an asset / model | `projectLineItems.listByAssetId` / `.listByModelId` | read | `project:read` | `assetId` / `modelId` |
| Add gear (curated `add_line_items`) | `lineItemWrites.addNative` | M | `project:manage_line_items`, `asset:update` | `projectId`, `fields{ quantity, modelId? \| assetId? \| bulkAssetId?, type?, unitPrice?, pricingType?, duration?, discount?, discountMode?, taxRate?, isOptional?, notes?, description?, categoryId?, groupId?, groupName? }`, `includeAccessories`, `allowOverbook` |
| Add a non-stock line (service, labour, transport, misc) | `lineItemWrites.addCustomNative` | M | `project:manage_line_items` | `projectId`, `fields{ type, description, quantity, unitPrice?, pricingType?, … }` |
| Add a whole kit | `lineItemWrites.addKitNative` | M | `project:manage_line_items` | `projectId`, `kitId`, `kitLabel`, `pricingMode`, `unitPrice?`, `categoryId?`, `groupId?` |
| Edit a line | `lineItemWrites.patchNative` | M | `project:manage_line_items` | `id`, `entityName`, `set{…}`, `allowOverbook` |
| Edit many | `lineItemWrites.patchManyNative` | M | `project:manage_line_items` | `ids[]`, `patch{…}` |
| Remove | `lineItemWrites.removeNative` / `.removeManyNative` | **H** | `project:manage_line_items` | `id` / `ids[]` |
| Reorder | `lineItemWrites.reorderNative` | L | `project:manage_line_items` | `items[]` |
| Re-price auto-priced lines | `lineItemWrites.recalcAutoPricedLinesNative` | L | `project:manage_line_items` | `projectId` |
| Swap the committed unit (curated `swap_asset`) | `projectLineItems.swapLineItemAsset` | M | `project:manage_line_items` | `lineItemId`, `newAssetId` |
| Valid swap candidates | `reservationConflicts.swapCandidates` | read | `project:read` | `lineItemId` |
| A job's own conflicts | `reservationConflicts.projectConflicts` | read | `project:read` | `projectId` |

Line types: `EQUIPMENT, SERVICE, LABOUR, TRANSPORT, MISC, SALE`. Pricing
types: `PER_DAY, PER_WEEK, FLAT, PER_HOUR, OPTIMIZED`. A money edit on a job
whose pricing is locked fails `PRICING_LOCKED`.

## Availability & overbooking

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| All bookings in a window (curated `check_availability`) | `availability.calendarData` | read | `project:read` | `startMs`, `endMs` |
| Bookings for one model / asset / kit | `availability.modelBookings` / `.assetBookings` / `.kitBookings` | read | `project:read` | `modelId`/`assetId`/`kitId`, `startMs`, `endMs` |
| Conflicts board (curated `list_overbookings`) | `overbookingBoard.bundle` | read | `project:read` | `rangeStart`, `rangeEnd` |
| Conflict counts | `overbookingBoard.counts` | read | `project:read` | `rangeStart`, `rangeEnd` |
| "What would confirming strand?" preview | `overbookingBoard.confirmImpact` | read | `project:read` | `projectId` |
| "What would moving the dates strand?" preview | `overbookingBoard.dateMoveImpact` | read | `project:read` | `projectId`, `start`, `end` |

## Assets, models, kits

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Searched / filtered / paged assets | `assets.listPage` | read | `asset:read` | `search?`, `statusIn?[]`, `modelId?`, `categoryIdIn?[]`, `locationIdIn?[]`, `conditionIn?[]`, `tagsHasSome?[]`, `isActive?`, `page?`, `pageSize?` |
| By asset tag (barcode) | `assets.getByAssetTag` | read | `asset:read` | `assetTag` |
| Units of a model | `assets.listByModel` | read | `asset:read` | `modelId` |
| Create a unit | `assetWrites.createNative` | M | `asset:create` | `modelId`, `assetTag`, `serialNumber?`, `status?`, `condition?`, `locationId?`, `purchaseDate?`, `purchasePrice?`, … |
| Edit a unit | `assetWrites.updateNative` | M | `asset:update` | `id`, `set{…}` |
| Update notes | `assetWrites.updateNotesNative` | L | `asset:update` | `id`, `notes` |
| Bulk tag | `assetWrites.bulkTagNative` | M | `asset:update` | `ids[]`, `tags[]` |
| Archive / delete | `assetWrites.archiveNative` / `.deleteNative` | **H** | `asset:update` / `asset:delete` | `id` |
| Models (catalogue) | `models.list` / `.getById` / `.detail` / `.counts` | read | `model:read` | — / `id` |
| Categories | `categories.list` / `.detail` | read | `model:read` | — / `id` |
| Kits | `kits.list` / `.listPage` / `.getById` / `.getByAssetTag` | read | `kit:read` | — / filters / `id` / `assetTag` |
| Locations | `locations.list` / `.listSimple` / `.detail` | read | `location:read` | — / `id` |

Asset statuses: `AVAILABLE, CHECKED_OUT, IN_MAINTENANCE, RETIRED, LOST,
RESERVED, SOLD`. Conditions: `NEW, GOOD, FAIR, POOR, DAMAGED`.

## Warehouse

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Org snapshot (curated `get_warehouse_status`) | `warehouseList.bundle` | read | `warehouse:read` | — |
| Stage containers (curated `stage_pick_list`) | `warehouseWrites.syncContainersBatch` | M | `warehouse:check_out` | `projectId`, `containerNames[]` |
| Put a unit in a container | `warehouseWrites.ensureContainerOnProject` | M | `warehouse:check_out` | `projectId`, `containerName`, `assetId`, `modelId` |
| Empty a container | `warehouseWrites.clearPrepContainer` | L | `warehouse:check_out` | `projectId`, `containerName` |
| Commit a unit to a line (curated `reserve_items`) | `warehouseWrites.reassignLineItemUnit` | M | `warehouse:check_out` | `projectId`, `unitId`, `targetLineItemId` |
| Un-prep a line (curated `release_items`) | `warehouseWrites.undeprepLine` | **H** | `warehouse:check_out` | `projectId`, `lineItemId` |
| Check out loose lines (curated `dispatch_gear`) | `warehouseWrites.checkOutItems` | **H** | `warehouse:check_out` | `projectId`, `items[{ lineItemId, assetId?, quantity?, notes?, includeAccessoryIds?[] }]`, `includeAccessories`, `auditIds[]` |
| Check out a kit / kits | `warehouseWrites.checkOutKit` / `.checkOutKitsBatch` | **H** | `warehouse:check_out` | `projectId`, `kitId` / `kitIds[]`, `auditIds[]` |
| Add-and-dispatch in one go | `warehouseWrites.quickAddAndCheckOut` | M | `warehouse:check_out` | `projectId`, `modelId`, `assetId?`, `bulkAssetId?`, `quantity?`, `prepContainer?` |
| Check in loose lines (curated `receive_gear`) | `warehouseWrites.checkInItems` | **H** | `warehouse:check_in` | `projectId`, `items[{ lineItemId, assetId?, quantity?, returnCondition: GOOD\|DAMAGED\|MISSING }]`, `auditIds[]` |
| Check in a kit / kits | `warehouseWrites.checkInKit` / `.checkInKitsBatch` | **H** | `warehouse:check_in` | `projectId`, `kitId`, `returnCondition` / `items[]` |
| Reverse a check-out / check-in | `warehouseWrites.undeployItems` / `.unreturnItems` (+ kit variants) | **H** | `warehouse:check_in` / `check_out` | `projectId`, `items[]`, `auditIds[]` |
| Force a stray unit back to stock | `warehouseWrites.forceReturnAsset` / `.bulkForceReturnAssets` | **H** | `warehouse:check_in` | `assetId` / `assetIds[]` |
| Revert a bad agent run | `agentRevert.revertAgentWindow` | **H** | `warehouse:revert_agent_window` + `warehouse:check_in` | `apiKeyId`, `fromMs`, `toMs` — reverses that key's check-outs/check-ins in the window; anything without a mechanical inverse is listed in `skipped`. Operator-only scope, no preset |

`auditIds[]` is accepted for UI parity; send `[]` and the server mints audit
rows from your idempotency key.

## Quotes

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Quotes on a job (with `effectiveStatus`) | `quotes.listForProject` | read | `invoice:read` | `projectId` |
| Live quote / revision state | `quotes.revisionStateForProject` | read | `invoice:read` | `projectId` |
| Send (freeze pricing, render PDF — does NOT email) | `quotesWrites.sendNative` | **H** | `invoice:publish` | `id`, `projectId`, `quoteDate`, `validityDays?`, `notes?`, `recipientContactId?`, `combineServices?`, `labelOnDocument?` |
| Mark accepted (moves job to `AWAITING_PAYMENT`) | `quotesWrites.markAcceptedNative` | **H** | `invoice:publish` | `id`, `acceptedAt?`, `acceptanceRef?` |
| Mark declined | `quotesWrites.markDeclinedNative` | **H** | `invoice:publish` | `id`, `reason` |
| Recall a sent quote | `quotesWrites.recallNative` | **H** | `invoice:publish` | `id`, `reason` |
| Start a new version | `quotesWrites.newVersionNative` | M | `invoice:publish` | `id`, `projectId` |
| Label a quote | `quotesWrites.setQuoteLabelNative` | L | `invoice:publish` | `id`, `label?` |

The sent PDF is retrievable with `get_project_document { docType: "quote" }`.

## Invoices & payments

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Invoices on a job | `invoices.listForProject` | read | `invoice:read` | `projectId` |
| One invoice (with `paymentStatus`) | `invoices.getById` | read | `invoice:read` | `id` |
| Recent across the org | `invoices.listRecentForOrg` | read | `invoice:read` | `limit?` |
| Payments on an invoice | `payments.listForInvoice` | read | `invoice:read` | `invoiceId` |
| Create a draft | `invoicesWrites.createNative` | M | `invoice:create` | `projectId`, `clientId`, `kind` (FULL\|DEPOSIT\|BALANCE\|CREDIT), `dueDate?`, `depositMode?`, `depositPercent?`, `depositAmount?`, `notes?` |
| Issue (number it, freeze, render) | `invoicesWrites.issueNative` | **H** | `invoice:issue` | `id`, `autoNumber{ format, reset, padding, parts{year,month,day} }`, `invoiceDate?`, `dueDate?`, `notes?` |
| Credit note | `invoicesWrites.createCreditNative` | M | `invoice:create` | `creditForInvoiceId`, `notes?` |
| Void | `invoicesWrites.voidNative` | **H** | `invoice:void` | `id`, `reason` — no preset grants void |
| Delete a draft | `invoicesWrites.deleteDraftNative` | **H** | `invoice:delete` | `id` |
| Record a payment | `paymentsWrites.recordNative` | **H** | `invoice:record_payment` | `invoiceId`, `amount`, `method`, `paidAt`, `reference?`, `notes?` |
| Void a payment | `paymentsWrites.voidNative` | **H** | `invoice:void_payment` | `id`, `reason` |

"Paid" is `invoices.paymentStatus`, which already folds in Xero-synced
payments. Do not sum `payments` rows yourself to decide whether a client has
paid.

## Clients & suppliers

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Clients | `clients.list` / `.listPage` / `.getById` / `.detail` / `.projectCounts` | read | `client:read` | — / `search?`, `type?`, `page?`, `pageSize?` / `id` |
| Create a client | `clientWrites.createNative` | M | `client:create` | `name`, `type?`, `contactName?`, `contactEmail?`, `contactPhone?`, `billingAddress?`, `shippingAddress?`, `paymentTerms?`, `defaultDiscount?`, `taxExempt?`, `tags?[]`, `notes?` |
| Edit a client | `clientWrites.updateNative` | M | `client:update` | `id`, `patch{…}` |
| Client notes | `clientWrites.updateNotesNative` | L | `client:update` | `id`, `notes` |
| Archive | `clientWrites.archiveNative` / `.archiveManyNative` | **H** | `client:update` | `id` / `items[]` |
| Contacts on a client | `clientContacts.forClient` | read | `client:read` | `clientId` |
| Add / edit / remove a contact | `clientContactWrites.addNative` / `.updateNative` / `.removeNative` (**H**) | M | `client:update` | `clientId`, `name?`, `email?`, `phone?`, `role?`, `isPrimary?` / + `contactId` |
| Client timeline (calls, emails, notes) | `clientTimeline.forClient` / `.nextStep` | read | `client:read` | `clientId`, `limit?` |
| Log a call / email / note | `clientTimelineWrites.logCallNative` / `.logEmailNative` / `.addNoteNative` | L | `client:update` | `clientId`, `note` |
| Set / complete the next step | `clientTimelineWrites.setNextStepNative` / `.completeNextStepNative` | M | `client:update` | `clientId`, `title`, `dueDate`, `notes?`, `projectId?` / `workItemId`, `outcome` |
| Suppliers | `suppliers.list` / `.listPage` / `.detail` / `.subhiresPage` / `.assetsPage` | read | `supplier:read` | — / filters / `id` / `supplierId`, `page`, `pageSize` |

## Crew

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Members (curated `list_crew`) | `crewMembers.list` / `.listPage` / `.getById` | read | `crew:read` | — / `search?`, `department?`, `status?`, `type?`, `page?` / `id` |
| Assignments on a job | `crewAssignments.listByProject` / `.projectCrew` | read | `crew:read` | `projectId` |
| Who is free for a job | `crewAssignments.membersForAssignment` | read | `crew:read` | `projectId`, `rangeStartMs?`, `rangeEndMs?`, `search?` |
| Clashes for a job | `crewAssignments.conflictsForProject` | read | `crew:read` | `projectId`, `rangeStartMs`, `rangeEndMs` |
| Labour cost (redacted under `noFinancials`) | `crewAssignments.projectLabourCost` | read | `crew:read` | `projectId` |
| Assign (curated `assign_crew`) | `crewAssignmentsWrites.createNative` | M | `crew:create` | `projectId`, `crewMemberId`, `startDate?`, `endDate?`, `startTime?`, `endTime?`, `crewRoleId?`, `phase?`, `status?`, `rateOverride?`, `isProjectManager?` |
| Edit / change status | `crewAssignmentsWrites.updateNative` / `.updateStatusNative` | M | `crew:update` | `id`, … / `id`, `status` |
| Bulk status | `crewAssignmentsWrites.bulkStatusNative` | M | `crew:update` | `ids[]`, `status` |
| Remove | `crewAssignmentsWrites.deleteNative` | **H** | `crew:delete` | `id` |

Assignment statuses: `PENDING, OFFERED, ACCEPTED, DECLINED, CONFIRMED,
CANCELLED, COMPLETED`. Phases: `BUMP_IN, EVENT, BUMP_OUT, DELIVERY, PICKUP,
SETUP, REHEARSAL, FULL_DURATION`.

## Sub-hires (gear rented in)

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| List / by job / one | `subHires.list` / `.listByProject` / `.getById` | read | `subHire:read` | — / `projectId` / `id` |
| Create an order | `subHiresWrites.createSubHireNative` | M | `subHire:create` | `supplierId`, `projectId?`, `hireStart?`, `hireEnd?`, `supplierReference?`, `showOnDocs` |
| Add a line | `subHiresWrites.addSubHireItemNative` | M | `subHire:update` | `subHireId`, `description`, `quantity`, `duration`, `pricingType`, `unitCost`, `unitCharge`, `discount`, `modelId?` |
| Edit order / line / status | `subHiresWrites.updateSubHireNative` / `.updateSubHireItemNative` / `.updateSubHireStatusNative` (**H**) | M | `subHire:update` | describe first |
| Payment status | `subHiresWrites.updateSubHirePaymentStatusNative` | M | `subHire:update` | `id`, `paymentStatus` (UNPAID\|PARTIALLY_PAID\|PAID) |

Sub-hire statuses: `DRAFT, CONFIRMED, ON_HIRE, RETURNED, CANCELLED`.

## Maintenance

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Create (curated `create_maintenance`) | `maintenanceWrites.createNative` | M | `maintenance:create` | `recordId`, `title`, `type`, `assetLinks[]`, `status?`, `description?`, `scheduledDate?`, `assignedToId?`, `projectId?`, `cost?` |
| Update / close out | `maintenanceWrites.updateNative` | M | `maintenance:update` | `id`, `title`, `type`, `assetLinks[]`, `status?`, `result?` (PASS\|FAIL\|CONDITIONAL), `completedDate?`, `assetDispositions?[]` |
| Delete | `maintenanceWrites.deleteNative` | **H** | `maintenance:delete` | `id` |

Statuses: `SCHEDULED, AWAITING_PARTS, IN_PROGRESS, QA, COMPLETED, CANCELLED`.

## Tasks & follow-ups (work layer)

| Job | Operation | Kind | Scope | Args |
|---|---|---|---|---|
| Tasks on a job | `projectTasks.listByProject` / `.listByProjectWithRelations` | read | `work:read` or `project:read` | `projectId` |
| My open tasks (as the acting user) | `projectTasks.myOpenTasks` | read | `work:read` or `project:read` | — |
| Create / edit | `projectTasksWrites.createNative` / `.updateNative` | M | `work:update` or `project:update` | `title`, `projectId?`, `dueDate?`, `assigneeUserId?`, `assigneeCrewId?`, `priority?`, `status?`, `checklist?` |
| Record a follow-up outcome | `projectTasksWrites.recordFollowUpOutcomeNative` | M | `work:update` or `project:update` | `id`, `outcome`, `note?`, `nextDate?` |
| Delete | `projectTasksWrites.deleteNative` | **H** | `work:update` or `project:update` | `id` |

A task with `automation` set belongs to the follow-up engine. Edit it through
the normal update (the server records your change against the automation);
deleting it is a soft close and the engine may recreate it.

## Personal scope (`self:*`)

Saved table views, notification preferences and dismissals for the acting
user — `savedTableViews*`, `userNotificationPreferences*`,
`notificationDismissals*`. Need `self:read` / `self:write`.

## Not reachable, ever

API-key management, OAuth client registry, org export, site settings,
member invites/role changes, raw mirrors and backfills, the request log,
`globalSearch.search`. They are not hidden behind a scope; they do not exist
on this surface. Ask a human to do them in the app.
