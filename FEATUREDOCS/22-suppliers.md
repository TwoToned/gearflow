# Suppliers & Purchase Orders

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Suppliers
- **List page data source (2026-07, perf fix):** `SupplierTable`
  (`src/components/suppliers/supplier-table.tsx`) is server-side paginated —
  `suppliers.listPage` (filter/sort done in Convex) via `useAuthedQuery`, replacing a
  whole-org `useSuppliers` live subscription that filtered/sorted client-side. See
  `docs/designs/perf-convex-efficiency-2026-06.md` Finding #1. Unlike clients/kits,
  archived suppliers are NOT excluded by default (`isActive` is an explicit filter).
  Asset/order counts stay a separate, non-reactive cross-domain merge.
- **Routes**: `/suppliers` (list), `/suppliers/[id]` (detail), `/suppliers/[id]/edit`, `/suppliers/new`, `/suppliers/[id]/orders/new`
- **Fields**: name (required), contactName, email, phone, website, address, notes, accountNumber, paymentTerms, defaultLeadTime, tags, isActive
- **Convex functions**: `convex/suppliers.ts` (reads: `list`, `getById`, `counts`, `detail`, `assetsPage`, `subhiresPage`; mutations: `create`, `update`, `remove`) + `convex/suppliersWrites.ts` (browser-direct: `createNative`, `updateNative`, `removeNative`)
- **Permissions**: `"supplier"` resource with full CRUD. Owner/admin: all, manager: create/read/update, member/viewer: read
- **Sidebar**: Between Clients and Locations with `Truck` icon
- **Search**: Global search matches name, contactName, accountNumber, email, tags. In PAGE_COMMANDS with `searchType: "supplier"`
- **Detail page**: Info cards (Contact, Account Details, Summary), tags, notes, 3 tabs (Orders, Assets, Subhires)
- **Delete guards**: Cannot delete supplier with linked assets, line items, or orders
- **Settings migration**: `/settings/assets` links to `/suppliers` instead of inline SupplierManager
- **Form**: `src/components/suppliers/supplier-form.tsx` is built on the shared
  `SmartFormLayout` shell (`src/components/ui/smart-form.tsx`, documented in
  [08-assets](./08-assets.md#shared-shell--smartformlayout)). Single clean page:
  Identity → Contact (incl. website) → Address (`AddressInput` w/ map + lat/lng),
  with a collapsed "More details" accordion (account number, payment terms,
  default lead time, notes, tags). Sticky helper rail: Kalam tip + a live
  supplier preview card (name + primary contact). new + edit render the same
  form (edit pre-filled); pages widened to `max-w-5xl`. `supplierSchema`, server
  actions, fields and permissions are unchanged.

## Clients & Locations forms
- **`ClientTable` data source (2026-07, perf fix):** server-side paginated —
  `clients.listPage` (filter/sort done in Convex) via `useAuthedQuery`, replacing a
  whole-org `useClients` live subscription that filtered/sorted client-side. Always
  excludes archived (`isActive: false`) clients. See
  `docs/designs/perf-convex-efficiency-2026-06.md` Finding #1. Project counts stay
  a separate, non-reactive cross-domain merge. `ClientsDashboard`'s own `useProjects`
  call (aggregate revenue/count stats for one client) is a separate, not-yet-converted
  follow-up — different problem shape (aggregate, not a row list).
- **Client form** (`src/components/clients/client-form.tsx`) and **location form**
  (`src/components/locations/location-form.tsx`) use the same `SmartFormLayout`
  shell. Client sections: Identity (name + type `Select`) → Contact → Address
  (billing + shipping `AddressInput`) → "More details" accordion (ABN, payment
  terms, default discount, notes, tags); live preview = client card (name + type
  chip + primary contact). Location sections: Identity (name + type `Select`) →
  Place (parent-location `ComboboxPicker` with inline `QuickCreateLocation`,
  `AddressInput` w/ parent-address inheritance) → "More details" accordion
  (notes, tags, default-location checkbox); live preview = location card (name +
  type chip + address w/ `MapPin`). Both: new + edit render the same form,
  `max-w-5xl` pages, `clientSchema`/`locationSchema` + actions + permissions
  unchanged.

## Supplier Orders (Purchase Orders)
- **Models**: `SupplierOrder` and `SupplierOrderItem`
- **Enums**: `SupplierOrderType` (PURCHASE, SUBHIRE, REPAIR, OTHER), `SupplierOrderStatus` (DRAFT, SUBMITTED, CONFIRMED, PARTIAL, RECEIVED, CANCELLED)
- **Convex functions**: `convex/supplierOrders.ts` (reads: `list`, `getById`, `listBySupplier`; mutations: `create`, `update`, `remove`) + `convex/supplierOrdersWrites.ts` (browser-direct: `createNative`) — full CRUD for orders and items
- **Order fields**: orderNumber (unique per org), type, status, dates, financials (Decimal), supplierId, projectId, createdById, notes
- **Order items**: description, quantity, unitPrice, lineTotal (auto-calculated), modelId, assetId, notes, sortOrder
- **Auto-calculations**: `recalculateOrderTotals()` sums item lineTotals, applies 10% GST
- **Status shortcuts**: Setting to RECEIVED auto-sets receivedDate
- **Asset integration**: `purchaseOrderNumber` and `supplierOrderId` on Asset
- **Line item integration**: `subhireOrderNumber` and `supplierOrderId` on ProjectLineItem
- **New-order page** (`suppliers/[id]/orders/new/page.tsx`): a PAGE smart form on the
  shared `SmartFormLayout` shell, modelled on `asset-form.tsx`/`client-form.tsx`. Order
  (PO/reference + type + status via registry `Select` with explicit `SelectValue`
  children, replacing the old raw `<select>` elements) → Dates (order + expected) →
  More details (notes). Helper rail = contextual tip + a live order summary (reference,
  supplier name, type chip, status pill via `StatusIndicator`, expected date). The
  supplier-not-found / loading states, breadcrumb, hidden `supplierId` scoping field,
  `supplierOrderSchema`, the create action and the `supplier:create` gate are
  unchanged — markup/layout pass only. (This page exposes only the order header; line
  items are added on the order after creation.)
