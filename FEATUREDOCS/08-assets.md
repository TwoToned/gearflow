# Asset Management System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-27 (review quarterly — POLICY.md R-5.5)_

## Three Asset Types
1. **Serialized** (`Asset`): Individually tracked, unique tag, has status lifecycle
2. **Bulk** (`BulkAsset`): Quantity-tracked, `totalQuantity`/`availableQuantity`
3. **Kit** (`Kit`): Container of serialized + bulk assets (see [kits.md](./09-kits.md))

### ⚠️ Stock-type resolution — `model.assetType` may be absent OR a stale label
`Model.assetType` is `v.optional` in the Convex schema, so older / backfilled model
docs read back `undefined`. Every stock/availability computation used to coerce it
with `assetType ?? "SERIALIZED"` — which sent a genuine BULK model down the
serialized branch of `computeStockBreakdown` (`totalStock = assets.length = 0`, since
a bulk model has no serialized assets), so **every bulk line showed "0 available"**
and was spuriously overbooked. Use **`resolveModelAssetType(assetType, hasBulkAssets,
hasAssets)`** (`src/lib/overbooking-core.ts`) instead of the `?? "SERIALIZED"` default
at every stock site: it returns a present value unchanged and falls back to `BULK`
only when the model has active bulk assets. Applied at all five computation sites —
`overbooking-core.ts` (`reconstructOverbookedStatus`), `line-items.ts` (`addLineItem`
/ `updateLineItem` / `checkAvailability`), and `server/availability.ts` (calendar
stock). Regression: `overbooking-core.test.ts`. Follow-up (durable, needs a prod
backfill): always-write `assetType` on the model mirror so no consumer has to guess —
`models-read.ts` mapping a lone doc still can't resolve without the bulk-asset signal.

**gearflow#801:** the undefined-only fallback above never fires for a *new* model,
because `model-form.tsx`'s create form defaults `assetType` to an EXPLICIT
`"SERIALIZED"` (there's a Serialized/Bulk selector, but Serialized is what you get
unless you deliberately switch it) — so a model stocked exclusively with bulk assets
and never switched away from the default reads back `assetType: "SERIALIZED"`,
present not absent, and stayed stuck at `available: 0` forever. `hasAssets` (the
model's active serialized-asset count) closes that gap: an explicit `"SERIALIZED"`
label is only overridden to `"BULK"` when the model has real bulk stock AND zero
actual serialized assets — the one case where the label can't possibly be right,
since a model with genuine serialized assets keeps its explicit label untouched.
Regression: `overbooking-core.test.ts` / `convex/availabilityCore.test.ts`.

## Auto-Incrementing Tags
Stored in `Organization.metadata` JSON:
```json
{ "assetTagPrefix": "TTP", "assetTagDigits": 5, "assetTagCounter": 42 }
```
- `peekNextAssetTags(count)` — Read-only preview for form pre-fill (no increment)
- `reserveAssetTags(count)` — Atomic increment, called ONLY after successful creation
- Users can override suggested tags. Adding/removing form rows doesn't burn numbers

## Asset form rules (the old `AssetForm`, now `AssetSheet`)
**Superseded (UX Phase 12):** `asset-form.tsx` and `bulk-asset-form.tsx` and their
`/new` + `/edit` pages are gone; the same fields, schemas and rules live in
`AssetSheet` (see "AssetSheet" below). The notes on this page about the helper rail
and live preview describe the old full-page form, which no longer exists (the preview
rail is dropped); the field rules (tag pre-fill, supplier-scoped order combobox,
custom fields, tags) still hold.

Historical note, the old form was the **reference
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

## Asset Registry List (`/assets/registry`) — ListPage (#1393, spec 9b)
`AssetsList` (`src/components/assets/assets-list.tsx`) is the registry on the shared `ListPage`
(FEATUREDOCS/25); `AssetsView`/`AssetTable` below are RETIRED (their dialogs live in
`bulk-asset-dialogs.tsx`). **Table is the default (D12)**; `Table · Grid` words, the choice kept
in localStorage `assets-view-mode`. The URL is the state: `seg`, `q`, `kind=bulk`, `status`,
`condition`, `loc`, `cat`, `tag`, `model`, `sort`, `page`, `view=grid`. Config in
`src/lib/list-views/assets.ts`, row menu in `src/lib/row-actions/asset.ts`.

- **Kind** filter word switches `assets.listPage` (serialized) and `bulkAssets.listPage` (bulk).
  Segments: All, Available, On jobs, In maintenance, Retired, **Due for T&T**, **Needs attention**
  (serialized only; bulk has All + Retired). Derived on read in `convex/lib/assetAttention.ts`.
- **Columns:** Tag (thumbnail via `LineRowList`'s `leading` slot) · Model (category, tags) ·
  Serial · Status · Condition · Location · Next due · On job (from `assets.rowExtras`, gated per
  field on `testTag`/`project` read; `requireOrgReadFor` + RBAC); Tags opt-in.
- **Bulk:** Edit…, Add tag…, Force return (only when a selected asset is deployed), Retire
  (`archiveNative` through the shared `useRetireAssets` closure: one exact Undo for the selection,
  see "Retire, Reinstate and Delete" below). Page ⋯: Export / Import CSV (formula-safe). Primary
  `New asset` (`?type=` follows the kind), `n` kept.
- **Saved views:** URL mode; old rows' `locationId/categoryId/tags` keys map to `loc/cat/tag`.
- **Deferred:** Group control, mixed serialized/bulk list, dashboard tiles, Value/Owner columns
  (no gate / no stored field), bulk Assign PM / bulk Print labels / Schedule service (no
  mutation), bulk-kind bulk verbs.

The sections below describe the pre-6b implementation and its data sources (still accurate for
`assets.listPage`, `bulkAssets.listPage`, `assets.listGallery`).

The old list page (`page.tsx`) was a thin auth-gated wrapper that rendered `<AssetsView />`.

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
- **Table — `AssetTable`** — the dense power view: serialized/bulk toggle, column
  filters, saved views, bulk-select + bulk-edit, force-return, and CSV import/export.
- **Data source (2026-07, perf fix — see `docs/designs/perf-convex-efficiency-2026-06.md`
  Finding #1):** the two views no longer share one whole-org reactive subscription.
  `AssetTable` calls `assets.listPage`/`bulkAssets.listPage` (server-side filter/sort/
  paginate, joins done in Convex) via `useAuthedQuery` — only the current page's rows
  are subscribed to, not the whole org table. `AssetGallery` calls `assets.listGallery`
  (also server-side, but unpaginated — it's a "browse everything, grouped by category"
  view, not a table, so pagination doesn't fit; still reads every active asset in one
  query instead of the old 4 separate whole-org subscriptions it used to mount). Both
  still merge in the same cross-domain photo query (`assets.registryPhotos`) separately,
  client-side. The two views are no longer guaranteed byte-identical (each runs its own
  query with its own filter logic), but both source from the same underlying `assets`
  table so they show the same serialized assets in practice. The Gallery only shows
  serialized assets (the visual library); bulk assets remain Table-only. Filters/bulk/CSV
  are intentionally **not** shared into the Gallery — the Grid keeps its own search only.

## Asset Record Page (`/assets/registry/[id]`)
UX Phase 12 (§9d, D30-D34): a record page in the calm language of the job page.
`page.tsx` is a thin wrapper; the page is `src/components/assets/detail/`
(`asset-detail.tsx`, `asset-overview.tsx`, `asset-tab-bodies.tsx`,
`asset-dialogs-host.tsx`, `asset-facts.tsx`).

- **Header** (`DetailHeader`): the tag as the title (`AURA-01`), a dot-word status,
  and a muted identity line (custom name · model link · category · home location);
  breadcrumb from `PageMeta`. One primary, `Edit` (opens `AssetSheet`, `?edit=1`, key
  `e`). Everything else is in ⋯ (`buildAssetPageActions`, absent-not-disabled):
  `Scan a tag…` (key `/`) · Move to… · Schedule service… · New asset like this… (key
  `n`) · Report issue… · Print label… · Force return… (only when deployed) ·
  Retire…, last and red (a retired unit shows Reinstate…). **Delete is not in the
  menu**: it is a second step inside the Retire dialog, and only for a unit with no
  history (`facts.canDelete`, the server's rule). On a phone the sticky primary is
  `Scan` (Edit moves to ⋯).
- **Tabs** are controlled by `?tab=` (`src/lib/asset-tabs.ts`; an unknown or
  unavailable key lands on Overview): Overview · Availability · Checks · Maintenance
  `n` · History `n` · Notes · Files `n`. The strip has underlined words with counts.
- **Overview** shows no table. The health checklist (`assetHealth()`, `ChecklistSection`:
  `Ready to go` / `Nearly ready` / `Can't go out`, `n of m checks clear`, each
  non-clear row with one action, the clear ones as a muted line), then `Now · Last
  scan · Value` (`asset-facts.tsx`: one component each, the same ones the context
  rail prints on every other tab, so nothing shows twice), the identity, and the
  accessories as rows (`AssetAccessoriesManager`, read-only for callers without
  `asset:update`). `Last scan` is read from records that already exist (scan logs and
  check records); there is no scan-write. Cost is printed only when the server sent
  it (absent for a `noFinancials` key). Flow stores no owner, so there is none.
- **Where is it now** (`src/lib/asset-whereabouts.ts`): deployed (job link) /
  maintenance / available / **sold on job** (WS11) / status + home. ONE function.
- **Bookings** feed the double-booked row: `availability.assetBookings` over the next
  year (stable window), counted by `countOverlappingBookings`. Until the read lands
  the row says `not checked`.
- **Tab bodies**: Availability keeps `BookingCalendar` (`?date=` still seeds it); Checks
  is `AssetChecksTab`; Maintenance, History (jobs + the activity feed, `All · Jobs ·
  Changes`, `Show 8 more · n left`, bounded at 60 with `jobsTruncated`) and Files are
  rows; Notes holds the note (`NotesEditor`) and the discussion.
- **Edit and create** are `AssetSheet` (see below). `/assets/registry/[id]/edit`
  redirects to `?edit=1` (bulk: to the model page's `?edit-asset=`), and
  `/assets/registry/new` redirects to the Assets list's `?new=serialized|bulk`.
- **Scan** is the page's `ScanTarget`: the same tag just confirms (a toast, no write),
  a different tag opens that asset, an unknown tag says so. The camera is the shell's
  (`CameraScannerDialog`, opened from the tap).
- **Move to…** is one field through `updateNative` (so it has the exact edit Undo);
  **Schedule service…** creates a scheduled PREVENTATIVE maintenance job (Undo:
  `undoCreate`); **Print label…** is a browser-print QR sheet (no PDF type).
- Not built yet (deferred, listed in the PR): the 8-week lane strip on Availability,
  bulk Mark done / Reschedule on Maintenance, bulk actions on Files, the `Changes`
  filter beyond the activity feed.

Bulk stock has no page of its own: `?type=bulk` forwards to its model's page.

## AssetSheet (create and edit, UX Phase 12, D62/D63)

`src/components/assets/asset-sheet.tsx` on `FormSheet` replaces `asset-form`,
`bulk-asset-form` and their pages. Create offers the words `Serialised unit · Bulk
stock`; edit opens the record's own kind. Sections in the live order (Identity ·
Condition & location · Purchase and more details; bulk: Identity · Status & location ·
More), inline errors as you type (tag required / ≤ 50 / unique, price ≥ 0 or blank,
warranty not before purchase, bulk quantity ≥ 1 on create). `Save and add another`
keeps the model, location and condition, advances the tag and clears the serial (it
replaces the old add-row buttons). Edit saves with the exact Undo
(`updateNative` writes the before/after snapshot, `undoUpdateNative` reverses it);
create's Undo removes exactly the unit it made. The sheet holds every field the write
sets (notes, tags, images, custom fields), so an edit never clears what the Notes tab
or the registry owns. The activation hand-off (`Create your first job`), the quick-create
dialogs and the onboarding tour anchor are kept.

## Retire, Reinstate and Delete (UX Phase 12, D32/D33)

- **Retire** (the verb formerly called Archive; `assetWrites.archiveNative` and
  `bulkAssetsWrites.archiveNative`) sets `status: RETIRED` + `isActive: false` and retires the
  unit's linked T&T rows (`retireAssetCore`). Availability, "short by 1" and the jobs that hold
  the unit follow from the status (derived); nothing else is written. A deployed unit is warned
  about in the dialog. **Retire writes an exact-Undo snapshot into its own audit row**
  (`convex/lib/fieldEditUndo.ts`: before/after of `status` / `isActive`, plus the T&T rows it
  changed). `undoRetireNative({ id, auditId })` takes ids only and refuses (changing nothing)
  unless it is within 10 minutes (server clock), the caller is the author, it is the first Undo,
  and the asset and its T&T rows are still exactly as the Retire left them.
- **Reinstate** (`reinstateNative`) sets `isActive: true`, status `AVAILABLE`. T&T rows are NOT
  revived (the health checklist then reads `not registered` with `Register`). It has its own
  Undo through the same `undoRetireNative`.
- **One closure:** `src/hooks/use-retire-assets.ts` is the only caller of these writes for the
  Assets list, the asset page and the model page; its toast Undo reverses exactly the rows that
  call changed, each from its own audit id, and skips rows that were already retired.
- **Delete is only for a bare row** (`convex/lib/assetHistory.ts`, ONE rule): on a job, a
  maintenance link, a recorded T&T test, a check record, a scan log, a kit membership or an
  attached accessory each make the unit "has history" and `deleteNative` throws
  `ASSET_HAS_HISTORY` (the same rule gates bulk stock). Edits and Retire audit rows are not
  history. Delete has no Undo.
- **Model Archive is a true soft archive (behaviour change, owner ruling Q-S1).**
  `modelWrites.archiveNative` used to hard-DELETE every asset and bulk asset of the model; it
  now only sets `isActive: false`: the model leaves new quotes and pickers, its assets stay,
  units out finish on their jobs, reservations hold, quotes are unchanged. `restoreNative`
  (`Restore model`) brings it back; both are audited with the same exact-Undo snapshot
  (`undoArchiveNative`). API/MCP callers see the changed summary and the `undoable` return.
- **Cost fields** (`purchasePrice`, the model's `replacementCost` / `defaultPurchasePrice`,
  `fleetCost`) are ABSENT for a `noFinancials` API key on `assetDetail.bundle`,
  `roi.getModelRoi` and `roi.fleetInventory` (`convex/lib/gearCostFields.ts`).
- **`assetHealth()`** (`convex/lib/assetHealth.ts`, pure, derived on read): the asset Overview
  checklist (test & tag, service, condition, whereabouts, double bookings, open repairs). A
  check that cannot run says `not checked` and never passes; a unit with anything unchecked
  never reads `Ready to go`.
- **Blank money stays blank** on the model, asset and bulk schemas (`blankableNumber`,
  `src/lib/validations/blankable.ts`).

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
Any → SOLD (sell-from-rental-stock, FROM_RENTAL_STOCK sale mode only — WS11 #950)
SOLD → AVAILABLE ("un-sell", explicit reversal)
```

**`SOLD` (WS11 #950)** is a second terminal status alongside `RETIRED`: set when a
serialized asset is sold out of the rental fleet via a `SALE` line item with
`saleMode: "FROM_RENTAL_STOCK"` (`sellSerializedAssetForSale`,
`convex/lib/saleStock.ts`), and it flips `isActive: false` the same way
`archiveNative`'s RETIRED path does, so dashboard counters and fleet ROI's
`isActive` filter drop the unit for free (see FEATUREDOCS/57). Unlike RETIRED,
SOLD has a dedicated, explicit reversal — the "un-sell" action
(`unsellSerializedAsset` / `unsellLineItemNative`) flips it back to
`AVAILABLE` with `isActive: true`. See FEATUREDOCS/67 for the full sales
line-item design.

## Categories
- **Routes**: `/assets/categories` (list table), `/assets/categories/[id]` (detail page)
- **Hierarchy**: Self-referential `parentId` on Category model. Table view indents children under parents.
- **Relations**: Category → Model[], Category → Kit[], Category → children Category[]
- **Detail page**: Subcategories grid + tabbed Models/Kits tables with counts
- **Permissions**: Uses `"model"` resource (no dedicated category permission resource)
- **Sidebar**: Under Assets with `Tags` icon, `resource: "model"`
