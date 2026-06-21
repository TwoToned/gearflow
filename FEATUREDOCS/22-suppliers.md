# Suppliers & Purchase Orders

## Suppliers
- **Routes**: `/suppliers` (list), `/suppliers/[id]` (detail), `/suppliers/[id]/edit`, `/suppliers/new`, `/suppliers/[id]/orders/new`
- **Fields**: name (required), contactName, email, phone, website, address, notes, accountNumber, paymentTerms, defaultLeadTime, tags, isActive
- **Server actions**: `src/server/suppliers.ts` — `getSuppliers()`, `getSuppliersPaginated()`, `getSupplierById()`, `getSupplierAssets()`, `getSupplierSubhires()`, `createSupplier()`, `updateSupplier()`, `deleteSupplier()`
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
- **Server actions**: `src/server/supplier-orders.ts` — full CRUD for orders and items
- **Order fields**: orderNumber (unique per org), type, status, dates, financials (Decimal), supplierId, projectId, createdById, notes
- **Order items**: description, quantity, unitPrice, lineTotal (auto-calculated), modelId, assetId, notes, sortOrder
- **Auto-calculations**: `recalculateOrderTotals()` sums item lineTotals, applies 10% GST
- **Status shortcuts**: Setting to RECEIVED auto-sets receivedDate
- **Asset integration**: `purchaseOrderNumber` and `supplierOrderId` on Asset
- **Line item integration**: `subhireOrderNumber` and `supplierOrderId` on ProjectLineItem
