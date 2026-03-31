# Sub-Hire Order System

## Overview

Sub-hires track gear rented from third-party suppliers with structured items, dual pricing (cost vs charge), and margin analysis. Replaces the legacy free-text `isSubhire` line items with a first-class `SubHire` entity. Managed entirely via a dialog on the project page — no standalone pages.

## Schema

- **SubHire** — order-level entity: supplier, project, status, dates, totals, pricingMode (ITEMIZED or ORDER_TOTAL), orderTotalCost/orderTotalCharge, showOnDocs (default for new items), defaultTargetCategoryId/defaultTargetGroupId (order-level placement default)
- **SubHireGroup** — groups items within a sub-hire (e.g. "Shure ULXD Kit"). Has title, sortOrder, and placement targets (targetCategoryId/targetGroupId). Items within a group become parent+child line items on the project (using the kit pattern: `isKitChild` + `parentLineItemId`).
- **SubHireItem** — line-level: description, model, quantity, unitCost, unitCharge, pricingType, duration, discount, showOnDocs (per-item), optional groupId, placement targets (targetCategoryId/targetGroupId for ungrouped items)
- **SupplierModelRate** — caches last rate per supplier+model pair for pre-fill
- **ProjectLineItem** — gains `subHireId`, `subHireItemId`, and `subHireGroupId` FKs

## Status Machine

```
DRAFT → CONFIRMED → ON_HIRE → RETURNED
  ↓         ↓          ↓
CANCELLED CANCELLED  CANCELLED
```

- **DRAFT → CONFIRMED**: requires `projectId` (server-validated). Atomic transaction: status change + `generateSubHireLineItems` in single `$transaction`
- **CONFIRMED → ON_HIRE**: manual, marks gear dispatched from supplier
- **ON_HIRE → RETURNED**: manual, whole-unit return (no partial returns in v1)
- **Any active → CANCELLED**: allowed from DRAFT/CONFIRMED/ON_HIRE

## UI: Project Equipment Tab Integration

Sub-hires are managed via a **dialog** on the project equipment tab:

1. **Sub-Hire Orders section** — expandable rows below the equipment table showing all sub-hire orders for the project. Each row shows order number, supplier, status, item count, charge and margin. Clicking the chevron expands to show individual items grouped by sub-hire groups.
2. **"Sub-Hire Orders" toolbar button** — opens the dialog which has three views:
   - **List view** — shows all sub-hires for the project with create button
   - **Create view** — supplier picker, dates, showOnDocs toggle, notes
   - **Manage view** — full sub-hire detail with groups, items table, pricing mode, placement pickers, status transitions, delete
3. **Overbook shortcut** — the "Sub-hire N units instead" link in the add-equipment dialog opens the sub-hire dialog instead of navigating away

## Per-Item showOnDocs

Each sub-hire item has its own `showOnDocs` boolean controlling whether it appears as sub-hired on client-facing documents (quotes, invoices, packing lists). The order-level `showOnDocs` is the default for new items. Items can be toggled individually via the item dropdown menu (Eye/EyeOff icon) or in the item add/edit form. The per-item value flows to `ProjectLineItem.showSubhireOnDocs` during line item generation.

## Placement System

Sub-hire items and groups can be placed into specific project categories and groups when confirmed. This controls where the generated `ProjectLineItem` records land on the equipment tab.

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
- **Per-ungrouped-item**: available via `updateSubHirePlacement` server action

After placement changes on confirmed orders, line items are moved or regenerated and `suggestedPrice` is recalculated on affected project groups.

## Margin Tracking (Two-Ledger Model)

Sub-hire costs and project revenue are tracked on **separate ledgers**:

| Ledger | Tracks | Source of truth |
|--------|--------|----------------|
| **Sub-hire order** | What we pay the supplier vs what we intend to charge | `SubHire.totalCost` / `SubHire.totalCharge` |
| **Project** | What the client actually pays | Group prices + standalone line item totals |

These can diverge intentionally:
- **Markup**: sub-hire cost $400, charge client $600
- **Absorption**: sub-hire cost $400, charge client $0 (we eat the cost)
- **Blended group**: sub-hire items mixed with internal stock in a group — group price is the blended client price
- **Cross-subsidy**: sub-hire cost exceeds its charge, but overall project is profitable

The sub-hire item's `unitCharge` flows to the `ProjectLineItem.unitPrice`, which feeds into `suggestedPrice` for project groups. If the user overrides the group price, that's their business decision. The sub-hire margin analysis still shows the true supplier cost vs charge.

## Key Behaviors

### Line Item Generation
When a sub-hire is confirmed, `ProjectLineItem` records are created for each `SubHireItem` with `isSubhire: true`, linked via `subHireId` and `subHireItemId` FKs. Placement targets are resolved and line items are placed into the correct project categories/groups. `suggestedPrice` is recalculated on affected project groups. Project totals are recalculated after.

**Grouped items** use the kit parent-child pattern: a parent `ProjectLineItem` is created for the group (with `subHireGroupId` set, description = group title) and each group item becomes a child line item with `isKitChild: true` and `parentLineItemId` pointing to the group parent. Per-item `showOnDocs` determines each line item's `showSubhireOnDocs`.

**Ungrouped items** are created as standalone line items with their own placement.

### Pricing Modes
- **ITEMIZED** (default) — each item has its own unitCost and unitCharge. Totals are summed from items.
- **ORDER_TOTAL** — a flat orderTotalCost and optional orderTotalCharge set on the sub-hire itself. Item-level costs are for tracking only. Useful when suppliers don't provide itemized invoices.

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
