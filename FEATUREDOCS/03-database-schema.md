# Database Schema & Data Models

## Core Auth Models
- **User** — `id, name, email, emailVerified, image, role ("user"|"admin"), banned, banReason, twoFactorEnabled`
- **Session** — `id, token, expiresAt, userId, activeOrganizationId, ipAddress, userAgent`
- **Account** — OAuth/credential provider accounts
- **Verification** — Email verification tokens
- **TwoFactor** / **BackupCode** — TOTP 2FA storage
- **Passkey** — `credentialID (unique), publicKey, counter, deviceType, backedUp, transports, name`

## Organization & Membership
- **Organization** — `id, name, slug (unique), logo, metadata (JSON)`. Metadata stores: `assetTagPrefix, assetTagDigits, assetTagCounter`, `testTag.*` settings, branding config
- **Member** — `id, organizationId, userId, role (owner|admin|manager|member|staff|warehouse|viewer), createdAt`
- **Invitation** — `id, organizationId, email, role, status (pending|accepted|rejected|cancelled), expiresAt, inviterId`
- **CustomRole** — `id, organizationId, name, description, color, permissions (JSON), ssoGroupClaim (optional)`. Unique: `[organizationId, name]`
- **SiteSettings** — Singleton: `platformName, platformIcon, platformLogo, registrationPolicy, twoFactorGlobalPolicy, defaultCurrency, defaultTaxRate`

## SSO Models
- **SSOProvider** — `id, providerId (unique), issuer, domain, domainVerified, oidcConfig (JSON), samlConfig (JSON), organizationId, userId, createdAt, updatedAt`. Managed by Better Auth SSO plugin; mapped in Prisma as read-only model for type-safe queries
- **PendingSSOApproval** — `id, organizationId, userId, email, name, idpGroups (JSON), suggestedRole, providerId, status (PENDING|APPROVED|REJECTED), reviewedById, reviewedAt, reviewNote, createdAt`. Unique: `[organizationId, userId]`

## Asset Models
- **Category** — `id, organizationId, name, parentId (self-join), description, icon, sortOrder`
- **Model** — `id, organizationId, name, manufacturer, modelNumber, categoryId, description, image, images[], specifications (JSON), customFields (JSON), defaultRentalPrice, defaultPurchasePrice, replacementCost, weight, powerDraw, requiresTestAndTag, testAndTagIntervalDays, defaultEquipmentClass, defaultApplianceType, maintenanceIntervalDays, assetType (SERIALIZED|BULK), isActive`
- **Asset** — `id, organizationId, modelId, assetTag, serialNumber, customName, status (AVAILABLE|CHECKED_OUT|IN_MAINTENANCE|RETIRED|LOST|RESERVED), condition (NEW|GOOD|FAIR|POOR|DAMAGED), purchaseDate, purchasePrice, supplierId, purchaseOrderNumber, supplierOrderId, warrantyExpiry, notes, locationId, customFieldValues (JSON), kitId, isActive`. Unique: `[organizationId, assetTag]`
- **BulkAsset** — `id, organizationId, modelId, assetTag, totalQuantity, availableQuantity, purchasePricePerUnit, locationId, status (ACTIVE|LOW_STOCK|OUT_OF_STOCK|RETIRED), reorderThreshold, isActive`. Unique: `[organizationId, assetTag]`

## Kit Models
- **Kit** — `id, organizationId, assetTag, name, description, categoryId, status (AVAILABLE|CHECKED_OUT|IN_MAINTENANCE|RETIRED|INCOMPLETE), condition, locationId, weight, caseType, caseDimensions, image, images[], notes, isActive`. Unique: `[organizationId, assetTag]`
- **KitSerializedItem** — `id, organizationId, kitId, assetId (unique per org), position, sortOrder, addedAt, addedById, notes`. Unique: `[kitId, assetId]`
- **KitBulkItem** — `id, organizationId, kitId, bulkAssetId, quantity, position, sortOrder, addedAt, addedById, notes`

## Client & Location Models
- **Client** — `id, organizationId, name, type (COMPANY|INDIVIDUAL|VENUE|PRODUCTION_COMPANY), contactName, contactEmail, contactPhone, billingAddress, billingLatitude, billingLongitude, shippingAddress, shippingLatitude, shippingLongitude, taxId, paymentTerms, defaultDiscount, notes, tags[], isActive`
- **Location** — `id, organizationId, name, address, latitude, longitude, type (WAREHOUSE|VENUE|VEHICLE|OFFSITE), isDefault, parentId (self-join), notes`
- **Supplier** — `id, organizationId, name, contactName, email, phone, website, address, latitude, longitude, notes, accountNumber, paymentTerms, defaultLeadTime, tags[], isActive`. Unique: `[organizationId, name]`

## Supplier Order Models
- **SupplierOrder** — `id, organizationId, supplierId, orderNumber, type (PURCHASE|SUBHIRE|REPAIR|OTHER), status (DRAFT|SUBMITTED|CONFIRMED|PARTIAL|RECEIVED|CANCELLED), orderDate, expectedDate, receivedDate, subtotal, taxAmount, total (Decimal), projectId, createdById, notes`. Unique: `[organizationId, orderNumber]`
- **SupplierOrderItem** — `id, orderId, description, quantity, unitPrice, lineTotal, modelId, assetId, notes, sortOrder`

## Project & Line Item Models
- **Project** — `id, organizationId, projectNumber, name, clientId, status (ENQUIRY|QUOTING|QUOTED|CONFIRMED|PREPPING|CHECKED_OUT|ON_SITE|RETURNED|COMPLETED|INVOICED|CANCELLED), type (DRY_HIRE|WET_HIRE|INSTALLATION|TOUR|CORPORATE|THEATRE|FESTIVAL|CONFERENCE|OTHER), description, locationId, siteContactName/Phone/Email, loadInDate/Time, eventStartDate/Time, eventEndDate/Time, loadOutDate/Time, rentalStartDate, rentalEndDate, projectManagerId, crewNotes, internalNotes, clientNotes, subtotal, discountPercent, discountAmount, taxAmount, total, depositPercent, depositPaid, invoicedTotal, tags[], isTemplate`. Unique: `[organizationId, projectNumber]`
- **ProjectLineItem** — `id, organizationId, projectId, type (EQUIPMENT|SERVICE|LABOUR|TRANSPORT|MISC), modelId, assetId, bulkAssetId, kitId, isKitChild, parentLineItemId, pricingMode (KIT_PRICE|ITEMIZED), description, quantity, unitPrice, pricingType (PER_DAY|PER_WEEK|FLAT|PER_HOUR), duration, discount, lineTotal, sortOrder, groupName, notes, isOptional, status, checkedOutQuantity, returnedQuantity, assignedQuantity, packedQuantity, damagedQuantity, lostQuantity, checkedOutAt/ById, returnedAt/ById, returnCondition, returnNotes, isSubhire, showSubhireOnDocs, supplierId, subhireOrderNumber, supplierOrderId`
- **ProjectLineItemUnit** — one physical unit assigned to a `ProjectLineItem` order line. `id, organizationId, lineItemId, ordinal, assetId, bulkAssetId, quantity, returnedQuantity, status, prepStatus, prepContainer, checkedOutAt/ById, returnedAt/ById, returnCondition, returnStatus, returnNotes`. Serialised assets get one row each (`quantity` 1); bulk assets get one row carrying a `quantity`. Replaces the legacy "split a qty-N line into N qty-1 rows" mechanism. Unique: `[lineItemId, assetId]`, `[lineItemId, ordinal]`. The `assignedQuantity`/`packedQuantity`/`checkedOutQuantity`/`returnedQuantity`/`damagedQuantity`/`lostQuantity` counters on `ProjectLineItem` are rollups of its unit rows. `CheckRecord` and `DamageEvent` carry a `lineItemUnitId` FK. See [`docs/designs/line-item-fulfillment-model.md`](../docs/designs/line-item-fulfillment-model.md). *(Phase 1 — table added; checkout/checkin not yet wired to it.)*

## Maintenance Models
- **MaintenanceRecord** — `id, organizationId, kitId, type (REPAIR|PREVENTATIVE|TEST_AND_TAG|INSPECTION|CLEANING|FIRMWARE_UPDATE), status (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED), title, description, reportedById, assignedToId, scheduledDate, completedDate, cost, partsUsed, result (PASS|FAIL|CONDITIONAL), nextDueDate`
- **MaintenanceRecordAsset** — `id, maintenanceRecordId, assetId`. Unique: `[maintenanceRecordId, assetId]`

## Test & Tag Models
- **TestTagAsset** — `id, organizationId, testTagId, description, equipmentClass (CLASS_I|CLASS_II|CLASS_II_DOUBLE_INSULATED|LEAD_CORD_ASSEMBLY), applianceType, make, modelName, serialNumber, location, testIntervalMonths, status (NOT_YET_TESTED|CURRENT|DUE_SOON|OVERDUE|FAILED|RETIRED), lastTestDate, nextDueDate, notes, assetId (unique optional), bulkAssetId, isActive`. Unique: `[organizationId, testTagId]`
- **TestTagRecord** — `id, organizationId, testTagAssetId, testDate, testedById, testerName, result (PASS|FAIL|NOT_APPLICABLE)`, plus 20+ detailed inspection/test fields

## Media & Files
- **FileUpload** — `id, organizationId, fileName, fileSize, mimeType, storageKey, url, thumbnailUrl, width, height, uploadedById`
- **ModelMedia, AssetMedia, KitMedia, ProjectMedia, ClientMedia, LocationMedia** — Join tables: `{entityType}Id, fileId, type, isPrimary, displayName, sortOrder`

## Crew Models
- **CrewMember** — `id, organizationId, firstName, lastName, email?, phone?, image?, userId?, type (EMPLOYEE|FREELANCER|CONTRACTOR|VOLUNTEER), status (ACTIVE|INACTIVE|ON_LEAVE|ARCHIVED), department?, crewRoleId?, defaultDayRate?, defaultHourlyRate?, overtimeMultiplier?, currency?, address?, addressLatitude?, addressLongitude?, emergencyContactName?, emergencyContactPhone?, dateOfBirth?, abnOrGst?, notes?, tags[], isActive`. Unique: `[organizationId, email]`
- **CrewRole** — `id, organizationId, name, description?, department?, color?, defaultRate?, rateType (HOURLY|DAILY|FLAT)?, sortOrder, isActive`. Unique: `[organizationId, name]`
- **CrewSkill** — `id, organizationId, name, category?`. Many-to-many with CrewMember. Unique: `[organizationId, name]`
- **CrewCertification** — `id, crewMemberId, name, issuedBy?, certificateNumber?, issuedDate?, expiryDate?, status (CURRENT|EXPIRING_SOON|EXPIRED|NOT_VERIFIED)`
- **CrewAssignment** — `id, organizationId, projectId, crewMemberId, crewRoleId?, serviceId? (FK→ProjectService), status (PENDING|OFFERED|ACCEPTED|DECLINED|CONFIRMED|CANCELLED|COMPLETED), phase (BUMP_IN|EVENT|BUMP_OUT|DELIVERY|PICKUP|SETUP|REHEARSAL|FULL_DURATION)?, isProjectManager, startDate?, startTime?, endDate?, endTime?, rateOverride?, rateType?, estimatedHours?, estimatedCost?, notes?, internalNotes?, confirmedAt?, confirmedById?`. Unique: `[projectId, crewMemberId, phase]`
- **CrewShift** — `id, assignmentId, date, callTime?, endTime?, breakMinutes?, location?, notes?, status (SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED|NO_SHOW)`

## Project Service Models
- **ProjectService** — `id, organizationId, projectId, type (DELIVERY|PICKUP|BUMP_IN|BUMP_OUT|LABOUR|MISC), title, description, notes, date, startTime, endTime, estimatedDuration, address, latitude, longitude, status (PLANNED|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED), showOnDocuments, unitPrice, quantity, pricingType, duration, discount, lineTotal, taxable, lineItemId (unique), vehicleDescription, numberOfTrips, crewCountRequired, crewRoleId (FK→CrewRole), sortOrder`. Has `crewAssignments CrewAssignment[]` relation via `serviceId`.
- **ServiceTemplate** — `id, organizationId, type (ServiceType), title, description, defaultCrewCount, defaultVehicle, defaultPricingType, defaultUnitPrice, showOnDocuments, isAutoAdded, sortOrder, isActive`

## Prep Models
- **Prep** — `id, organizationId, projectId, name, containerAssetId? (unique), status (PACKING|PACKED|CHECKED_OUT|RETURNED|UNPACKED|CANCELLED), notes?, preparedById?, preparedAt?, checkedOutAt?, returnedAt?, unpackedAt?`. Container links to Asset via `"PrepContainer"` relation.
- **PrepItem** — `id, prepId, assetId?, bulkAssetId?, kitId?, quantity, lineItemId?, addedAt, addedById?, sortOrder`. Unique: `[prepId, assetId]`. Links prep contents to assets, kits, and project line items.

## Document Templates
- **DocumentTemplate** — `id, organizationId, name, type (quote|invoice|packing-list|return-sheet|delivery-docket|call-sheet), basePdf (Text/JSON), schemas (Text/JSON), settings (Text/JSON, nullable), isDefault, isDraft, version, thumbnailUrl?, publishedAt?, createdAt, updatedAt`. Index: `[organizationId, type]`. Cascade delete with Organization.

## Activity & Scan Logs
- **ActivityLog** — `id, organizationId, action, entityType, entityId, entityName, userId, userName, summary, details (JSON), metadata (JSON), projectId, assetId, kitId, createdAt`
- **AssetScanLog** — `id, organizationId, assetId, bulkAssetId, kitId, projectId, action (CHECK_OUT|CHECK_IN|SCAN_VERIFY|TRANSFER), scannedById, scannedAt, notes, location`
