# Asset Management System

## Three Asset Types
1. **Serialized** (`Asset`): Individually tracked, unique tag, has status lifecycle
2. **Bulk** (`BulkAsset`): Quantity-tracked, `totalQuantity`/`availableQuantity`
3. **Kit** (`Kit`): Container of serialized + bulk assets (see [kits.md](./09-kits.md))

## Auto-Incrementing Tags
Stored in `Organization.metadata` JSON:
```json
{ "assetTagPrefix": "TTP", "assetTagDigits": 5, "assetTagCounter": 42 }
```
- `peekNextAssetTags(count)` — Read-only preview for form pre-fill (no increment)
- `reserveAssetTags(count)` — Atomic increment, called ONLY after successful creation
- Users can override suggested tags. Adding/removing form rows doesn't burn numbers

## Asset Record Page (`/assets/registry/[id]`)
The serialized-asset detail page mirrors the approved project-detail "bar"
(`projects/[id]` + `project-lifecycle.tsx`). Layout/composition only — all data,
mutations, handlers and permission gates are unchanged.

- **Hero card** — breadcrumb, photo (`MediaThumbnail`, `resolveAssetPhotoUrl`),
  big `font-display text-page-title` identity, meta line (tag `t-mono` · category ·
  model link), asset + condition status pills, and a prominent **"where is it
  now?"** locator line derived from `status` + the active (`CHECKED_OUT`,
  not-yet-returned) `lineItem` + home `location`: "Deployed on {project}" /
  "Available · {home location}" / "In maintenance" / status + location fallback.
  Actions: comments, **QR** (Popover holding `AssetQRCode`, moved out of the
  tabs), **Edit**, and a single `⋯` overflow `DropdownMenu` for Force-return
  (CHECKED_OUT only) / Archive (isActive only) / Delete — all behind
  `CanDo resource="asset" action="update"`.
- **Tabs (6, down from 8)** — History (default; project check-out **timeline**,
  not a table) · Availability (real `BookingCalendar`) · Maintenance (table-fixed
  grid) · Checks (`AssetChecksTab`) · **Files** (merged Photos + Model documents)
  · Notes. The old standalone QR tab is gone (QR → hero); Photos + Documents
  merged into Files.
- **Sidebar (4 calm `SidebarSection`s)** — Details (tag/serial/barcode/category/
  model/condition/purchase/cost/supplier/warranty, plus folded Test & tag) ·
  Location (home location + parent-of / accessories manager) · Specs (model
  specifications + operator custom fields, hidden when empty) · Activity
  (`ActivityTimeline`). Unset rows are omitted or show one faint "Not set" —
  no stacks of em-dashes. `KvRow` helper renders the compact key·value rows.

Bulk assets still redirect to the model page; the not-found / loading states are
unchanged.

## Asset Status Lifecycle
```
AVAILABLE → CHECKED_OUT (via warehouse checkout)
AVAILABLE → IN_MAINTENANCE (via maintenance record)
AVAILABLE → RESERVED (manual)
CHECKED_OUT → AVAILABLE (check in with GOOD condition)
CHECKED_OUT → IN_MAINTENANCE (check in with DAMAGED condition)
CHECKED_OUT → LOST (check in with MISSING condition)
IN_MAINTENANCE → AVAILABLE (maintenance completed)
Any → RETIRED (manual)
```

## Categories
- **Routes**: `/assets/categories` (list table), `/assets/categories/[id]` (detail page)
- **Hierarchy**: Self-referential `parentId` on Category model. Table view indents children under parents.
- **Relations**: Category → Model[], Category → Kit[], Category → children Category[]
- **Detail page**: Subcategories grid + tabbed Models/Kits tables with counts
- **Permissions**: Uses `"model"` resource (no dedicated category permission resource)
- **Sidebar**: Under Assets with `Tags` icon, `resource: "model"`
