// GENERATED FILE — DO NOT EDIT.
// Run `pnpm run api:registry` to regenerate; CI fails if this file is stale.
// Source of truth: convex/*.ts (validators + guards). See scripts/generate-api-registry.mts.

/**
 * Gate 6's ratcheting baseline (#1004, design §13 decision 12): every
 * operation currently in the additive-only "stable" tier, with its arg
 * field names. Regenerating always reflects the CURRENT stable surface —
 * the gate itself (checkStableContractRegression in
 * scripts/generate-api-registry.mts) is what stops a regenerate from ever
 * silently committing a shrinking diff, by refusing to run in the first
 * place. Never hand-edit this file to make a shrinking diff pass.
 */
export const STABLE_CONTRACT: Record<string, { reachable: boolean; fields: readonly string[] }> = {
  "assets.getById": {
    "reachable": true,
    "fields": [
      "id"
    ]
  },
  "assets.list": {
    "reachable": true,
    "fields": [
      "orgId"
    ]
  },
  "availability.calendarData": {
    "reachable": true,
    "fields": [
      "endMs",
      "orgId",
      "startMs"
    ]
  },
  "crewAssignmentsWrites.createNative": {
    "reachable": true,
    "fields": [
      "actor",
      "auditId",
      "crewMemberId",
      "crewRoleId",
      "endDate",
      "endTime",
      "estimatedHours",
      "generateShifts",
      "id",
      "internalNotes",
      "isProjectManager",
      "justification",
      "notes",
      "now",
      "orgId",
      "phase",
      "projectId",
      "rateOverride",
      "rateType",
      "serviceId",
      "startDate",
      "startTime",
      "status"
    ]
  },
  "crewMembers.list": {
    "reachable": true,
    "fields": [
      "orgId"
    ]
  },
  "lineItemWrites.addNative": {
    "reachable": true,
    "fields": [
      "accessoryPlan",
      "actor",
      "allowOverbook",
      "auditId",
      "fields",
      "id",
      "includeAccessories",
      "justification",
      "now",
      "orgDefaultTaxRate",
      "organizationId",
      "projectId"
    ]
  },
  "maintenanceWrites.createNative": {
    "reachable": true,
    "fields": [
      "actor",
      "assetLinks",
      "assignedToId",
      "auditId",
      "completedDate",
      "cost",
      "description",
      "emitSideEffects",
      "nextDueDate",
      "now",
      "orgId",
      "partsUsed",
      "photos",
      "projectId",
      "recordId",
      "reportedById",
      "result",
      "scheduledDate",
      "status",
      "tags",
      "title",
      "type"
    ]
  },
  "overbookingBoard.bundle": {
    "reachable": true,
    "fields": [
      "orgId",
      "rangeEnd",
      "rangeStart"
    ]
  },
  "projectCosts.operationalCosts": {
    "reachable": true,
    "fields": [
      "orgId",
      "projectId"
    ]
  },
  "projectDetail.bundle": {
    "reachable": true,
    "fields": [
      "orgId",
      "projectId"
    ]
  },
  "projectLineItems.swapLineItemAsset": {
    "reachable": true,
    "fields": [
      "actor",
      "auditId",
      "lineItemId",
      "newAssetId",
      "now",
      "organizationId"
    ]
  },
  "projects.listPage": {
    "reachable": true,
    "fields": [
      "orgId",
      "page",
      "pageSize",
      "search",
      "sortBy",
      "sortOrder",
      "statusIn",
      "typeIn"
    ]
  },
  "projectWrites.createNative": {
    "reachable": true,
    "fields": [
      "actor",
      "auditId",
      "autoNumber",
      "billingDaysOverride",
      "billingWeeksOverride",
      "clientContactId",
      "clientId",
      "clientNotes",
      "createdAt",
      "crewNotes",
      "depositPaid",
      "description",
      "discountAmount",
      "discountPercent",
      "equipmentRevenue",
      "eventEndDate",
      "eventEndTime",
      "eventStartDate",
      "eventStartTime",
      "id",
      "internalNotes",
      "invoicedTotal",
      "isTemplate",
      "labourCostTotal",
      "loadInDate",
      "loadInTime",
      "loadOutDate",
      "loadOutTime",
      "locationId",
      "margin",
      "name",
      "organizationId",
      "projectEndDate",
      "projectEndTime",
      "projectManagerId",
      "projectNumber",
      "projectStartDate",
      "projectStartTime",
      "rentalEndDate",
      "rentalStartDate",
      "serviceCostTotal",
      "siteContactEmail",
      "siteContactName",
      "siteContactPhone",
      "status",
      "subHireCostTotal",
      "subtotal",
      "tags",
      "taxAmount",
      "taxRate",
      "total",
      "type",
      "updatedAt"
    ]
  },
  "warehouseList.bundle": {
    "reachable": true,
    "fields": [
      "orgId"
    ]
  },
  "warehouseWrites.checkInItems": {
    "reachable": true,
    "fields": [
      "actor",
      "auditIds",
      "items",
      "now",
      "orgId",
      "projectId"
    ]
  },
  "warehouseWrites.checkOutItems": {
    "reachable": true,
    "fields": [
      "actor",
      "auditIds",
      "includeAccessories",
      "items",
      "now",
      "orgId",
      "projectId"
    ]
  },
  "warehouseWrites.reassignLineItemUnit": {
    "reachable": true,
    "fields": [
      "actor",
      "auditId",
      "now",
      "orgId",
      "projectId",
      "targetLineItemId",
      "unitId"
    ]
  },
  "warehouseWrites.syncContainersBatch": {
    "reachable": true,
    "fields": [
      "actor",
      "containerNames",
      "now",
      "orgId",
      "projectId"
    ]
  },
  "warehouseWrites.undeprepLine": {
    "reachable": true,
    "fields": [
      "actor",
      "auditId",
      "lineItemId",
      "now",
      "orgId",
      "projectId"
    ]
  }
} as const;
