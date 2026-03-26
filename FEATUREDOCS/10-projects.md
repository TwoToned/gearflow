# Project & Rental Management

## Status Flow
```
ENQUIRY → QUOTING → QUOTED → CONFIRMED → PREPPING → CHECKED_OUT → ON_SITE → RETURNED → COMPLETED → INVOICED
                                                                                        ↗
                                           Any status → CANCELLED ─────────────────────┘
```

## Project Hierarchy
```
Project
  → ProjectCategory (top-level organiser: "RF", "IEM", "PA")
      → ProjectGroup (billable unit: title, description, qty, price)
          → ProjectLineItem (equipment tracking only, not on quote)
      → ProjectLineItem (standalone, appears as its own line item)
  → ProjectLineItem (uncategorized)
  → ProjectService (direct cost roll-up)
  → CrewAssignment (direct cost roll-up)
  → ProjectManager (multi-PM via join table)
```

## Project Managers
- Multi-PM support via `ProjectManager` join table (replaces old single `projectManagerId`)
- Managed on the project detail page sidebar via `ProjectManagersPanel`
- Add/remove PMs via `addProjectManager()` / `removeProjectManager()` in `src/server/project-managers.ts`
- PMs shown as avatar row in project header

## Financial Calculations (`recalculateProjectTotals()`)
```
equipmentRevenue = SUM(group.price × group.quantity) + SUM(standalone.lineTotal)
serviceCostTotal = SUM(service.costTotal) where billableToClient = false
labourCostTotal = SUM(assignment.estimatedCost)

subtotal = equipmentRevenue
discountAmount = subtotal × discountPercent / 100
taxRate = project.taxRate ?? org.defaultTaxRate ?? 10
taxableAmount = subtotal - discountAmount
taxAmount = taxableAmount × taxRate / 100
total = taxableAmount + taxAmount

margin = total - (serviceCostTotal + labourCostTotal)
marginPercent = margin / total × 100
```

### Tax Rate Cascade
- Per-project `taxRate` (Decimal, nullable) takes priority
- Falls back to `Organization.defaultTaxRate` (configurable in Settings)
- Falls back to 10% (GST default)

### Rental Period Pricing
- `Project.defaultRentalPeriod` (DAILY | WEEKLY) + `defaultRentalQuantity` (Int)
- Per-group override: `ProjectGroup.rentalPeriod` + `rentalQuantity`
- Line item rates come from `Model.dailyRate` or `Model.weeklyRate` based on rental period
- Formula: `rate × quantity × rentalQuantity`

## Categories (`ProjectCategory`)
- Top-level organiser for equipment (e.g. "RF", "IEM", "PA")
- Sort order via `sortOrder` field, drag-and-drop reorderable
- Deleting a category cascades: groups deleted, all line items become uncategorized
- Server actions: `src/server/project-categories.ts`

## Groups (`ProjectGroup`) — The Billable Unit
- Groups are the billable units on quotes/invoices
- Fields: `title`, `description` (free-text for quote), `quantity`, `price`
- `suggestedPrice` auto-calculated from tracked assets' rates inside the group
- User can override `price` or accept the suggestion with one click
- Assets inside a group are for **tracking only** — never shown on quotes
- Groups only exist within a project, not as standalone library items

### Group Templates
- Save a group configuration as a reusable template (`GroupTemplate` + `GroupTemplateItem`)
- Apply a template when creating a new group (pre-fills line items from template)
- Template picker integrated in the inline "Add Group" form
- Server actions: `src/server/group-templates.ts`

### Suggested Price Calculation (`calculateSuggestedPrice()`)
```
For each line item in group (excluding kit children):
  rate = (rentalPeriod === "WEEKLY") ? model.weeklyRate : model.dailyRate
  total += rate × item.quantity × rentalQuantity
```
- Recalculated when: items added/removed, rental period changed, item moved between groups
- "Accept all suggestions" batch action per category

## Line Items (`ProjectLineItem`)
- `categoryId` (nullable FK → ProjectCategory)
- `groupId` (nullable FK → ProjectGroup)
- Items in a group are for equipment tracking only
- Standalone items (no groupId) appear as their own line items on quotes

### Line Item Types
- **EQUIPMENT**: Links to `modelId`, optionally `assetId`, `bulkAssetId`, or `kitId`
- **SERVICE / LABOUR / TRANSPORT / MISC**: No asset link, just description + pricing

## Project Detail Page Layout
```
HEADER (full width):
  [Status●] Project Name — Client          [Warehouse] [Docs▾] [Edit] [⋯]
  PMs: [Avatar][Avatar]  |  Type: Wet Hire  |  Rental: 3 days daily

┌─── LEFT (~63%) ──────────────────────┐ ┌─── RIGHT (~37%, 340px sticky) ───┐
│                                       │ │                                   │
│  TABS: [Equipment] [Labour &          │ │  ── FINANCIALS ──                 │
│   Logistics] [Notes] [Files]          │ │  Equipment revenue, costs,        │
│                                       │ │  discount, tax, total, margin bar │
│  (tab content below)                  │ │  Pricing progress: "3/8 groups"   │
│                                       │ │  ▸ Breakdown (expandable)         │
│                                       │ │                                   │
│                                       │ │  ── Status / Client / Dates ──    │
└───────────────────────────────────────┘ └───────────────────────────────────┘
```

### Equipment Tab
- Categories as collapsible sections with overline headers
- Groups as interactive cards (collapsed by default, expandable)
- Group card shows: title, qty × price, suggested price with "Use" button
- Expanded group shows: description, tracked items as pills, "+ Add equipment"
- Inline "Add Group" form with template picker
- Drag-and-drop group reordering via @dnd-kit
- Standalone items shown below groups

### Financial Summary Sidebar
- Total with margin bar (green > 40%, amber 20-40%, red < 20%)
- Equipment revenue, discount, tax breakdown
- Services + Labour costs section
- Pricing progress indicator ("3/8 groups priced" in amber)
- Expandable audit trail breakdown (per-group pricing)

### Labour & Logistics Tab
- Unified tab for services and crew (replaces separate Services/Crew tabs)
- Services grouped by date with crew avatars inline
- `billableToClient` indicator on services

## Project Types
`DRY_HIRE, WET_HIRE, INSTALLATION, TOUR, CORPORATE, THEATRE, FESTIVAL, CONFERENCE, OTHER`

## Subhire
Line items with `isSubhire: true` and `supplierId` reference third-party equipment. `showSubhireOnDocs` controls visibility on client-facing PDFs.

## Kit & Prep-Kit Line Items
- Kit/prep-kit parent: `kitId` set, `isKitChild: false`
- Children: `isKitChild: true`, `parentLineItemId` pointing to parent
- Nested kits (kit inside prep-kit): child has its own `kitId` and `childLineItems`
- Queries must include 2 levels of `childLineItems` with `kit: true` for nested rendering
- See [Kits](./09-kits.md) and [Preps](./32-preps.md)

## Project Services
Structured operational tasks attached to a project (deliveries, pickups, bump in/out, labour, misc).

### Service Types
`DELIVERY, PICKUP, BUMP_IN, BUMP_OUT, LABOUR, MISC`

### Service Status Flow
`PLANNED → CONFIRMED → IN_PROGRESS → COMPLETED` (any → `CANCELLED`)

### Key Behaviour
- Each service has its own date, time, address (for delivery/pickup), crew count, pricing
- `billableToClient` flag: when true, cost flows into project revenue instead of cost
- `costTotal` field for direct financial roll-up (no shadow line items)
- Services grouped by date in the UI

### Crew Integration
- Each service can optionally have a `crewRoleId` (FK to `CrewRole`) and `crewCountRequired`
- Service dialog includes crew role picker and searchable crew member multi-select
- `CrewAssignment` records auto-created with `serviceId` set
- Service type maps to assignment phase: DELIVERY→DELIVERY, PICKUP→PICKUP, etc.
- Deleting a service deletes all linked crew assignments
- Query invalidation ensures Crew and Services stay in sync

### Defaults from Project
- New services inherit the project location address/coordinates
- Date auto-fills based on service type

### Service Templates
- Managed in Settings → Services (`/settings/services`)
- `isAutoAdded` flag for templates that should be added to every new project

### Server Actions
- File: `src/server/project-services.ts`
- CRUD: `createProjectService`, `updateProjectService`, `deleteProjectService`, `getProjectServices`
- Status: `updateServiceStatus`, `bulkUpdateServiceStatus`
- Templates: `createServiceTemplate`, `updateServiceTemplate`, `deleteServiceTemplate`, `getServiceTemplates`
- Financial: `getProjectServicesSummary`

## Duplicate Model Handling
Adding a model that already exists as a line item on the project **merges** into the existing line item (increments quantity) rather than creating a new row.

## Project Templates
- `Project.isTemplate = true`. Templates use the same `Project` table but are completely isolated.
- `generateTemplateCode()` creates `TPL-0001`, `TPL-0002`, etc.
- Templates MUST be excluded from: dashboard stats, notifications, reports, search results, availability calendar, availability checks
- All project list queries: add `isTemplate: false` filter
- `updateProjectStatus()` rejects templates. `getProjectForWarehouse()` throws for templates.
- Duplication preserves full hierarchy: categories, groups, line items, services

## Project Deletion
Only cancelled projects can be deleted (`deleteProject` in `src/server/projects.ts`).

### Cleanup on Delete
1. **Reset checked-out assets**: All `CHECKED_OUT` serialized assets linked to project line items → `AVAILABLE`, restore default location
2. **Reset checked-out kits**: All `CHECKED_OUT` kits + their serialized assets → `AVAILABLE`, restore locations
3. **Delete prep-kits**: All `Kit` records with `isPrep: true` linked to this project are fully deleted
4. **Cascade**: `Project.delete()` cascades to all `ProjectLineItem`, `ProjectMedia`, etc.

## Server Action Files
- `src/server/projects.ts` — Project CRUD, duplication, status management
- `src/server/project-categories.ts` — Category CRUD, reorder
- `src/server/project-groups.ts` — Group CRUD, pricing, reorder, move items
- `src/server/project-managers.ts` — PM add/remove
- `src/server/group-templates.ts` — Template CRUD, save/apply
- `src/server/line-items.ts` — Line item CRUD, `recalculateProjectTotals()`
- `src/server/project-services.ts` — Service CRUD, templates
- `src/server/crew-assignments.ts` — Crew assignment management

## Validation Schemas
- `src/lib/validations/project.ts` — Project form (includes defaultRentalPeriod, defaultRentalQuantity, taxRate)
- `src/lib/validations/project-category.ts` — Category (name, sortOrder)
- `src/lib/validations/project-group.ts` — Group (categoryId, title, description, quantity, price, rentalPeriod, rentalQuantity)
- `src/lib/validations/group-template.ts` — Template (name, description, items[])
- `src/lib/validations/line-item.ts` — Line item (includes categoryId, groupId)
- `src/lib/validations/project-service.ts` — Service (includes billableToClient, costTotal)

## Future-Proofing
- **ROI Tracking**: Model.dailyRate/weeklyRate + Asset.purchasePrice support revenue attribution
- **Xero Integration**: Groups as line items + ungrouped standalone assets as separate line items
