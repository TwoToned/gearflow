# Sub-Hire Order System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview

Sub-hires track gear rented from third-party suppliers with structured items, dual pricing (cost vs charge), and margin analysis. Replaces the legacy free-text `isSubhire` line items with a first-class `SubHire` entity. Managed entirely via a dialog on the project page — no standalone pages.

## Schema

- **SubHire** — order-level entity: supplier, project, status, dates, totals, pricingMode (ITEMIZED or ORDER_TOTAL), orderTotalCost/orderTotalCharge, paymentStatus (UNPAID/PARTIALLY_PAID/PAID), showOnDocs, defaultTargetCategoryId/defaultTargetGroupId (order-level placement default)
- **SubHireGroup** — groups items within a sub-hire (e.g. "Shure ULXD Kit"). Has title, sortOrder, quantity, cost/charge overrides, **discount (% off the client charge)**, showOnQuote, showOnDocs, and placement targets (targetCategoryId/targetGroupId). Items within a group become parent+child line items on the project (using the kit pattern: `isKitChild` + `parentLineItemId`). Children inherit placement from parent.
- **SubHireItem** — line-level: description, model, quantity, unitCost, unitCharge, pricingType, duration, discount (0-100%, plain — no `$`/`%` entry-mode toggle like `ProjectLineItem.discount`), notes, showOnQuote (include on client quote), showOnDocs (show sub-hire indicator), optional groupId, placement targets (targetCategoryId/targetGroupId for ungrouped items)
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

### Inline editing on the equipment table

Price, discount, quantity, description, and notes are inline-editable
directly on a sub-hire **group child** row in the equipment table
(`equipment-rows.tsx`'s `LineItemRow`, gated on `item.subHireGroupId !=
null`) — the same click-to-edit/save-on-blur cells the regular equipment
table uses (`src/components/projects/line-item-inline-cells.tsx`), but
routed to a DIFFERENT write than a normal line item:

- A sub-hire group child's `ProjectLineItem` row is a **derived/display
  copy** — `regenerateSubHireLines` (`convex/lib/subHireLineGen.ts`) deletes
  and recreates every derived line for a sub-hire order on ANY change to
  that order (add/edit/remove item or group, confirm, placement, project
  change...). Patching the derived row directly (`patchNative`, what regular
  line items use) would appear to save but silently vanish the next time
  anything else in that order changes. Inline edits on these rows instead
  patch the SOURCE `subHireItems` row via `subHiresWrites.updateSubHireItemNative`
  (keyed by the row's `subHireItemId`, not its own `id`) — see
  `src/lib/sub-hire-item-edit-payload.ts`'s `computeInlineSubHireItemInput`
  and `equipment-tab.tsx`'s `handleInlineLineItemUpdate`, which branches on
  `subHireGroupId` to pick the write path.
- **Discount** renders as a plain 0-100% cell (`InlineEditablePercent`, no
  `$`/`%` toggle) — sub-hire items don't have `ProjectLineItem.discountMode`'s
  entry-mode concept, the percentage IS what's stored.
- **Not lock-gated** — `updateSubHireItemNative` never checks the project's
  financial lock (same as `SubHireOrderDialog`'s item form today), so these
  cells render without the `<LockedField>` wrapper regular money cells use.
- **Quantity** has no availability/overbook concept for sub-hire items —
  `updateSubHireItemNative` sets it directly with no stock check, so
  `InlineEditableQuantity`'s overbook-confirm step (built for the regular
  `patchNative`/`INSUFFICIENT_STOCK` path) simply never triggers here; the
  save always succeeds on the first attempt.
- The sub-hire **group's own row** (`SubHireGroupRow`) also gets inline
  charge/cost cells, calling the same `updateGroup` mutation
  `PriceEditDialog`'s sub-hire branch uses (`onInlinePriceUpdate` prop) — the
  dialog stays available as a redundant entry point, same as the pencil
  "Edit" button elsewhere.
- Ungrouped/standalone sub-hire items (no `subHireGroupId`) are unaffected —
  they already went through the regular `patchNative` inline-edit path
  before this, since a standalone line's own `unitPrice`/`discount` ARE what
  bills (unlike a group child's, which is excluded from revenue calc —
  `recalc.ts` filters out `isKitChild` lines, only the group parent's total
  counts).

## Display Toggles (Two-Toggle System)

Each sub-hire item and group has exactly two display toggles:

1. **Show on quote** (`showOnQuote`, default: true) — Whether the item/group appears on the client's quote and invoice. When false, no ProjectLineItem is generated for that item/group.
2. **Show as sub-hired** (`showOnDocs`, default: false) — Whether a "sub-hired" indicator appears on client documents. Flows to `ProjectLineItem.showSubhireOnDocs`.

These replace the previous order-level showOnDocs toggle and per-item eye/eyeoff controls. Toggles are available in the item add/edit dialog and the group edit dialog.

**Where the "sub-hired" indicator is gated, and where it isn't:** `showSubhireOnDocs` governs two independent renders that must never drift apart — the `SUBHIRE` badge and the "via {supplier}" line drawn beneath the item description:

- **Client-facing PDFs (quote, invoice):** both the badge and the "via {supplier}" line are gated by `isSubhireIndicatorVisible()` (`src/lib/pdfme/plugins/gearflow-table.ts`) — visible only when `showSubhireOnDocs` is true. `document-composer.ts`'s `calculateItemHeight` mirrors the same gate (with the doc's `documentType` threaded in) for its row-height reservation, or pagination silently diverges from the real render (tail-drop — see that function's comment).
- **Internal-only PDFs (packing-list, return-sheet, delivery-docket):** both always show, regardless of the toggle — warehouse staff always need to know an item is sub-hired.
- **Internal project view** (`src/components/projects/equipment-rows.tsx`, staff-only, no client ever sees this page): the `Subhire` badge and the group row's `Handshake` icon always show (staff need at-a-glance visibility). The "via {supplier}" text — naming the actual supplier — is gated by `item.showSubhireOnDocs` / `group.showOnDocs`, matching the client-doc toggle even though this page is internal, so the item's supplier-visibility setting reads consistently everywhere.

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

**Placement is only ever read from these target fields, never from the generated `ProjectLineItem.groupId/categoryId`.** Because `generateSubHireLineItems` deletes + recreates every sub-hire line on each add/edit, any placement change that lands only on the line item is lost on the next regenerate — the item "pops back out" of its group/category. Therefore every path that repositions a sub-hire-derived line item **must write the placement back to the originating sub-hire entity's target fields**: `moveSubHireGroupToCategory` (group parent) and `moveLineItemToGroup` (standalone item — patches the `SubHireItem`'s `targetGroupId/targetCategoryId`, or the `SubHireGroup`'s for a group parent) both do this.

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
| sub-hire **revenue** | SUM(subHire line `lineTotal`) — via `equipmentRevenue` | `recalculateProjectTotals` |
| `margin` | total - (serviceCostTotal + labourCostTotal + **subHireCostTotal**) | `recalculateProjectTotals` |

Sub-hire costs appear in the **Costs** section of the project financial summary alongside service costs and labour costs. DRAFT and CANCELLED sub-hires are excluded from the cost calculation.

**Cost vs revenue use different models — mind the asymmetry.** Cost is *head-driven*: `SUM(subHire.totalCost)`, which includes even `showOnQuote:false` items (cost-only tracking) but excludes whole DRAFT/CANCELLED sub-hires. Revenue is *line-item-driven*: it sums the generated sub-hire `ProjectLineItem.lineTotal`s inside `equipmentRevenue`, so it only counts `showOnQuote` items but is agnostic to the sub-hire's DRAFT/CANCELLED status (line items are generated for DRAFT sub-hires and are not removed on cancel). A DRAFT sub-hire therefore books revenue but no cost until confirmed — intentional (optimistic quote), but a source of "cost missing" confusion.

**Grouped sub-hire revenue (`subHireGroupedRevenue`).** A sub-hire line placed *into a project group* (via `targetGroupId`/order default) carries its own client charge, independent of the host group's bundle price. `equipmentRevenue`'s group term only counts `isCustomItem` extras (and zeroes them for a priced group), so a grouped sub-hire's charge would silently vanish. `recalculateProjectTotals` adds `subHireGroupedRevenue` — every non-child, non-optional sub-hire line with a `groupId` — counted individually, mirroring how the same line bills when ungrouped. Kit-style children (`isKitChild`) are excluded to avoid double-counting against their group parent's charge. Kept byte-for-byte in sync between `src/server/line-items.ts` and `convex/lib/recalc.ts`.

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
Groups have optional `quantity`, `cost`, and `charge` fields plus a `discount` (%, default 0). When `cost` is set, it overrides the sum of items' costs for that group in `recalculateSubHireTotals`. Same for `charge`. **`discount` reduces the client charge only** (not the supplier cost) — parity with `SubHireItem.discount` — and is applied both in `recalculateSubHireTotals` (`charge × qty × (1 − discount/100)`) and in `generateSubHireLineItems` (the group parent line item's `lineTotal`, with `discount` stored on the parent for display). The group edit dialog exposes Cost, Charge, and **Discount (%)** — matching the equipment add/edit screen — with suggested values from items and a live margin preview net of the discount. Group `charge` flows to the parent line item's `unitPrice` using `KIT_PRICE` mode.

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

**Doc-drift correction (WS7 #946, 2026-07-26):** this table previously cited
`prisma/schema.prisma` as owning the SubHire/SubHireGroup/SubHireItem/SupplierModelRate
models and `src/server/sub-hires.ts` as holding "all server actions" — both stale.
Sub-hire data has lived in **Convex** (`convex/schema.ts`) since the Convex-native
migration (Postgres now only holds Better-Auth + audit models), and PR-2 of that
migration deleted every write from `src/server/sub-hires.ts` — it now holds only the
5 reads (`getSubHires`/`getSubHire`/`getSupplierModelRate`/`getSupplierRateHistory`/
`checkSubHireOpportunity`) + the media trio. All CRUD/placement/pricing/orchestration
writes are browser-direct native mutations.

| File | Role |
|------|------|
| `convex/schema.ts` | `subHires`, `subHireGroups`, `subHireItems`, `supplierModelRates` tables + placement FKs + `supplierOrderId` (WS7 #946 link) |
| `convex/subHiresWrites.ts` | ALL browser-direct write mutations: head/status/payment CRUD, item CRUD, group CRUD, placement, order pricing, changeProject, duplicate, PO link/unlink |
| `convex/lib/subHireTotals.ts` | `recalcSubHireTotals` (money) + `upsertSupplierModelRate` |
| `convex/lib/subHireLineGen.ts` | `regenerateSubHireLines` — delete-and-recreate of a sub-hire's `projectLineItems` |
| `src/lib/sub-hire-read.ts` | Server-side read helpers mapping the Convex rows back to the Prisma-row shape pages expect |
| `src/lib/sub-hire-to-order.ts` | WS7 #946 — pure prefill mapping for "Create purchase order from this sub-hire" |
| `src/lib/validations/sub-hire.ts` | Zod schemas (subHire, subHireItem, subHireGroup, subHireOrderPricing, subHirePlacement) |
| `src/lib/permissions.ts` | subHire resource |
| `src/server/sub-hires.ts` | READS ONLY (getSubHires/getSubHire/rate memory/opportunity check) + media add/remove |
| `src/hooks/use-sub-hire-writes.ts` | Browser-direct write hook wrapping every `subHiresWrites.ts` mutation |
| `src/components/projects/sub-hire-order-dialog.tsx` | Dialog component (list/create/manage views, item form, PlacementPicker, item row with showOnDocs, PO link panel + create-order dialog) |
| `src/components/projects/equipment-tab.tsx` | Sub-hire orders section + dialog wiring + expanded items with groups |
| `src/components/projects/add-equipment-dialog.tsx` | Overbook shortcut callback |

## Performance notes

The Sub-Hire Order **modal** reads through non-reactive server actions
(`getSubHires` list / `getSubHire` detail) via `createSharedResource`, unlike the
equipment tab and dashboard which read sub-hire data natively through Convex
`useQuery` (`api.equipmentTab.bundle` / `api.dashboardSubHire.bundle`). This is
why the modal feels slower than the tab and why the create→manage handoff shows a
skeleton while `getSubHire` loads.

Latency reductions applied so far (without changing the read architecture):
- `getSubHire` scopes its placement-label fetch to the sub-hire's project
  (`projectCategories.listByProject` / `projectGroups.listByProject`) instead of
  pulling every category/group in the org.
- `createSubHire` runs the Prisma order-number reservation and the supplier fetch
  concurrently and drops a redundant tail round-trip.

**Follow-up (not yet done):** rewire the modal's two reads to Convex `useQuery`
for true reactivity, so the create→manage handoff is instant and edits stream in
live. Blocker to note: `getSubHire` enriches with `createdBy` (a Better Auth user
that lives in **Postgres**, unreadable from a Convex query) and resolved media
URLs, so a pure `useQuery` bundle needs those handled separately. Worth its own
PR with browser QA against a seeded project.

## Migration Strategy

Leave-and-layer. Legacy `isSubhire` line items remain as-is. New sub-hires use the `SubHire` entity. Both "Add Subhire" (legacy line item) and "Sub-Hire Orders" (new dialog) appear in the equipment tab.

## Purchase Order Link (WS7 #946)

`SubHire` gains an optional `supplierOrderId` — a 1:1 FK to `SupplierOrder`
(`convex/schema.ts`, `.index("by_supplierOrderId", ["supplierOrderId"])`) so a
sub-hire's cost side can be reconciled against the actual invoiced purchase order.
Data-only linkage — **no supplier-facing documents or emails** change.

- **Validation** (`convex/subHiresWrites.ts`): `requireLinkableSupplierOrder`
  org-checks the order (`assertRefInOrg`-equivalent via `by_cuid`, a GLOBAL index)
  AND enforces the **same-supplier invariant** — `order.supplierId` must equal the
  sub-hire's supplier. A link across two different suppliers is rejected.
- **Set / clear**: `linkSubHireToSupplierOrderNative` / `unlinkSubHireFromSupplierOrderNative`
  — kept as their own small mutations rather than folded into `updateSubHireNative`
  (mirrors `attachInvoiceNative`/`removeInvoiceNative` on the order side). Both
  regenerate the sub-hire's project lines afterward so `projectLineItems.supplierOrderId`
  (previously a dormant field with no writer at all) picks up the link immediately.
- **Clear-on-supplier-change**: changing the sub-hire's supplier via
  `updateSubHireNative` clears an existing `supplierOrderId` (the asset-form
  `supplierOrderId` precedent, issue #789) — a link only makes sense when both sides
  still name the same supplier.
- **Duplicate**: `duplicateSubHireNative` does NOT copy `supplierOrderId` — a
  duplicated sub-hire starts unlinked (the source order was raised for the
  *original* sub-hire's items, not the copy's).
- **Delete**: deleting a sub-hire never touches the linked order — the FK is
  one-directional (`subHires.supplierOrderId → supplierOrders.id`; the order carries
  no back-reference), so removing the sub-hire row simply removes the FK with it.
  The order is orphaned, never cascade-deleted. Conversely, `supplierOrdersWrites.deleteNative`
  refuses to delete an order that a sub-hire (or an asset) still references.
- **Create-order-from-sub-hire**: `SubHireManageView`'s "Create purchase order"
  action (`src/components/projects/sub-hire-order-dialog.tsx`) creates a new
  `SUBHIRE`-type order prefilled from the sub-hire (supplier, hireStart→orderDate,
  hireEnd→expectedDate, project), copies every sub-hire item across (cost →
  `unitPrice`), then links the two. Prefill mapping is a pure, unit-tested helper —
  `src/lib/sub-hire-to-order.ts` (`buildOrderHeaderPrefill`,
  `mapSubHireItemsToOrderItems`, `defaultOrderNumberFor` → `PO-{orderNumber}`,
  user-editable before create). The modal reads via non-reactive server actions
  (see Performance notes below) — an explicit `invalidate()` after create refreshes
  the manage view with the new link.
- **Reconciliation (quoted vs invoiced)**: shown on the manage view's "Purchase
  order" panel once linked — quoted = `subHire.totalCost`; invoiced = the linked
  order's `total`; variance = invoiced − quoted, **derived on every read, never
  denormalised** (`getSubHire` in `src/server/sub-hires.ts` computes it fresh each
  time). **The P&L keeps using `subHire.totalCost` only** — sub-hire order totals do
  NOT feed `recalculateProjectTotals`/`recalc.ts`; variance is informational (spec
  decision, WS7 #946). See [22-suppliers](./22-suppliers.md#supplier-orders-purchase-orders)
  for the order-side lifecycle this link connects to, including the supplier-page
  spend rollups that de-duplicate a linked pair to count once.

## Not in Scope (v1)

- Partial returns (per-item return tracking)
- Project-level sub-hire cost integration in project totals formula
- Pro-rated cost attribution across months
- Backfill of legacy sub-hire line items
- Per-ungrouped-item placement picker in UI (server action exists, UI deferred)
- Charge-back-aware damage costs (still unbuilt — see [10-projects](./10-projects.md#operational-pl-panel))
