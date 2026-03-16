# Project & Rental Management

## Status Flow
```
ENQUIRY → QUOTING → QUOTED → CONFIRMED → PREPPING → CHECKED_OUT → ON_SITE → RETURNED → COMPLETED → INVOICED
                                                                                        ↗
                                           Any status → CANCELLED ─────────────────────┘
```

## Financial Calculations (`recalculateProjectTotals()`)
- `subtotal` = sum of `lineTotal` for non-optional, non-cancelled items
- `discountAmount` = `subtotal * discountPercent / 100`
- `taxAmount` = `(subtotal - discountAmount) * 0.10` (10% GST hardcoded)
- `total` = `subtotal - discountAmount + taxAmount`
- `invoicedTotal` = manual override (e.g., from Xero)
- Called automatically whenever line items change

## Project Types
`DRY_HIRE, WET_HIRE, INSTALLATION, TOUR, CORPORATE, THEATRE, FESTIVAL, CONFERENCE, OTHER`

## Subhire
Line items with `isSubhire: true` and `supplierId` reference third-party equipment. `showSubhireOnDocs` controls visibility on client-facing PDFs.

## Line Item Types
- **EQUIPMENT**: Links to `modelId`, optionally `assetId`, `bulkAssetId`, or `kitId`
- **SERVICE / LABOUR / TRANSPORT / MISC**: No asset link, just description + pricing
- Service-linked line items are auto-created by `ProjectService` when `showOnDocuments: true`

## Kit & Prep-Kit Line Items
- Kit/prep-kit parent: `kitId` set, `isKitChild: false`
- Children: `isKitChild: true`, `parentLineItemId` pointing to parent
- Nested kits (kit inside prep-kit): child has its own `kitId` and `childLineItems`
- Queries must include 2 levels of `childLineItems` with `kit: true` for nested rendering
- Equipment list (`line-items-panel.tsx`) detects nested kits and renders with Container icon + Kit badge
- See [Kits](./09-kits.md) and [Preps](./32-preps.md)

## Project Services
Structured operational tasks attached to a project (deliveries, pickups, bump in/out, labour, misc).

### Service Types
`DELIVERY, PICKUP, BUMP_IN, BUMP_OUT, LABOUR, MISC`

### Service Status Flow
`PLANNED → CONFIRMED → IN_PROGRESS → COMPLETED` (any → `CANCELLED`)

### Key Behaviour
- Each service has its own date, time, address (for delivery/pickup), crew count, pricing
- `showOnDocuments` toggle: when true, auto-creates/syncs a `ProjectLineItem` (type mapped: DELIVERY/PICKUP→TRANSPORT, BUMP_IN/BUMP_OUT/LABOUR→LABOUR, MISC→SERVICE)
- Toggling `showOnDocuments` off deletes the linked line item and recalculates project totals
- Deleting a service with a linked line item also deletes the line item
- Services appear on the project detail page under a dedicated **Services** tab
- Services are grouped by date in the UI

### Crew Integration
- Each service can optionally have a `crewRoleId` (FK to `CrewRole`) and `crewCountRequired`
- Service dialog includes a crew role picker (ComboboxPicker with `creatable` mode — type to create new roles inline) and searchable crew member multi-select
- When crew members are selected in the service dialog, `CrewAssignment` records are auto-created with `serviceId` set
- Service type maps to assignment phase: DELIVERY→DELIVERY, PICKUP→PICKUP, BUMP_IN→BUMP_IN, BUMP_OUT→BUMP_OUT, LABOUR→EVENT, MISC→FULL_DURATION
- Auto-created assignments use status `CONFIRMED`, inherit service date/times
- On update, crew assignments are reconciled: removed members get their assignment deleted, new members get assignments created
- Deleting a service deletes all linked crew assignments
- Crew assigned via services also appear on the project Crew tab (both tabs share `CrewAssignment` records)
- From the Crew tab's AssignmentDialog, crew can be linked to a service via a "Linked Service" ComboboxPicker
- Service cards show: crew role badge, assigned crew names, shortage warning when assigned < required
- Query invalidation ensures Crew tab and Services tab stay in sync

### Defaults from Project
- New services inherit the project location address/coordinates (editable)
- Date auto-fills based on service type:
  - DELIVERY/BUMP_IN → project `loadInDate` (fallback: `eventStartDate`)
  - PICKUP/BUMP_OUT → project `loadOutDate` (fallback: `eventEndDate`)
  - LABOUR/MISC → project `eventStartDate` (fallback: `loadInDate`)
- `ServicesPanel` receives project date and location props from the project detail page

### Service Templates
- Managed in Settings → Services (`/settings/services`)
- Define default services with type, title, pricing, crew count, vehicle
- `isAutoAdded` flag for templates that should be added to every new project
- Templates appear in the "Add Service" dropdown on the Services tab

### Server Actions
- File: `src/server/project-services.ts`
- CRUD: `createProjectService`, `updateProjectService`, `deleteProjectService`, `getProjectServices`
- Status: `updateServiceStatus`, `bulkUpdateServiceStatus`
- Templates: `createServiceTemplate`, `updateServiceTemplate`, `deleteServiceTemplate`, `getServiceTemplates`
- Financial: `getProjectServicesSummary`
- Uses `requirePermission("project", "update")` for writes

## Pricing Types
- `PER_DAY`: `unitPrice * duration` (duration in days)
- `PER_WEEK`: `unitPrice * duration` (duration in weeks)
- `PER_HOUR`: `unitPrice * duration` (duration in hours)
- `FLAT`: `unitPrice` (no duration multiplier)

## Visual Groups
- `groupName` field on line items for visual grouping
- Groups are drag-and-drop reorderable via `reorderLineItems()`
- `ComboboxPicker` with `creatable` mode lets users type new group names
- New groups tracked in `extraGroups` local state for immediate UI updates

## Duplicate Model Handling
Adding a model that already exists as a line item on the project **merges** into the existing line item (increments quantity) rather than creating a new row.

## Project Templates
- `Project.isTemplate = true`. Templates use the same `Project` table but are completely isolated.
- `generateTemplateCode()` creates `TPL-0001`, `TPL-0002`, etc.
- Templates MUST be excluded from: dashboard stats, notifications, reports, search results, availability calendar, availability checks
- All project list queries: add `isTemplate: false` filter
- `updateProjectStatus()` rejects templates. `getProjectForWarehouse()` throws for templates.
- Template detail page hides: status dropdown, documents button, cancel/archive/delete, financial summary, dates card
- "Use Template" → `duplicateProject(templateId, { isTemplate: false })` → creates real project
- "Save as Template" → `saveAsTemplate(projectId)` → creates template from real project
- Both call `recalculateProjectTotals` AFTER transaction commits (not inside)

## Project Deletion
Only cancelled projects can be deleted (`deleteProject` in `src/server/projects.ts`).

### Cleanup on Delete
1. **Reset checked-out assets**: All `CHECKED_OUT` serialized assets linked to project line items → `AVAILABLE`, restore default location
2. **Reset checked-out kits**: All `CHECKED_OUT` kits + their serialized assets → `AVAILABLE`, restore locations
3. **Delete prep-kits**: All `Kit` records with `isPrep: true` linked to this project are fully deleted (kit contents, bulk items, serialized items)
4. **Cascade**: `Project.delete()` cascades to all `ProjectLineItem`, `ProjectMedia`, etc.

This ensures no orphaned prep-kit records block future asset tag creation, and no assets remain stuck in `CHECKED_OUT` status.
