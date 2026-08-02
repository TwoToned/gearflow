// GENERATED FILE — DO NOT EDIT.
// Run `pnpm run api:mcp` to regenerate; CI fails if this file is stale.
// Source of truth: src/lib/api/registry.generated.ts + src/lib/api/mcp/curated-tool-defs.ts.
// See scripts/generate-mcp-manifest.mts.

export const MCP_NAMESPACE = "rvlt_flow.v1";

export interface McpToolManifestEntry {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly stability: "stable" | "tracks-app";
  readonly operation: string | null;
}

export const MCP_CURATED_TOOLS: readonly McpToolManifestEntry[] = [
  {
    "name": "rvlt_flow.v1.whoami",
    "title": "Whoami",
    "description": "Confirm this key's identity: org, acting user, live effective permissions, granted scopes, and rate/bulk limits. Call this first on a new connection to sanity-check what you can do before attempting anything else.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": null
  },
  {
    "name": "rvlt_flow.v1.search_assets",
    "title": "Search assets",
    "description": "List every asset in the org — serialized gear and bulk stock — with model, status, and current location. There is no server-side search/filter param yet (the underlying query only takes the org id): fetch the list and filter over the results for name/model/tag matches, or narrow by cross-referencing `check_availability`. Scope required: asset:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "assets.list"
  },
  {
    "name": "rvlt_flow.v1.get_asset",
    "title": "Get asset",
    "description": "Full detail for one asset by id: model, serial, status, current project (if deployed), maintenance flags. Scope required: asset:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "assets.getById"
  },
  {
    "name": "rvlt_flow.v1.check_availability",
    "title": "Check availability",
    "description": "Every booking across the org within a date range — cross-reference against `search_assets` to see what's free for a given window (e.g. \"what's free next Tuesday for a 3-day shoot\"). Prerequisites: A date range as epoch milliseconds (`startMs`, `endMs`). Scope required: project:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "endMs": {
          "type": "number"
        },
        "startMs": {
          "type": "number"
        }
      },
      "required": [
        "endMs",
        "startMs"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "availability.calendarData"
  },
  {
    "name": "rvlt_flow.v1.list_projects",
    "title": "List projects",
    "description": "Paginated, searchable list of projects (jobs) — filter by status/type or free-text search, sorted. Scope required: project:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "page": {
          "type": "number"
        },
        "pageSize": {
          "type": "number"
        },
        "search": {
          "type": "string"
        },
        "sortBy": {
          "type": "string"
        },
        "sortOrder": {},
        "statusIn": {
          "type": "array"
        },
        "typeIn": {
          "type": "array"
        }
      },
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "projects.listPage"
  },
  {
    "name": "rvlt_flow.v1.get_project",
    "title": "Get project",
    "description": "Full detail for one project: dates, client, status, and line items — everything the project detail page shows. Scope required: project:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        }
      },
      "required": [
        "projectId"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "projectDetail.bundle"
  },
  {
    "name": "rvlt_flow.v1.create_project",
    "title": "Create project",
    "description": "Create a new project (job). Only `name` is required; dates, client, and gear can follow with `add_line_items` and, for anything not covered by a curated tool, `call_operation`. Transition: (none) → a new project in its default status.. Scope required: project:create. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "autoNumber": {
          "type": "object"
        },
        "billingDaysOverride": {
          "type": "number"
        },
        "billingWeeksOverride": {
          "type": "number"
        },
        "clientContactId": {
          "type": "string"
        },
        "clientId": {
          "type": "string"
        },
        "clientNotes": {
          "type": "string"
        },
        "createdAt": {
          "type": "number"
        },
        "crewNotes": {
          "type": "string"
        },
        "depositPaid": {
          "type": "number"
        },
        "description": {
          "type": "string"
        },
        "discountAmount": {
          "type": "number"
        },
        "discountPercent": {
          "type": "number"
        },
        "equipmentRevenue": {
          "type": "number"
        },
        "eventEndDate": {
          "type": "number"
        },
        "eventEndTime": {
          "type": "string"
        },
        "eventStartDate": {
          "type": "number"
        },
        "eventStartTime": {
          "type": "string"
        },
        "internalNotes": {
          "type": "string"
        },
        "invoicedTotal": {
          "type": "number"
        },
        "isTemplate": {
          "type": "boolean"
        },
        "labourCostTotal": {
          "type": "number"
        },
        "loadInDate": {
          "type": "number"
        },
        "loadInTime": {
          "type": "string"
        },
        "loadOutDate": {
          "type": "number"
        },
        "loadOutTime": {
          "type": "string"
        },
        "locationId": {
          "type": "string"
        },
        "margin": {
          "type": "number"
        },
        "name": {
          "type": "string"
        },
        "projectEndDate": {
          "type": "number"
        },
        "projectEndTime": {
          "type": "string"
        },
        "projectManagerId": {
          "type": "string"
        },
        "projectNumber": {
          "type": "string"
        },
        "projectStartDate": {
          "type": "number"
        },
        "projectStartTime": {
          "type": "string"
        },
        "rentalEndDate": {
          "type": "number"
        },
        "rentalStartDate": {
          "type": "number"
        },
        "serviceCostTotal": {
          "type": "number"
        },
        "siteContactEmail": {
          "type": "string"
        },
        "siteContactName": {
          "type": "string"
        },
        "siteContactPhone": {
          "type": "string"
        },
        "status": {},
        "subHireCostTotal": {
          "type": "number"
        },
        "subtotal": {
          "type": "number"
        },
        "tags": {
          "type": "array"
        },
        "taxAmount": {
          "type": "number"
        },
        "taxRate": {
          "type": "number"
        },
        "total": {
          "type": "number"
        },
        "type": {},
        "updatedAt": {
          "type": "number"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "name",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "projectWrites.createNative"
  },
  {
    "name": "rvlt_flow.v1.add_line_items",
    "title": "Add line items",
    "description": "Add one gear line item (model/asset + quantity + date range) to a project — the fundamental \"put this gear on this job\" action. The in-mutation availability check runs on every add: an overbooking attempt fails with `INVENTORY_CONFLICT` (with `conflicts[]` and `suggestions[]`) rather than silently double-booking. Prerequisites: An existing project (`create_project` or `list_projects`/`get_project`). Scope required: project:manage_line_items or asset:update. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "accessoryPlan": {
          "type": "object"
        },
        "allowOverbook": {
          "type": "boolean"
        },
        "fields": {
          "type": "object"
        },
        "includeAccessories": {
          "type": "boolean"
        },
        "justification": {
          "type": "string"
        },
        "orgDefaultTaxRate": {},
        "projectId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "allowOverbook",
        "fields",
        "includeAccessories",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "lineItemWrites.addNative"
  },
  {
    "name": "rvlt_flow.v1.reserve_items",
    "title": "Reserve items",
    "description": "Commit a specific serialized unit to a project's line item ahead of dispatch — turns a model+quantity booking into a named-serial reservation. Requires the `warehouse:check_out` scope (it's a warehouse-staging action). Prerequisites: A line item already on the project (`add_line_items`) and a specific unit id (`search_assets`/`get_asset`). Transition: line item on a model/quantity basis → line item bound to one serialized unit.. Scope required: warehouse:check_out. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "targetLineItemId": {
          "type": "string"
        },
        "unitId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "projectId",
        "targetLineItemId",
        "unitId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseWrites.reassignLineItemUnit"
  },
  {
    "name": "rvlt_flow.v1.release_items",
    "title": "Release items",
    "description": "Release a line item's staged/reserved units back to the available pool without a full dispatch+return cycle — the inverse of `reserve_items` / `stage_pick_list`. Transition: staged/reserved → available.. Scope required: warehouse:check_out. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "lineItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        },
        "confirm": {
          "type": "boolean",
          "description": "Required (must be `true`) to actually run this call — it is classified HIGH danger. Omit it first: the call fails with `CONFIRMATION_REQUIRED` and a human-legible summary of what it would do; show that to a human, then re-send the identical call with `confirm: true`."
        }
      },
      "required": [
        "lineItemId",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseWrites.undeprepLine"
  },
  {
    "name": "rvlt_flow.v1.swap_asset",
    "title": "Swap asset",
    "description": "Replace the specific asset committed to a line item with a different one (e.g. a serviceable unit instead of one that failed inspection). Use `call_operation` on `reservationConflicts.swapCandidates` first to find valid substitutes. Scope required: project:manage_line_items. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "lineItemId": {
          "type": "string"
        },
        "newAssetId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "lineItemId",
        "newAssetId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "projectLineItems.swapLineItemAsset"
  },
  {
    "name": "rvlt_flow.v1.stage_pick_list",
    "title": "Stage pick list",
    "description": "Build/update the warehouse pick list (prep containers) for a project ahead of dispatch — the staging step between booking and physically pulling gear. Prerequisites: Line items already on the project. Scope required: warehouse:check_out. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "containerNames": {
          "type": "array"
        },
        "projectId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "containerNames",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseWrites.syncContainersBatch"
  },
  {
    "name": "rvlt_flow.v1.dispatch_gear",
    "title": "Dispatch gear",
    "description": "Physically check gear out of the warehouse onto a project — gear leaves the building. Requires the `warehouse:check_out` scope, granted to no default preset (decision 10) — a deliberate operator grant. Transition: in warehouse → checked out / on-site.. Scope required: warehouse:check_out. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "auditIds": {
          "type": "array"
        },
        "includeAccessories": {
          "type": "boolean"
        },
        "items": {
          "type": "array"
        },
        "projectId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        },
        "confirm": {
          "type": "boolean",
          "description": "Required (must be `true`) to actually run this call — it is classified HIGH danger. Omit it first: the call fails with `CONFIRMATION_REQUIRED` and a human-legible summary of what it would do; show that to a human, then re-send the identical call with `confirm: true`."
        }
      },
      "required": [
        "auditIds",
        "includeAccessories",
        "items",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseWrites.checkOutItems"
  },
  {
    "name": "rvlt_flow.v1.receive_gear",
    "title": "Receive gear",
    "description": "Physically check gear back into the warehouse from a project. Requires the `warehouse:check_in` scope. Transition: checked out / on-site → back in warehouse.. Scope required: warehouse:check_in. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "auditIds": {
          "type": "array"
        },
        "items": {
          "type": "array"
        },
        "projectId": {
          "type": "string"
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        },
        "confirm": {
          "type": "boolean",
          "description": "Required (must be `true`) to actually run this call — it is classified HIGH danger. Omit it first: the call fails with `CONFIRMATION_REQUIRED` and a human-legible summary of what it would do; show that to a human, then re-send the identical call with `confirm: true`."
        }
      },
      "required": [
        "auditIds",
        "items",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseWrites.checkInItems"
  },
  {
    "name": "rvlt_flow.v1.list_crew",
    "title": "List crew",
    "description": "Every crew member in the org — name, role, contact, active status. Scope required: crew:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "crewMembers.list"
  },
  {
    "name": "rvlt_flow.v1.assign_crew",
    "title": "Assign crew",
    "description": "Assign a crew member to a project for a date/time window, optionally with a role, phase, and rate override. Prerequisites: An existing project and crew member (`list_projects`, `list_crew`). Scope required: crew:create. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "crewMemberId": {
          "type": "string"
        },
        "crewRoleId": {
          "type": "string"
        },
        "endDate": {
          "type": "number"
        },
        "endTime": {
          "type": "string"
        },
        "estimatedHours": {
          "type": "number"
        },
        "generateShifts": {
          "type": "boolean"
        },
        "internalNotes": {
          "type": "string"
        },
        "isProjectManager": {
          "type": "boolean"
        },
        "justification": {
          "type": "string"
        },
        "notes": {
          "type": "string"
        },
        "phase": {},
        "projectId": {
          "type": "string"
        },
        "rateOverride": {
          "type": "number"
        },
        "rateType": {},
        "serviceId": {
          "type": "string"
        },
        "startDate": {
          "type": "number"
        },
        "startTime": {
          "type": "string"
        },
        "status": {},
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "crewMemberId",
        "projectId",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "crewAssignmentsWrites.createNative"
  },
  {
    "name": "rvlt_flow.v1.get_warehouse_status",
    "title": "Get warehouse status",
    "description": "Org-wide warehouse snapshot: what's currently checked out, due back, and overdue. Scope required: warehouse:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "warehouseList.bundle"
  },
  {
    "name": "rvlt_flow.v1.create_maintenance",
    "title": "Create maintenance record",
    "description": "Log a maintenance record against one or more assets — repair, inspection, or scheduled service. Prerequisites: A unique `recordId` minted by the caller (a short human-readable identifier, e.g. \"MAINT-2026-0142\") — there's no server-side sequence for this yet. Scope required: maintenance:create. Idempotent: pass `idempotencyKey` (>=8 chars) — a retry with the same key replays the first result instead of double-writing. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "assetLinks": {
          "type": "array"
        },
        "assignedToId": {
          "type": "string"
        },
        "completedDate": {
          "type": "number"
        },
        "cost": {
          "type": "number"
        },
        "description": {
          "type": "string"
        },
        "emitSideEffects": {
          "type": "boolean"
        },
        "nextDueDate": {
          "type": "number"
        },
        "partsUsed": {
          "type": "string"
        },
        "photos": {
          "type": "array"
        },
        "projectId": {
          "type": "string"
        },
        "recordId": {
          "type": "string"
        },
        "reportedById": {
          "type": "string"
        },
        "result": {},
        "scheduledDate": {
          "type": "number"
        },
        "status": {},
        "tags": {
          "type": "array"
        },
        "title": {
          "type": "string"
        },
        "type": {},
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "assetLinks",
        "recordId",
        "title",
        "type",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "maintenanceWrites.createNative"
  },
  {
    "name": "rvlt_flow.v1.list_overbookings",
    "title": "List overbookings",
    "description": "Every overbooking conflict across the org within a date range — the same data the Overbooking Board shows. Scope required: project:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "rangeEnd": {
          "type": "number"
        },
        "rangeStart": {
          "type": "number"
        }
      },
      "required": [
        "rangeEnd",
        "rangeStart"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "overbookingBoard.bundle"
  },
  {
    "name": "rvlt_flow.v1.get_project_financials",
    "title": "Get project financials",
    "description": "Cost/margin breakdown for one project. A key created with the `no_financials` flag set (/settings/api-keys) force-redacts this regardless of the acting user's role — otherwise visibility follows their role like everywhere else. Scope required: project:read. Read-only; no idempotencyKey needed. Errors surface in-band as `{ error: { code, category, message, recovery, requiredScope } }` — call `describe_operation` (or `GET /api/v1/operations/{operation}`) for the full code list.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        }
      },
      "required": [
        "projectId"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": "projectCosts.operationalCosts"
  },
  {
    "name": "rvlt_flow.v1.get_project_document",
    "title": "Get project document",
    "description": "Fetch one of a project's PDF documents. Returns a short-lived download URL (no further auth needed) plus `fileName`/`contentType`/`docType`/`status` — fetch the `url` to get the actual PDF bytes. `docType` is one of: \"delivery-docket\", \"packing-list\" (the pick slip / pull slip), \"return-sheet\" — always freshly rendered from TODAY's project state; \"quote\", \"invoice\" — the frozen document if one has been sent/issued (never re-rendered), otherwise \"quote\" falls back to a watermarked DRAFT PREVIEW live render (\"invoice\" has no draft form and reports not-found instead). Requires `project:read` for the first three, `invoice:read` for quote/invoice — both already in the read_only_agent preset, so this works out of the box for a read-only key.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "docType": {
          "type": "string",
          "enum": [
            "quote",
            "invoice",
            "packing-list",
            "return-sheet",
            "delivery-docket"
          ]
        }
      },
      "required": [
        "projectId",
        "docType"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": null
  }
] as const;

export const MCP_DISCOVERY_TOOLS: readonly McpToolManifestEntry[] = [
  {
    "name": "rvlt_flow.v1.list_operations",
    "title": "List operations",
    "description": "Paginate every operation this key can call, beyond the curated tools above — the full agent-reachable surface. Filter by `resource` and/or `kind` (\"query\"|\"mutation\"). Mirrors `GET /api/v1/operations`.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "resource": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "query",
            "mutation"
          ]
        },
        "cursor": {
          "type": "number"
        },
        "limit": {
          "type": "number"
        }
      },
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": null
  },
  {
    "name": "rvlt_flow.v1.describe_operation",
    "title": "Describe operation",
    "description": "One operation's argument schema, required scope, idempotency requirement, and possible error codes. Call this before `call_operation` for anything not covered by a curated tool.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "description": "e.g. \"assets.list\""
        }
      },
      "required": [
        "operation"
      ],
      "additionalProperties": false
    },
    "stability": "stable",
    "operation": null
  },
  {
    "name": "rvlt_flow.v1.call_operation",
    "title": "Call operation",
    "description": "Generic dispatch to any agent-reachable operation by name — the full agent-reachable surface, not just the curated tools. `stability: \"tracks-app\"`: this surface follows the app's internals directly, so its shape can change between ordinary refactors — the curated tools above are the stable, additive-only contract. Mutations always require `idempotencyKey`; `confirm` is reserved for the Phase 4 (#1000) `danger`-tier enforcement and is accepted today but not yet required by any operation.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "description": "e.g. \"lineItemWrites.addNative\" — see list_operations/describe_operation."
        },
        "args": {
          "type": "object",
          "description": "The operation's own arguments. Server-injected fields (actor/id/orgId/…) are stripped automatically."
        },
        "confirm": {
          "type": "boolean",
          "description": "Reserved for Phase 4 danger-tier enforcement."
        },
        "idempotencyKey": {
          "type": "string",
          "minLength": 8,
          "maxLength": 200,
          "description": "Required for writes. A retry with the same key replays the first result instead of double-writing."
        }
      },
      "required": [
        "operation"
      ],
      "additionalProperties": false
    },
    "stability": "tracks-app",
    "operation": null
  }
] as const;

export const MCP_TOOLS: readonly McpToolManifestEntry[] = [...MCP_CURATED_TOOLS, ...MCP_DISCOVERY_TOOLS];

export const MCP_TOOLS_BY_NAME: ReadonlyMap<string, McpToolManifestEntry> = new Map(MCP_TOOLS.map((t) => [t.name, t]));
