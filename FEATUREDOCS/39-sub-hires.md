# Sub-Hire Order System

## Overview

Sub-hires track gear rented from third-party suppliers with structured items, dual pricing (cost vs charge), and margin analysis. Replaces the legacy free-text `isSubhire` line items with a first-class `SubHire` entity. Managed entirely via a dialog on the project page — no standalone pages.

## Schema

- **SubHire** — order-level entity: supplier, project, status, dates, totals, showOnDocs, pricingMode (ITEMIZED or ORDER_TOTAL), orderTotalCost/orderTotalCharge
- **SubHireGroup** — groups items within a sub-hire (e.g. "Shure ULXD Kit"). Has title and sortOrder. Items within a group become parent+child line items on the project (using the kit pattern: `isKitChild` + `parentLineItemId`).
- **SubHireItem** — line-level: description, model, quantity, unitCost, unitCharge, pricingType, duration, discount, optional groupId
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

1. **Sub-Hire Orders section** — expandable rows below the equipment table showing all sub-hire orders for the project. Each row shows order number, supplier, status, item count, charge and margin. Clicking the chevron expands to show individual items.
2. **"Sub-Hire Orders" toolbar button** — opens the dialog which has three views:
   - **List view** — shows all sub-hires for the project with create button
   - **Create view** — supplier picker, dates, showOnDocs toggle, notes
   - **Manage view** — full sub-hire detail with items table, add/edit/remove items, status transitions, delete
3. **Overbook shortcut** — the "Sub-hire N units instead" link in the add-equipment dialog opens the sub-hire dialog instead of navigating away
4. **showOnDocs** toggle — controls whether the sub-hire's line items appear on client-facing documents (quotes, invoices, packing lists)

## Key Behaviors

### Line Item Generation
When a sub-hire is confirmed, `ProjectLineItem` records are created for each `SubHireItem` with `isSubhire: true`, linked via `subHireId` and `subHireItemId` FKs. Project totals are recalculated after.

**Grouped items** use the kit parent-child pattern: a parent `ProjectLineItem` is created for the group (with `subHireGroupId` set, description = group title) and each group item becomes a child line item with `isKitChild: true` and `parentLineItemId` pointing to the group parent. This means grouped sub-hire items render inside collapsible groups on the equipment tab with no new rendering infrastructure.

**Ungrouped items** are created as standalone line items (no parent).

### Pricing Modes
- **ITEMIZED** (default) — each item has its own unitCost and unitCharge. Totals are summed from items.
- **ORDER_TOTAL** — a flat orderTotalCost and optional orderTotalCharge set on the sub-hire itself. Item-level costs are for tracking only. Useful when suppliers don't provide itemized invoices.

### Line Item Sync
Editing a sub-hire item when the sub-hire is CONFIRMED or ON_HIRE updates the corresponding `ProjectLineItem` and recalculates project totals.

### Deletion
Deleting a sub-hire first deletes linked `ProjectLineItem` records (not orphan), recalculates project totals, then deletes the sub-hire (cascade deletes items).

### Group Deletion
Deleting a group ungroups its items (sets `groupId` to null). If the sub-hire is confirmed, the group's parent line item is deleted and ungrouped items are re-created as standalone line items.

### Project Change
Moving a sub-hire to a different project deletes old line items, generates new ones, and recalculates totals on both projects in a single transaction.

### Order Numbers
Auto-generated via atomic counter in `Organization.metadata.subHireOrderCounter`. Format: `SH-0001`.

## Expansion Features

1. **Supplier Rate Memory** — `SupplierModelRate` caches last unitCost per supplier+model. Auto-upserted on item create/update. Pre-fills cost in item dialog.
2. **Quick Duplicate** — clones sub-hire + items to new DRAFT with fresh order number.
3. **Shortage-Triggered Sub-Hire** — pre-check before adding equipment to project. If stock insufficient, offers to create a sub-hire for the shortfall.
4. **Dashboard Widget** — active sub-hires count + monthly cost in dashboard metrics strip.
5. **Supplier Cost Comparison** — when selecting a model in the item dialog, shows rates from all suppliers for that model.

## Files

| File | Role |
|------|------|
| `prisma/schema.prisma` | SubHire, SubHireGroup, SubHireItem, SupplierModelRate models |
| `src/lib/validations/sub-hire.ts` | Zod schemas (subHire, subHireItem, subHireGroup, subHireOrderPricing) |
| `src/lib/permissions.ts` | subHire resource |
| `src/server/sub-hires.ts` | All server actions |
| `src/components/projects/sub-hire-order-dialog.tsx` | Dialog component (list/create/manage views + item form) |
| `src/components/projects/equipment-tab.tsx` | Sub-hire orders section + dialog wiring |
| `src/components/projects/add-equipment-dialog.tsx` | Overbook shortcut callback |

## Migration Strategy

Leave-and-layer. Legacy `isSubhire` line items remain as-is. New sub-hires use the `SubHire` entity. Both "Add Subhire" (legacy line item) and "Sub-Hire Orders" (new dialog) appear in the equipment tab.

## Not in Scope (v1)

- Partial returns (per-item return tracking)
- Project-level sub-hire cost integration in project totals formula
- Pro-rated cost attribution across months
- Backfill of legacy sub-hire line items
