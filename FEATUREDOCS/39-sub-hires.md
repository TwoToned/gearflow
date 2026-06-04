# Sub-Hire Order System

## Overview

Sub-hires track gear rented from third-party suppliers with structured items, dual pricing (cost vs charge), and margin analysis. Replaces the legacy free-text `isSubhire` line items with a first-class `SubHire` entity. Managed entirely via a dialog on the project page — no standalone pages.

## Schema

- **SubHire** — order-level entity: supplier, project, status, dates, totals, pricingMode (ITEMIZED or ORDER_TOTAL), orderTotalCost/orderTotalCharge, paymentStatus (UNPAID/PARTIALLY_PAID/PAID), showOnDocs, defaultTargetCategoryId/defaultTargetGroupId (order-level placement default)
- **SubHireGroup** — groups items within a sub-hire (e.g. "Shure ULXD Kit"). Has title, sortOrder, quantity, cost/charge overrides, showOnQuote, showOnDocs, and placement targets (targetCategoryId/targetGroupId). Items within a group become parent+child line items on the project (using the kit pattern: `isKitChild` + `parentLineItemId`). Children inherit placement from parent.
- **SubHireItem** — line-level: description, model, quantity, unitCost, unitCharge, pricingType, duration, discount, showOnQuote (include on client quote), showOnDocs (show sub-hire indicator), optional groupId, placement targets (targetCategoryId/targetGroupId for ungrouped items)
- **SubHireMedia** — file attachments (quotes, invoices, documents) linked to sub-hire orders via FileUpload join table
- **SupplierModelRate** — caches last rate per supplier+model pair for pre-fill
- **ProjectLineItem** — gains `subHireId`, `subHireItemId`, and `subHireGroupId` FKs

## Status Machine

```
DRAFT → CONFIRMED → RETURNED
  ↓         ↓ ↘        ↓
  ↓         ↓  ON_HIRE→↑
CANCELLED CANCELLED  CANCELLED
```

- **DRAFT → CONFIRMED**: requires `projectId` (server-validated). Line items already exist (generated on add). Confirmation regenerates for consistency and recalculates project totals.
- **CONFIRMED → RETURNED**: marks gear returned from supplier. ON_HIRE step is optional.
- **CONFIRMED → ON_HIRE**: set by warehouse operations (prep/deploy), not from the sub-hire dialog
- **ON_HIRE → RETURNED**: manual, whole-unit return (no partial returns in v1)
- **Any active → CANCELLED**: allowed from DRAFT/CONFIRMED/ON_HIRE

## UI: Project Equipment Tab Integration

Sub-hires are managed via a **dialog** on the project equipment tab:

1. **Sub-Hire Orders section** — expandable rows below the equipment table showing all sub-hire orders for the project. Each row shows order number, supplier, status, item count, charge and margin. Clicking the chevron expands to show individual items grouped by sub-hire groups.
2. **Unified "Add" dialog → Sub-hire tab** — the single equipment toolbar `Add` button opens `UnifiedAddDialog`. The Sub-hire tab uses `SubHireAddForm` to capture supplier, supplier reference, hire start/end, and notes. Submitting calls `createSubHire`, closes the unified dialog, and opens `SubHireOrderDialog` on the new order in manage view so items can be added immediately. The standalone "Sub-Hire" toolbar button and the "New" button at the top of the Sub-Hire Orders panel were removed in v0.9.1.0 — both were duplicates of this flow.
3. **`SubHireOrderDialog` views** — once open on an existing order, the dialog still has the same three views it always had:
   - **List view** — shows all sub-hires for the project
   - **Create view** — still available (used by manual entry points / templates), but the equipment-tab path goes straight to manage view on the freshly-created order
   - **Manage view** — full sub-hire detail with groups, items table, pricing mode, placement pickers, status transitions, delete
4. **Overbook shortcut** — the "Sub-hire N units instead" link in the add-equipment dialog opens the sub-hire flow instead of navigating away

## Display Toggles (Two-Toggle System)

Each sub-hire item and group has exactly two display toggles:

1. **Show on quote** (`showOnQuote`, default: true) — Whether the item/group appears on the client's quote and invoice. When false, no ProjectLineItem is generated for that item/group.
2. **Show as sub-hired** (`showOnDocs`, default: false) — Whether a "sub-hired" indicator appears on client documents. Flows to `ProjectLineItem.showSubhireOnDocs`.

These replace the previous order-level showOnDocs toggle and per-item eye/eyeoff controls. Toggles are available in the item add/edit dialog and the group edit dialog.

## Payment Status

Sub-hire orders track payment to the supplier via `paymentStatus`:
- **UNPAID** (default) — Invoice not yet paid
- **PARTIALLY_PAID** — Partial payment made
- **PAID** — Fully paid

Updated via dropdown in the manage view sidebar. Logged in activity trail.

## File Attachments

Sub-hire orders support file attachments (supplier quotes, invoices, POs) via the `SubHireMedia` join table. Uses the existing `MediaUploader` component and `FileUpload` storage system. Files are displayed in the manage view sidebar with upload, preview, and delete capabilities.

## Placement System

Sub-hire items and groups can be placed into specific project categories and groups. Line items are generated immediately (even for DRAFT sub-hires), so items appear on the equipment tab right away with an "Unconfirmed" badge. This controls where the `ProjectLineItem` records land on the equipment tab.

### Placement targets

- **SubHire** (order-level default): `defaultTargetCategoryId`, `defaultTargetGroupId`
- **SubHireGroup** (group override): `targetCategoryId`, `targetGroupId`
- **SubHireItem** (item override, ungrouped only): `targetCategoryId`, `targetGroupId`

### Resolution order

For **ungrouped items**: item target → order default → uncategorized.
For **sub-hire groups**: group target → order default → uncategorized. Children always follow their parent.
When `targetGroupId` is set, `categoryId` is resolved from the `ProjectGroup.categoryId`.

### Placement scenarios

| Sub-hire entity | Target | Result on project |
|---|---|---|
| Sub-hire group | Project group | Parent line item in that group, children as kit-style children |
| Sub-hire group | Category only | Parent + children at category root |
| Sub-hire group | Nothing | Uncategorized |
| Ungrouped item | Project group | Standalone line item in that group |
| Ungrouped item | Category only | Standalone at category root |
| Ungrouped item | Nothing | Uncategorized |

### UI

- **Order-level default**: PlacementPicker below pricing mode in manage view
- **Per-group override**: PlacementPicker in expanded group section footer
- **Per-ungrouped-item**: inline PlacementPicker on each ungrouped item row in manage view

All mutations (add, update, remove, regroup, placement change) trigger `syncSubHireToProject` which regenerates all line items from scratch. This ensures consistency regardless of sub-hire status.

## Line Item Lifecycle

Sub-hire items become real `ProjectLineItem` records immediately when added — not on confirm. This means:

1. **DRAFT items visible**: Items appear on the equipment tab with an amber "Unconfirmed" badge (tooltip: "This sub-hire order hasn't been confirmed yet")
2. **Real line items**: They're full ProjectLineItems, sortable, editable in placement, included in group suggested prices
3. **Confirm = status change**: Confirming a sub-hire changes status and regenerates for consistency, but items were already visible
4. **Badge logic**: Equipment tab builds a `draftSubHireIds` set from sub-hires with status DRAFT, then checks `item.subHireId` against it

## Margin Tracking (Integrated Cost Model)

Sub-hire costs are integrated into the project financial calculations:

| Field | Formula | Source |
|-------|---------|--------|
| `subHireCostTotal` | SUM(subHire.totalCost) for CONFIRMED/ON_HIRE/RETURNED | `recalculateProjectTotals` |
| `margin` | total - (serviceCostTotal + labourCostTotal + **subHireCostTotal**) | `recalculateProjectTotals` |

Sub-hire costs appear in the **Costs** section of the project financial summary alongside service costs and labour costs. DRAFT and CANCELLED sub-hires are excluded from the cost calculation.

The sub-hire item's `unitCharge` flows to the `ProjectLineItem.unitPrice`, which feeds into `suggestedPrice` for project groups. If the user overrides the group price, that's their business decision. The sub-hire order still tracks the full cost vs charge breakdown for per-order margin analysis.

## Warehouse Integration

Sub-hire group parents (line items with `subHireGroupId`) are treated like kit parents in the warehouse:
- Their child items appear in prep, deploy, and return tabs
- Pull sheets show group parent with indented children
- The `isGroupParent()` helper in `warehouse-types.ts` detects these (items with children but no kitId)

## Key Behaviors

### Line Item Generation
Line items are generated immediately (even for DRAFT sub-hires) via `syncSubHireToProject`. Items with `showOnQuote: false` are skipped — they exist in the sub-hire order for cost tracking but don't appear on the project. All items are `isSubhire: true`, linked via `subHireId` and `subHireItemId` FKs.

**Grouped items** use the kit parent-child pattern: a parent `ProjectLineItem` is created for the group (with `subHireGroupId` set, description = group title) and each group item becomes a child line item with `isKitChild: true` and `parentLineItemId` pointing to the group parent. **Children inherit the same `categoryId`/`groupId` as the parent** so they appear in the correct project group. When a group has a `charge` set, the parent uses `KIT_PRICE` pricing mode; otherwise `ITEMIZED`. The `showOnDocs` values from items and groups determine `ProjectLineItem.showSubhireOnDocs`.

**Ungrouped items** are created as standalone line items with their own placement.

**Equipment tab rendering**: `isKitChild` items are filtered from the flat list — they only appear as expandable children under their parent item (chevron toggle). Groups with `showOnQuote: false` generate no line items at all.

### Pricing Modes
- **ITEMIZED** (default) — each item has its own unitCost and unitCharge. Totals are summed from items. When a group has `cost` or `charge` set, those flat values **replace** the sum of that group's items in the order totals (e.g. supplier package deals).
- **ORDER_TOTAL** — a flat orderTotalCost and optional orderTotalCharge set on the sub-hire itself. Item-level costs are for tracking only. Useful when suppliers don't provide itemized invoices.

### Group Pricing
Groups have optional `quantity`, `cost`, and `charge` fields. When `cost` is set, it overrides the sum of items' costs for that group in `recalculateSubHireTotals`. Same for `charge`. The group edit dialog shows suggested values from items and a live margin preview. Group `charge` flows to the parent line item's `unitPrice` using `KIT_PRICE` mode.

### Line Item Sync
Editing a sub-hire item when the sub-hire is CONFIRMED or ON_HIRE updates the corresponding `ProjectLineItem` (including `showSubhireOnDocs`) and recalculates project totals.

### Deletion
Deleting a sub-hire first deletes linked `ProjectLineItem` records (not orphan), recalculates project totals, then deletes the sub-hire (cascade deletes items).

### Group Deletion
Deleting a group ungroups its items (sets `groupId` to null). If the sub-hire is confirmed, the group's parent line item is deleted and ungrouped items are re-created as standalone line items.

### Project Change
Moving a sub-hire to a different project deletes old line items, generates new ones, and recalculates totals on both projects in a single transaction. Placement targets are cleared (new project has different categories/groups).

### Order Numbers
Auto-generated via atomic counter in `Organization.metadata.subHireOrderCounter`. Format: `SH-0001`.

## Expansion Features

1. **Supplier Rate Memory** — `SupplierModelRate` caches last unitCost per supplier+model. Auto-upserted on item create/update. Pre-fills cost in item dialog.
2. **Quick Duplicate** — clones sub-hire + items to new DRAFT with fresh order number. Per-item `showOnDocs` is copied; placement targets are cleared.
3. **Shortage-Triggered Sub-Hire** — pre-check before adding equipment to project. If stock insufficient, offers to create a sub-hire for the shortfall.
4. **Dashboard Widget** — active sub-hires count + monthly cost in dashboard metrics strip.
5. **Supplier Cost Comparison** — when selecting a model in the item dialog, shows rates from all suppliers for that model.

## Files

| File | Role |
|------|------|
| `prisma/schema.prisma` | SubHire, SubHireGroup, SubHireItem, SupplierModelRate models + placement FKs |
| `src/lib/validations/sub-hire.ts` | Zod schemas (subHire, subHireItem, subHireGroup, subHireOrderPricing, subHirePlacement) |
| `src/lib/permissions.ts` | subHire resource |
| `src/server/sub-hires.ts` | All server actions (CRUD, placement, line item generation, sync, rates) |
| `src/components/projects/sub-hire-order-dialog.tsx` | Dialog component (list/create/manage views, item form, PlacementPicker, item row with showOnDocs) |
| `src/components/projects/equipment-tab.tsx` | Sub-hire orders section + dialog wiring + expanded items with groups |
| `src/components/projects/add-equipment-dialog.tsx` | Overbook shortcut callback |

## Migration Strategy

Leave-and-layer. Legacy `isSubhire` line items remain as-is. New sub-hires use the `SubHire` entity. Both "Add Subhire" (legacy line item) and "Sub-Hire Orders" (new dialog) appear in the equipment tab.

## Not in Scope (v1)

- Partial returns (per-item return tracking)
- Project-level sub-hire cost integration in project totals formula
- Pro-rated cost attribution across months
- Backfill of legacy sub-hire line items
- Per-ungrouped-item placement picker in UI (server action exists, UI deferred)
