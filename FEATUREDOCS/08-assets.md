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

## Smart Asset Form (`AssetForm`)
`src/components/assets/asset-form.tsx` — the create/edit form for serialized
assets, served by `/assets/registry/new` and `/assets/registry/[id]/edit` (the
bulk path routes to `BulkAssetForm`, now also on the shared shell — see below).
This is the **reference
"smart single-page form"** that sets the bar for the app's moderate forms —
modelled on the new-project wizard's quality (helper rail, smart inputs, inline
quick-create, RVLT tokens, fun microcopy) but as ONE clean page, not multi-step.

- **Layout** — two columns (`lg:grid-cols-[1fr_280px]`): the form card (`1fr`) +
  a sticky **helper rail** (`hidden lg:block`, drops on mobile). The new/edit
  pages widen the serialized container to `max-w-5xl` (bulk stays `max-w-3xl`).
- **Sections** (flat, `border-t` separators, no per-section card):
  1. **Identity** — Equipment model, asset tag / serial (+ multi-asset add-rows),
     custom name.
  2. **Condition & location** — status, condition, location.
  3. **Purchase** — purchase date, price, supplier, PO# (revealed when a supplier
     is set), warranty expiry.
  4. **More details** — custom fields + notes + tags, collapsed by default in a
     registry `Accordion` (progressive disclosure; the common case is fast).
- **Smart inputs:**
  - Model — `ComboboxPicker` (searchable). No quick-create-model component exists,
    so the picker's "＋ New model" routes to `/assets/models/new`.
  - Asset tag — `AssetTagInput` (mono), pre-filled via `peekNextAssetTags(1)`
    (preview only, no counter burn). The `+`-button multi-asset branch is intact.
  - Location / Supplier — `ComboboxPicker` with inline quick-create
    (`QuickCreateLocation` / `QuickCreateSupplier`).
  - Status / Condition — registry `Select` with explicit `SelectValue` children
    from `assetStatusLabels` / `conditionLabels`.
- **Helper rail** — a Kalam (`font-hand text-t-out`) contextual tip that changes
  with progress, plus a **live preview**: a mini gear card that updates as you
  type (model image or `Package` placeholder, model/custom name, asset tag in
  mono, and a `StatusIndicator` pill driven by the chosen status).
- **Preserved:** same `assetSchema` (unchanged), same `createAsset` /
  `createAssets` / `updateAsset` server actions, same persisted fields, the
  bulk-create extra-rows path, and the permission gates on the route pages.

### Shared shell — `SmartFormLayout`
`src/components/ui/smart-form.tsx` extracts the asset-form scaffold into a
reusable shell so other moderate forms get the same quality without
reimplementing it. `asset-form.tsx` is intentionally **not** refactored onto it
(the approved reference stays as-is); the shell is for the directory forms
(client / supplier — see [22-suppliers](./22-suppliers.md) — and location), the
crew-member form (see [31-crew-management](./31-crew-management.md)), the
**model form** (`model-form.tsx`), and future forms.

The **model form** (`/assets/models/new` + `/assets/models/[id]/edit`, both
render `ModelForm` — edit pre-fills, reusing create) uses the shell with these
sections: Identity (name, manufacturer, model number, SKU, category via
`ComboboxPicker` with inline `QuickCreateCategory`, asset-type `Select`,
description) → Pricing (daily/weekly/monthly rate card with the suggested-rate
"Apply 4×/12× daily" buttons, purchase price, replacement cost) → Compliance &
technical (weight, power draw, maintenance interval, requires-test-and-tag with
nested test-profile picker + validity) → "More details" accordion (relocated
`SpecificationsEditor`, tags, active switch). Live preview: a model card
(image/`Package` placeholder + manufacturer-prefixed name + category chip +
daily-rate line). The old native asset-type `<select>` is now a shadcn `Select`
with explicit `SelectValue` children. Same `createModel`/`updateModel` actions,
schema (`modelSchema`), fields, and `model` create/update permission gates.

The **bulk asset form** (`bulk-asset-form.tsx`, served by
`/assets/registry/new?type=bulk` + the bulk branch of `/assets/registry/[id]/edit`)
also uses the shell: Identity (model `ComboboxPicker` with inline "＋ New model"
routing to `/assets/models/new`, asset tag pre-filled via `peekNextAssetTags(1)`,
total quantity) → Status & location (status `Select`, location `ComboboxPicker`
with inline `QuickCreateLocation`) → "More details" accordion (price per unit,
notes, tags). Live preview: a bulk-stock card (model image/`Layers` placeholder +
model name + ×quantity + status pill via `StatusIndicator category="bulkAsset"`).
The old native status `<select>` is now a shadcn `Select` with explicit
`SelectValue` children from `bulkAssetStatusLabels`. Same `createBulkAsset`/
`updateBulkAsset` actions, schema (`bulkAssetSchema`), fields, and permission gates.

- `SmartFormLayout` — owns the `grid gap-6 lg:grid-cols-[1fr_300px]`, the
  left-hand card surface, and the sticky `hidden lg:block` rail. The rail content
  is entity-specific, passed via the `aside` slot. Spreads remaining props onto
  the `<form>` (e.g. `onSubmit`).
- `SmartFormRail` — overline eyebrow + Kalam (`font-hand text-t-out`) tip.
- `SmartFormPreview` — the "Preview" overline + divider wrapper for the live card.
- `SmartFormSection` — flat section (title + hint, `border-t` divider; pass
  `divider={false}` for the first one).
- `SmartFormField` — `Label` + control + hint/error (`text-t-out`, no personality
  copy per §9).

## Asset Registry List (`/assets/registry`)
The list page (`page.tsx`) is a thin auth-gated wrapper that renders `<AssetsView />`.

- **`AssetsView`** (`src/components/assets/assets-view.tsx`) — a Grid⇄Table
  segmented toggle (`aria-pressed` + `focusRing`), persisted to localStorage key
  `assets-view-mode`, **defaulting to Grid** (the visual gear-library is the point).
  Mirrors the projects Board⇄Table pattern (`projects/projects-view.tsx`). In Grid
  mode the toggle is injected into the gallery toolbar; in Table mode it sits above
  the table's own toolbar.
- **Grid — `AssetGallery`** (`src/components/assets/asset-gallery.tsx`) — a
  responsive card grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`)
  grouped by category under a calm `t-overline` muted overline (uncategorised last).
  Each card: cover photo on top (same resolver as the table — asset's own primary
  photo, then the model's; falls back to a tokenised `ImageIcon` placeholder), model
  name (truncate), asset tag (`t-mono`), a status pill (`getStatusColor("asset", …)`
  via `StatusIndicator`), and a muted condition · location line. Whole card is a
  focus-ringed `<Link href="/assets/registry/{id}">` with the RVLT hard-shadow lift.
  Read-only browse surface: carries its **own** search box + the New-asset action.
- **Table — `AssetTable`** (unchanged) — the dense power view: serialized/bulk
  toggle, column filters, saved views, bulk-select + bulk-edit, force-return, and
  CSV import/export. All existing behaviour preserved.
- **Shared data source:** both views read the SAME reactive Convex source
  (`useAssets(orgId)`) and the SAME cross-domain photo query
  (`getAssetRegistryPhotos()`), enriched identically (model + category + location +
  primary media), so they always show the same serialized assets. The Gallery only
  shows serialized assets (the visual library); bulk assets remain Table-only.
  Filters/bulk/CSV are intentionally **not** shared into the Gallery — the Grid
  keeps its own client-side search only.

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
