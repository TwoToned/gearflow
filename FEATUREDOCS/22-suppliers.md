# Suppliers & Purchase Orders

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-25 (review quarterly — POLICY.md R-5.5)_

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
- **Models**: `SupplierOrder` and `SupplierOrderItem` (Convex tables, `convex/schema.ts`)
- **Enums**: `SupplierOrderType` (PURCHASE, SUBHIRE, REPAIR, LABOUR, OTHER), `SupplierOrderStatus` (DRAFT, ORDERED, PARTIAL, RECEIVED, CANCELLED) — **doc-drift correction (WS7 #946):** this previously listed SUBMITTED/CONFIRMED, which were never the real enum values (`convex/lib/validators.ts`'s `SupplierOrderStatus`); the status machine is `DRAFT → ORDERED → PARTIAL → RECEIVED`, with `CANCELLED` reachable from any non-terminal state (`VALID_TRANSITIONS` in `convex/supplierOrdersWrites.ts`).
- **Convex functions**: `convex/supplierOrders.ts` (service-only generated CRUD + the browser-readable `listBySupplier`/`getDetail` composite reads) + `convex/supplierOrdersWrites.ts` (browser-direct: `createNative`, `updateNative`, `deleteNative`, `attachInvoiceNative`, `removeInvoiceNative`) + `convex/supplierOrderItemsWrites.ts` (browser-direct item CRUD: `addSupplierOrderItemNative`/`updateSupplierOrderItemNative`/`removeSupplierOrderItemNative`/`reorderSupplierOrderItemsNative`) — full lifecycle as of WS7 #946 (previously read + invoice-attach only; header edit, delete, and ALL item writes did not exist).
- **Order fields**: orderNumber (unique per org — WS7 #946 added the org-scoped uniqueness check `createNative` had been missing), type, status, dates, financials, supplierId, projectId, createdById, notes, `invoiceFileId` (issue #789 — see Invoice attachment below), `supplierOrderId` link from `subHires` (WS7 #946 — see [39-sub-hires](./39-sub-hires.md#purchase-order-link-ws7-946))
- **Order items**: description, quantity, unitPrice, lineTotal (auto-calculated server-side = quantity × unitPrice, never client-trusted — R-9.3), modelId, assetId, notes, sortOrder
- **Auto-calculations**: `recalcOrderTotals` (`convex/lib/recalcOrderTotals.ts`, WS7 #946) sums item lineTotals into `subtotal`, applies the **org's registered default tax rate** (`orgSettings.defaultTaxRate ?? 10` — NOT a hard-coded 10%, correcting the prior claim) to get `taxAmount`, and `total = subtotal + taxAmount`. Runs after every `supplierOrderItemsWrites.ts` add/update/remove (not reorder — reordering doesn't change money). Before WS7 #946 this function was documented but **did not exist** — supplier "Spend" was structurally $0 (see the Spend rollups below).
- **Header edit**: `supplierOrdersWrites.updateNative` (WS7 #946) — status (machine-guarded, resubmitting the same status is a no-op-allowed edit), orderDate, expectedDate, notes. `orderNumber`/`type`/`supplierId`/`projectId` are fixed at creation.
- **Status shortcuts**: Setting to RECEIVED auto-sets `receivedDate` (transition-only — re-saving the header while already RECEIVED does not re-stamp it)
- **Delete**: `supplierOrdersWrites.deleteNative` (WS7 #946) — refuses to delete an order with any asset (`assets.by_supplierOrderId`) or sub-hire (`subHires.by_supplierOrderId`) still linked to it; otherwise cascades the order's own items + invoice file. `supplier:delete`.
- **Asset integration**: `purchaseOrderNumber` and `supplierOrderId` on Asset — see the
  order-number combobox below for how these two fields are now kept in sync.
- **Line item integration**: `subhireOrderNumber` and `supplierOrderId` on ProjectLineItem
- **Type labels**: `supplierOrderTypeLabels` (`src/lib/status-labels.ts`) is the single
  source of truth for PURCHASE/SUBHIRE/REPAIR/LABOUR/OTHER display labels — the
  new-order page, the supplier detail Orders tab, and the order detail page all import
  it rather than hand-copying a local `ORDER_TYPE_LABELS` map (R-3.1; this consolidated
  three previously-independent copies in the 2026-07-25 pass).
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

### Order-number combobox on the asset form (issue #789)
`AssetForm`'s "Order #" field (`src/components/assets/asset-form.tsx`, Purchase
section) is a `ComboboxPicker` — not a free-text `Input` — scoped to the currently
selected supplier's own orders:
- **Options** come from `useSupplierOrdersBySupplier(orgId, supplierId)`
  (`src/hooks/use-supplier-orders.ts`, a reactive wrapper over
  `supplierOrders.listBySupplier`), so the list updates live as orders are created for
  that supplier in another tab.
- **Selecting an existing order** sets `supplierOrderId` on the asset (and mirrors
  `orderNumber` into the legacy `purchaseOrderNumber` string field for display/back-
  compat). If `purchasePrice`/`purchaseDate` are still empty, they're pre-filled from
  the order's `total`/`orderDate` — a convenience, not a link; editing them afterwards
  doesn't write back to the order.
- **Creating a new order** is the picker's `onCreateNew` action, which opens
  `QuickCreateSupplierOrder` (`src/components/assets/quick-create-supplier-order.tsx`)
  — the same inline-dialog pattern as `QuickCreateLocation`/`QuickCreateSupplier`
  (order number + type, supplier locked to the one already selected on the asset
  form). On create it calls `useSupplierOrderWrites().create()` (same
  `supplierOrdersWrites.createNative` mutation the full new-order page uses) and wires
  the result back into `supplierOrderId`/`purchaseOrderNumber`.
- **Changing or clearing the supplier** clears `supplierOrderId`/`purchaseOrderNumber`
  too — an order link only makes sense for the supplier it was scoped to.
- **Legacy data**: an asset with a free-typed `purchaseOrderNumber` but no
  `supplierOrderId` (pre-#789 data) shows that old value as a hint under the now-empty
  combobox rather than silently dropping it — the user picks or creates a real linked
  order to replace it.
- Built on **Radix** `ComboboxPicker`, not Base UI — required since `AssetForm` can
  render inside a modal `Dialog` (see the composition note in CLAUDE.md / FEATUREDOCS/07).
- `assetWrites.createNative`/`createManyNative`/`updateNative` org-validate
  `supplierOrderId` against `supplierOrders` via `assertRefInOrg` (by_cuid is a GLOBAL
  index) exactly like the existing `supplierId`/`locationId`/`kitId` checks.

### Order detail page (issue #789)
`suppliers/[id]/orders/[orderId]/page.tsx` — reachable by clicking an order's number
in the supplier detail page's Orders tab (both the desktop table and the
`MobileCardList` card). `RequirePermission resource="supplier" action="read"`.
- **Data**: `convex/supplierOrders.ts`'s `getDetail` query (browser-readable, org-
  checked) — one round trip for the order header, supplier name, project ref, every
  `supplierOrderItems` row (with `model`/`asset` names resolved), every asset linked
  via `assets.by_supplierOrderId` (distinct from line items — an asset can be linked
  through the asset-form combobox without ever becoming a line item, and vice versa),
  and the attached invoice file's metadata. Consumed reactively via
  `useSupplierOrderDetail` (`src/hooks/use-supplier-orders.ts`).
  **Returns `null` for a missing/cross-org order rather than throwing** — unlike
  `suppliers.detail` (which throws and is only ever read one-shot via
  `convex.query()`), this query is read through the reactive
  `useAuthedQuery`/`useQuery`, and a thrown `ConvexError` from a live subscription is
  an uncaught error that crashes the page (see `src/hooks/use-authed-query.ts`'s
  docstring on this exact crash class). The page renders that `null` as a normal
  "Order not found" state.
- **Layout**: `DetailLayout`/`DetailMain`/`DetailSidebar`/`SidebarSection` (the shared
  detail-page shell) — hero card (breadcrumb, order number, type badge, status pill,
  at-a-glance stats: item count / asset count / total / expected date) → main column
  (Line items table, Linked assets table) → sidebar (Order info: type/status/dates/
  financials/notes; Invoice).
- **Header edit + delete (WS7 #946)**: the Actions dropdown next to the order number
  (mirrors the supplier detail page's pattern) opens `OrderEditDialog` (status Select
  + order/expected date inputs + notes textarea, calling `useSupplierOrderWrites().update`
  → `supplierOrdersWrites.updateNative`) or `DeleteDialog` (→ `.remove()` →
  `deleteNative`, `supplier:delete`, blocked server-side if the order has a linked
  asset or sub-hire). This closes the gap #789 had left open (previously documented
  here as "Not built").

### Invoice attachment (issue #789)
An order has at most one invoice, so it's a plain 1:1 FK
(`supplierOrders.invoiceFileId → fileUploads.id`) — **not** a `*Media` join table.
`convex/mediaWrites.ts`'s generic add/remove/setPrimary/reorder dispatch (see
FEATUREDOCS/18) exists for genuine many-file galleries with primary-photo semantics;
reusing it for a field that can only ever hold zero-or-one file would be
over-engineering the wrong cardinality (R-3.1 — model the actual shape).
- **Upload**: the sidebar's "Upload invoice" button posts to the existing
  `POST /api/uploads` route (`folder: "supplier-order-invoices"`, `entityId: orderId`)
  — the same S3→Convex-storage pipeline every other attachment uses (FEATUREDOCS/18) —
  then calls `supplierOrdersWrites.attachInvoiceNative` to link the resulting
  `fileUploads.id` onto the order.
- **Mutations** (`convex/supplierOrdersWrites.ts`): `attachInvoiceNative` /
  `removeInvoiceNative`. Both gate on `supplier:update` (the order's parent resource —
  there's no separate `supplierOrder` RBAC resource), org-check the order and the file,
  and write an atomic audit row (`"Attached invoice to order …"` /
  `"Removed invoice from order …"`). Replacing an existing invoice (or removing one)
  deletes the superseded file's stored bytes + `storedFiles` record + `fileUploads` row
  (mirrors `files.deleteFile` / `mediaWrites.removeNative` — no ref-counting needed
  since `invoiceFileId` is that file's only referrer).
- **View**: the order detail page's Invoice sidebar section links directly to the
  file's `/api/files/{storageId}` proxy URL (from the `fileUploads` row `getDetail`
  already resolved server-side — the browser never calls `fileUploads.*` directly,
  since those reads are service-only).
- **Remove**: gated the same way as upload (`CanDo resource="supplier" action="update"`).

### Order line-item CRUD (WS7 #946)
`convex/supplierOrderItemsWrites.ts` — there was previously **no browser path at
all** for `supplierOrderItems` (the table existed with a schema and a service-only
generated CRUD file, but nothing could add/edit/remove a line item on a purchase
order from the app). Mirrors `subHireItems`' add/update/remove/reorder shape in
`convex/subHiresWrites.ts`:
- `addSupplierOrderItemNative` / `updateSupplierOrderItemNative` — `lineTotal` is
  always computed server-side (`quantity × unitPrice`), never trusted from the
  client (R-9.3); both call `recalcOrderTotals` afterward.
- `removeSupplierOrderItemNative` — deletes the item, then `recalcOrderTotals`.
- `reorderSupplierOrderItemsNative` — sortOrder only, no money change, no audit
  (parity with `reorderSubHireItemsNative`).
- All four gate on `supplier:update` (no separate `supplierOrderItem` RBAC
  resource — the spec decision to stay on the `supplier` resource, matching the
  invoice-attach precedent above).
- `useSupplierOrderWrites()` (`src/hooks/use-supplier-order-writes.ts`) wraps all
  four with `supplierOrderItemSchema.parse()` before submit.

### Supplier spend rollups (WS7 #946)
`suppliers.detail` (`convex/suppliers.ts`) gains a `spend` object, shown on the
supplier detail page's hero strip (headline "Spend" figure) and a dedicated
"Spend" sidebar section (breakdown):

- **`committedOrderSpend`** — sum of `order.total` for orders with status
  ORDERED/PARTIAL/RECEIVED (DRAFT is a quote, not yet committed; CANCELLED never
  happened).
- **`subHireSpend`** — sum of `subHire.totalCost` for sub-hire heads with status
  NOT IN (DRAFT, CANCELLED) — the same "active cost" convention `recalc.ts`'s
  `subHireCostTotal` uses.
- **`totalSpend`** — the two above, **de-duplicated for linked pairs**: a sub-hire
  linked to a committed order (via `subHires.supplierOrderId`) counts ONCE — at the
  order's `total` if it's RECEIVED (now invoiced), else at the sub-hire's quoted
  `totalCost` (not invoiced yet). Unlinked orders/sub-hires count normally. The
  de-dup algorithm is `convex/suppliers.ts`'s exported `computeSupplierSpend` (a
  plain function, unit-testable without a Convex harness — see
  `convex/suppliers.test.ts`'s dedup fixture).
- **`openOrderCount`** — orders with status DRAFT/ORDERED/PARTIAL (not yet
  RECEIVED or CANCELLED).
- **`variance`** — `{ total, linkedCount }` across every linked pair (regardless of
  order status): `order.total - subHire.totalCost` once the order carries a total.
  Informational only — never feeds the P&L (see [10-projects](./10-projects.md#operational-pl-panel)).

**Subhires tab (visible behaviour change)**: `suppliers.subhiresPage` now returns
sub-hire **heads** (order #, status, cost/charge/margin, project, linked PO)
instead of the old `projectLineItems`-based read, which could only show a raw line
item (model/description/qty) with no order-level cost/charge/margin/status. See
[39-sub-hires](./39-sub-hires.md#purchase-order-link-ws7-946) for the FK this
connects to.
