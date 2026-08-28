# Child Assets / Accessories

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

Permanently attach accessories (cables, clamps, adaptors) to a parent serialised
asset so they travel together — onto projects, through warehouse checkout/checkin,
and onto documents. Roadmap Phase 1.1; foundational for Bulk Check-In (1.3).

**Issue #794 ("Redo accessories")** reworked the office-side of this: model
accessories now have a `DEFAULT`/`OPTIONAL` tier, the PM gets an add-time picker
(deselect defaults, opt into optionals) instead of the old all-or-nothing
"Include accessories" checkbox, and the choice is durable per-line
(`accessoryPlan`) rather than re-derived from raw config at every expansion —
which also fixed a real bug where warehouse checkout could silently resurrect an
accessory the PM had deselected. Full design + competitive research:
`docs/designs/accessories-v2.md`.

**Follow-up (same issue, second pass)** shipped three more pieces the first
pass left open: (1) the main warehouse page's Pick/Prep, Deploy, and Return
tabs now render accessory parents as an expandable group with per-child verify
circles, exactly like a kit — see "Deploy/return/prep/de-prep tabs" below; (2)
deselecting a DEFAULT accessory on the add-form now requires a confirm + typed
reason instead of a bare checkbox — see "Add-form DEFAULT-removal friction"
below; (3) Deploy now soft-blocks when a parent's DEFAULT accessories aren't
packed yet, and asks for a reason when OPTIONALs are skipped — see "Checkout
accessory gate" below.

Accessories are **not kits**. A kit is a physical container with its own asset
tag and rental contract; an accessory is inseparable from its parent — no
container, no separate booking, no separate price. The implementation is
**unit-native** (built on `ProjectLineItemUnit`), distinct from the kit
mechanism but reusing its parent/child *line-item* shape.

## Data model

- **`Asset.parentAssetId`** — self-relation (`onDelete: SetNull`). A serialised
  child has exactly one parent. Parents are always serialised (Asset rows).
- **`AssetBulkChild`** — join table for bulk accessories (e.g. "2 clamps"), with
  `quantity` and `allocationMode`. Asset-level — overrides the model template
  for the same `bulkAssetId`.
- **`ModelBulkAccessory`** — join table for **model-level** default bulk
  accessories. "Every asset of this model ships with N of this bulk asset."
  Unique on `(modelId, bulkAssetId)`. Inheritance kicks in at project
  expansion: both office add and warehouse scan-time union the asset's own
  bulk children with the model's defaults, deduped by `bulkAssetId` (asset
  wins on conflict). Always SHIPS_WITH — DEDICATED at the model level would
  drain the whole shelf in one click. Bulk only at the model level; serialised
  accessories stay asset-level (you can't pick "the" specific cable for every
  asset of a model).
  - **`inclusion`: `"DEFAULT" | "OPTIONAL"`** (issue #794). Absent = `DEFAULT`
    (zero-migration back-compat). `DEFAULT` auto-attaches when the model is
    added to a project (the PM can deselect it per line — see `accessoryPlan`
    below). `OPTIONAL` never auto-attaches; it's offered as an opt-in pick in
    the add-time picker. `ModelAccessoriesManager` (Model detail page) has a
    Default/Optional select on add, plus an edit action (`updateNative`, the
    quantity/inclusion/notes patch mutation that used to be a dead end — the
    dup-guard's "Edit the quantity instead" error now has somewhere to go).

## Per-line accessory selection (`accessoryPlan`) — issue #794

`ProjectLineItem.accessoryPlan` is the durable, per-line override of the model
template: `{ excluded: string[]; added: { bulkAssetId, quantityPerParent? }[] }`.
`excluded` holds `bulkAssetId`s of model DEFAULTs the PM deselected for *this*
line only (the model template is untouched); `added` holds model OPTIONALs the
PM opted into, with an optional per-parent quantity override. Absent plan (the
common case, unaffected by this feature) means template behaviour: every
DEFAULT, no OPTIONALs — existing lines and rows never touched by the picker
behave exactly as before.

**One resolver, three call sites.** `resolveLineAccessoryPlan(ctx, orgId,
assetId, plan)` (`convex/lib/fulfillment.ts`) computes the effective set —
asset-level serialised + bulk children (always included, no plan control) ∪
model DEFAULTs minus `plan.excluded` ∪ model OPTIONALs in `plan.added` (asset
still wins `bulkAssetId` conflicts). It replaced the old `resolveAssetAccessories`
(which unioned every model bulk accessory regardless of tier) and is now the
*only* place that reads `modelBulkAccessories` for expansion purposes.
`expandAccessoryChildLines` (office add, both the by-asset and by-model
branches) and `expandAccessoriesForAsset` (warehouse prep/checkout) both call
it with the line's own `accessoryPlan` — no site is allowed to re-derive the
set from raw config, which is what let a deselected default resurrect itself
at checkout before this fix (see "Exclude accessories" below).

**`ProjectLineItem.accessoryInclusion`** (follow-up) — a denormalized copy of
the tier (`"DEFAULT" | "OPTIONAL"`), stamped directly onto each accessory
CHILD line at creation/reconcile time by every insert site in
`convex/lib/fulfillment.ts` (`resolveLineAccessoryPlan`'s asset-level bulk
children are always `"DEFAULT"` — physical attachment, no tier control;
model-level bulk children take the resolved `inclusion`) plus
`reconcileLineAccessoryChildren`'s insert/rescale helpers. Exists so warehouse
checkout gating (below) can read a child's tier straight off the row without
re-resolving the parent's `accessoryPlan`/model config — the same "one
resolver" principle applied to the read side. `rescaleKeptBulkChild` also
re-syncs an existing child's `accessoryInclusion` on reconcile, so a model
config change (DEFAULT → OPTIONAL after the line was added) doesn't leave a
stale tier on an already-expanded child.

**Where it's set / edited:**
- **Add-time** — `equipment-add-form.tsx` renders an inline "Accessories"
  section (both by-model and by-asset-tag add) whenever the chosen model has
  any `modelBulkAccessories` row: DEFAULTs pre-checked (unchecking records an
  exclusion), OPTIONALs unchecked (checking opts in). No section when the
  model has none. `checkAvailability`/`lookupAssetByTag` both return an
  `accessories: ModelAccessoryDetail[]` list (resolved bulk-asset tag + model
  name) for the picker. The computed plan is submitted as a top-level
  `accessoryPlan` arg on `addLineItemSmartNative`/`addNative`, stored on the
  new parent row, and passed straight through to `expandAccessoryChildLines`.
  **DEFAULT-removal friction (follow-up):** deselecting a DEFAULT accessory no
  longer excludes it immediately — it opens a confirm dialog requiring a typed
  reason before the exclusion takes effect (re-checking the box clears the
  stored reason with no prompt). OPTIONAL accessories are unaffected — still a
  plain, frictionless checkbox, since opting IN needs no justification.
  `AccessoryPlanInput`/`AccessoryPlanArg` gained `excludedReasons:
  { bulkAssetId, reason }[]`, submitted alongside `excluded`/`added`.
  `lineItemWrites.ts`'s `logExcludedDefaultAccessories` writes one distinct
  activity-log entry per reasoned exclusion (`"Removed default accessory
  <tag> from <line>: <reason>"`), wired into `addNative`,
  `addLineItemSmartNative`, and `updateAccessoryPlanNative` right after each's
  existing add/edit audit entry — so the "why" is visible in the trail next to
  the "what changed", not just on the plan itself.
- **Post-add** — `lineItemWrites.updateAccessoryPlanNative` reconciles an
  existing line's children to a new plan (`reconcileLineAccessoryChildren`):
  creates newly-added children, deletes newly-excluded ones (and their
  units), rescales a kept bulk child's quantity if the line quantity or
  override changed. **Hard-blocks** once any unit of the *parent* line has
  deployed (`checkedOutQuantity > 0` or `status === "CHECKED_OUT"`), and
  separately refuses to delete a child that itself has a `CHECKED_OUT` unit —
  "office decides, warehouse verifies" holds even for edits. No row-menu
  entry point wired into `equipment-rows.tsx` yet — the mutation exists and
  is tested, but reopening the picker from the project equipment tab is a
  follow-up (TODOS.md).
- **Simplification vs. the full design** (`docs/designs/accessories-v2.md`):
  the add-form picker surfaces the model's DEFAULT/OPTIONAL bulk accessories
  only — it does not additionally list the specific asset's own
  serialised/bulk children as a read-only "attached to this unit" group on a
  by-asset-tag add. Those still always auto-attach (unaffected, no plan
  control), just not shown in the picker UI itself.
- **`AccessoryAllocationMode`** — `SHIPS_WITH` (default) | `DEDICATED`.
  - `SHIPS_WITH`: the parent "ships with" N of a bulk asset; the N are drawn
    from the live pool at prep/checkout (a normal booking). The shared pool is
    **not** decremented at attach time. Default because a zip-tied clamp is not
    a sealed-container kit item — permanently draining the pool for idle parents
    creates false shortages.
  - `DEDICATED`: N are pulled out of the shared pool at attach (guarded
    `adjustBulkAvailability`) and restored on detach/remove.
- **`ProjectLineItem.childKind`** — `KIT | ACCESSORY`. See the critical
  convention below.

## The `isKitChild` + `childKind` convention (read before touching filters)

`isKitChild: true` is the **structural** "this is a non-top-level child" flag.
It is set on kit children, sub-hire group children, **and** accessory children.
The ~40 `where: { isKitChild: false }` filters across the app (project totals,
item counts, warehouse displays) rely on it to exclude every kind of child from
top-level aggregates. Accessories set `isKitChild: true` so they inherit that
exclusion **with zero migration**.

`childKind` is the **behaviour** discriminator — it distinguishes kit-vs-accessory
where rendering or logic differs (PDF label/bold, `removeLineItem` error copy,
the warehouse cascade, scan routing). Do **not** migrate the structural filters
to `parentLineItemId != null`; `isKitChild` already covers the same set and is
what every existing query keys off.

## Flow

1. **Attach** (asset-level — browser-direct [`convex/assetAccessoriesWrites.ts`](../convex/assetAccessoriesWrites.ts),
   formerly `src/server/asset-accessories.ts`) — `addSerializedNative`,
   `addBulkNative` (was `addSerializedChildToAsset`/`addBulkChildToAsset`), plus
   `removeSerializedNative`/`removeBulkNative` (detach). Guards:
   self/nesting/already-attached, kit↔accessory dual membership (symmetric
   check in `kits.ts`), one-level-deep, cross-org. UI:
   `AssetAccessoriesManager` on the asset detail page.

   **Attach (model-level — browser-direct [`convex/modelBulkAccessoriesWrites.ts`](../convex/modelBulkAccessoriesWrites.ts),
   formerly `src/server/model-accessories.ts`)** —
   `addNative` / `removeNative` (was `addModelBulkAccessory` / `removeModelBulkAccessory`). The unique
   `(modelId, bulkAssetId)` constraint surfaces as `ACCESSORY_DUPLICATE`. UI:
   `ModelAccessoriesManager` on the Model detail page. Removing a model
   accessory after a project has already expanded it does NOT retroactively
   delete the project line item — it's a concrete row at that point.
2. **Onto a project** — two entry points, both producing accessory child lines
   (`isKitChild:true`, `childKind:ACCESSORY`, `parentLineItemId`) AND both
   unioning the asset's own bulk children with the asset's model's
   `bulkAccessories`, deduped by `bulkAssetId` so asset-level overrides win
   on conflict:
   - Office, **specific asset**: adding a specific serialised asset
     (`expandAccessoryChildLines`, ported to [`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts) —
     formerly `expandAccessoryChildren` in `src/server/line-items.ts`) auto-expands
     its serialised + bulk children, atomic with the parent line.
   - Office, **by model** (the common quoting flow): adding a line *by model*
     (no specific asset) expands the **model's** default bulk accessories
     (`ModelBulkAccessory`), quantity scaled by the line quantity (`2x IMX6A` →
     `2x` of each model accessory), so the accessory shows on the project +
     documents immediately. Serialised asset-level accessories can't expand here
     (no specific asset is picked) — they materialise at warehouse prep.
   - Warehouse: assigning a specific unit to a *model-level* line at prep or
     deploy (`expandAccessoriesForAsset`, [`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts) —
     formerly `src/lib/line-item-fulfillment.ts` — hooked
     into `prepUnit` (same file, called from `convex/checkRecordOps.ts`) +
     `checkOutItems`). Idempotent — dedups serialised by
     assetId, bulk by bulkAssetId (the `(parentLineItemId, bulkAssetId)` unique
     index backstops it), and **reconciles** the office-created model-accessory
     row's quantity to the units actually assigned. So re-scans don't duplicate.
   **Known limitation:** the quantity-merge path in `addLineItem` (adding the
   same model again increments an existing line) does not re-scale the accessory
   child; and changing a line's quantity later doesn't retroactively rescale.
   Add the full quantity in one go for an exact accessory count.
   No units created at expansion — units stay lazy-at-prep. `removeLineItem`
   cascade-deletes children (transactional) and blocks direct child removal.
3. **Warehouse** (`src/server/warehouse.ts`) — `lookupAssetForScan` returns
   `type: "asset_child"` ("scan the parent") for a scanned accessory.
   `checkOutItems`/`checkInItems` cascade the parent's deploy/return to accessory
   child lines through the same unit path (`ensureSerialisedUnit` /
   `ensureBulkUnit` / `returnLineUnits`) inside the parent's transaction. The
   return cascade lives in `convex/lib/fulfillment.ts:checkinAccessoryChildren`
   (formerly `line-item-fulfillment.ts`; shared, not warehouse-private) so the
   **check-and-store** return flow (browser-direct
   `convex/checkRecordWrites.ts:completeCheckAndStore`, formerly
   `check-records.ts:completeCheckAndStore`) cascades too — any code path that
   returns a parent must call it, or accessories stick at `CHECKED_OUT`.
   `completeCheckAndDeprep` resets accessory children `prepStatus` so they don't
   linger on the deploy-staging board.

   **Pick sheets** — accessories hang off a normal top-level asset line (not a
   kit), so both the interactive (`online-pick-list.tsx`) and printable
   (`pull-sheet/page.tsx`) sheets render them indented under their parent,
   badged "Accessory", and count them in pick progress. The `getProjectPullSheet`
   filter drops accessory rows from the flat list (`isKitChild:true`) — they
   travel on the parent's `childLineItems` instead. Detect a renderable
   accessory child by `childKind === "ACCESSORY"`.

   **Project equipment table** (`equipment-rows.tsx`) — `describeRow` treats an
   accessory parent (top-level asset line, no `kitId`, has `ACCESSORY` children)
   as an expandable parent so its children render indented like kit members,
   each badged "Accessory". Accessory children are hidden from the flat list by
   `isHiddenFromList` (they're `isKitChild:true`).

   **Deploy/return/prep/de-prep tabs (main warehouse page) — shipped.**
   `src/app/(app)/warehouse/[projectId]/page.tsx`'s `groupItems`/
   `groupCheckinItems` now detect an accessory parent (`isAccessoryParent` in
   `warehouse-types.ts`: top-level, no `kitId`, has an `ACCESSORY` child) and
   emit a fifth `GroupEntry` kind, `"accessory-group"` — inserted in the same
   priority slot as `kit-group` (checked before `isBulkItem`), so a
   multi-quantity model-level accessory parent is never misclassified as a
   plain bulk line. `PickPrepTab`/`DeployTab`/`ReturnTab` (desktop table +
   mobile card variants, 6 render sites total) render `"accessory-group"` with
   the same `KitChildRows`/`MobileKitChildCards` components kits use (already
   `childKind === "ACCESSORY"`-badge-aware from the first pass) — an "Accessories"
   badge instead of "Kit", the parent's own asset tag instead of a kit tag, but
   the same expand/collapse, the same `collectAllVerifiableIds`-driven
   "X/Y verified" badge, and the same verify-circle interaction.

   **Stage membership: own state OR child state (bugfix).** The five
   equipment-stage predicates (`isInPickPrepStage`/`isInPreppedStage`/
   `isInReturnedStage`/`isInDeprepedStage`/`isInCheckedOutStage` in
   `warehouse-types.ts`) first shipped by generalizing `isKitParent`'s
   children-only rollup check to accessory parents too — this was a
   **production bug**: a kit parent line has no prep/deploy state of its own
   (a synthetic rollup), but an accessory parent IS a real, independently
   fulfilled asset — gating it purely on its accessory's status made the
   parent vanish from Pick/Prep or Deploy the moment its own state and its
   accessory's state diverged (the normal case once prep/deploy move
   independently). Fixed by extracting the five predicates as pure, unit-tested
   functions where an accessory parent's membership is "own status/prepStatus
   OR any accessory child's" — kit parents are untouched. The accessory-parent
   branches also deliberately skip the early-return on the parent's own
   `CHECKED_OUT`/`RETURNED` status that every other branch takes, for the
   partial-deploy case described next.

   **"Deploy Verified Only" / "Deploy All" — shipped (issue #794's remaining
   acceptance criterion).** Deploying an accessory parent whose PACKED
   accessories are only partially click-to-verified opens a `kitConfirm`-style
   choice: "Deploy Verified Only" cascades just the verified subset via
   `checkOutItems`'s `includeAccessoryIds` (translated from `verifiedKitItems`'
   line-item ids to the accessories' own asset/bulkAsset identities — the
   mutation's allow-list expects the latter), "Deploy All" cascades everything
   as before. Picking "Verified Only" deploys the parent while the unverified
   accessory stays PACKED-but-not-deployed — findable again in the Deploy tab
   (per the stage-membership fix above) so the operator can re-select the same
   (already-deployed) line and deploy again later; `checkOutItems` no-ops the
   already-deployed asset and cascades whatever's still outstanding.

   **Prep-time asset picker — accessory checkbox removed.** The "Assign
   assets" dialog (`handleAssetPickerConfirm` flow) used to call
   `getAssetAccessories` once a specific serialised asset was picked and show
   a per-accessory "Include accessories" checkbox list — the exact "asks about
   accessories in the prep menu" behaviour this follow-up removes. Accessories
   are no longer a prep-time toggle: they pack in full (mirroring a kit's
   members) and the checkout gate below decides what's actually missing.
   `getAssetAccessories` (`src/server/check-records.ts`) had no other caller
   and was deleted rather than left as dead code; `includeAccessoryIds` stays
   wired through `prepItemDirect`/`prepItemsBatch`/the check-item queue for
   other callers, it's just never populated by the removed UI now (always
   `undefined` ⇒ "include all", the documented default).
4. **PDFs** — accessories render indented under the parent, gated by the same
   `showKitChildren` flag as kit children (2026-07-27 — previously always-on
   regardless of the flag). An accessory parent is detected by "top-level
   line, no `kitId`, has `ACCESSORY` children"; both the render
   (`gearflow-table.ts`) and the height calc (`document-composer.ts`'s
   `calculateItemHeight`) handle it, so children are reserved and never
   tail-dropped on the doc types that show them. Warehouse docs
   (packing-list/return-sheet/delivery-docket) keep `showKitChildren: true`,
   so packers still see every accessory; quote/invoice set it `false` to keep
   the client-facing table to top-level line items — see `document-layouts.ts`'s
   `clientFacingTable` and FEATUREDOCS/13-pdfs.md.

   **Grouped accessory parents (the two-level case).** When an accessory parent is
   a **project-group member**, `structureLineItems` nests it as the synthetic
   group row's `childLineItems`, so the accessory parent is a *child* and its
   accessories are *grandchildren*. The plugin/height previously only recursed
   into grandchildren for nested kits (`child.kitId`), silently dropping a grouped
   accessory parent's accessories. Both `gearflow-table.ts` and `section-renderer.ts`
   now also recurse when a child is an accessory parent (`!child.kitId` +
   `childKind:ACCESSORY` grandchildren). Tested via the grouped-member case in
   `accessories-render.test.ts`.

   **Per-unit on packing docs.** On packing-list/pull-slip docs (showPerUnitCheckboxes),
   a qty>1 accessory expands into one checkable line per unit — an accessory is
   just an auto-added asset, so it gets the same per-unit treatment a real asset
   row does. This holds even when the accessory is a grandchild (its parent is a
   group member): `gearflow-table.ts` draws the per-unit lines and
   `section-renderer.ts` reserves their height.

## Tests

> The `src/server/*.int.test.ts` Prisma integration tests below were removed
> along with the server actions they covered. Equivalent coverage now lives in
> `convex/assetAccessoriesWrites.test.ts` (attach/detach, both allocation modes,
> guards) and `convex/modelBulkAccessoriesWrites.test.ts` (model inheritance).
> Project-expansion and checkout/checkin-cascade coverage is folded into the
> broader `convex/lineItemWrites.test.ts` / `convex/warehouseWrites.test.ts` /
> `convex/checkRecordWrites.test.ts` suites rather than dedicated accessory files.
> `src/components/warehouse/accessory-child-rows.test.ts` could not be located in
> current code — see the "Deploy/return tabs" caveat above.

- `src/server/asset-accessories.int.test.ts` — attach/detach, both allocation
  modes, rollback, all guards (10).
- `src/server/project-accessories.int.test.ts` — project expansion, cascade
  delete, child-removal block, totals exclusion (5).
- `src/server/warehouse-accessories.int.test.ts` — checkout/checkin cascade,
  check-and-store cascade, scan-the-parent (6).
- `src/components/projects/equipment-rows.test.ts` — `describeRow` accessory
  parent → expandable; `isHiddenFromList` nests accessory children (4).
- `src/components/warehouse/accessory-child-rows.test.ts` — `getAccessoryChildren`
  mode filtering for the deploy/return tabs (4).
- `src/lib/pdfme/plugins/accessories-render.test.ts` — full pipeline: filter →
  indented render → height reservation (3).
- `src/server/model-accessories.int.test.ts` — model inheritance: office add,
  asset override wins, warehouse scan-time inheritance + idempotency, unique
  constraint, "removing the template doesn't affect past expansions" (5).
- `convex/lineItemWrites.test.ts` (`excludedReasons audit trail`) —
  reasoned-removal writes a distinct audit entry; no reason ⇒ no extra entry;
  empty reason rejected (3).
- `src/components/warehouse/warehouse-types.test.ts` — `isAccessoryParent`,
  `accessoryChildrenOf`; the five stage predicates' "own state OR child
  state" rule for accessory parents vs. kit parents' children-only rollup,
  including the left-behind-accessory-after-partial-deploy case (22).
- `convex/warehouseWrites.test.ts` (`logAccessoryCheckoutOverride`) — writes
  both the activity log and the line's `notes`; appends rather than
  overwrites existing notes; empty reason rejected; cross-org line silently
  skipped; viewer denied (5).

## Exclude accessories toggle (retired from the office add flow — issue #794)

Both `addLineItem`/`addLineItemSmartNative` and `checkOutItems` still accept the
boolean `includeAccessories` parameter (default `true`), and both mutations still
gate the whole expansion call on it. But **the office add form no longer has an
"Include accessories" checkbox** — it always passes `includeAccessories: true` and
controls inclusion per-accessory through `accessoryPlan` instead ("exclude
everything" is now just a plan that excludes every DEFAULT). The boolean is kept
for API/import callers that don't have a plan to offer (bulk-import flows, the
`requireService` mirror `createLineItem`) — passing `false` still skips expansion
entirely, same as before.

- **`checkOutItems(projectId, items, includeAccessories)`** — when `false`, skips
  `expandAccessoriesForAsset` and `checkoutAccessoryChildren` so no accessories
  are deployed at all. When `true` (the office-flow default), each item MAY also
  carry a per-item `includeAccessoryIds: string[]` allow-list — the "Deploy
  Verified Only" narrowing kits already have — which further restricts *which*
  accessories cascade for that specific checkout call (see `resolveLineAccessoryPlan`
  above for how the effective set itself is computed). No warehouse tab UI drives
  `includeAccessoryIds` yet; it's plumbed and tested at the mutation layer only.

`hasAccessories` (on `checkAvailability`/`lookupAssetByTag`) is superseded by the
richer `accessories: ModelAccessoryDetail[]` list the same two functions now also
return, which drives the add-form picker.

## Checkout accessory gate (follow-up)

Deploying a line whose accessories aren't packed no longer cascades silently.
`handleCheckOutSelected` (main warehouse page) computes, for every
about-to-deploy parent, which of its `accessoryChildrenOf` children aren't yet
`prepStatus === "PACKED"` (and aren't `CANCELLED`/already `CHECKED_OUT`) —
`computeMissingAccessories`. A DEFAULT-tier miss is a **soft block**: a dialog
opens instead of deploying, listing the missing DEFAULTs and requiring a typed
reason (or, for a manager-tier role — `owner`/`admin`/`manager`, via
`useCurrentRole()` — the reason field is pre-filled and the operator can
confirm immediately). An OPTIONAL-tier miss doesn't block at all, but does ask
for a reason: a preset dropdown ("Out of stock" / "Not needed for this job" /
"Customer declined" / "Other") plus an optional free-text note. Confirming
either kind runs `warehouseWrites.logAccessoryCheckoutOverride` — a new
`convex/warehouseWrites.ts` mutation that writes the reason to **both** the
activity log (one entry per skipped accessory, e.g. `"Deployed <parent>
without default accessory <name>: <reason>"`) and that accessory child line's
own `notes` field (merge-appended, same "join with `; `" convention as custom
line item notes) — then the resent `checkOutItems` call carries an
`includeAccessoryIds` narrowed to every accessory child of the deploying
parent(s) **except** the ones just declared missing (computed client-side from
`accessoryChildrenOf` minus the skipped set, translated to asset/bulk-asset
identity the same way `findPartiallyVerifiedAccessoryParent` does).

This narrowing is load-bearing for a **bulk** DEFAULT accessory (e.g. a
battery-kit template accessory) that was already added to the project at
add-time but never packed: the "no unit to flip" assumption above only holds
for a *serialised* accessory. A bulk one gets its unit **materialised at
checkout time** by `expandAccessoriesForAsset` regardless of prep state (it's
how a never-touched DEFAULT bulk accessory ever gets a unit at all), and
`checkoutAccessoryChildren` immediately flips whatever unit exists — so
without the narrowing, the very accessory the operator just said was missing
got silently checked out anyway in the same call. `includeAccessoryIds` is
exactly the existing "verified subset" filter both of those functions already
respect (issue #794's partial-deploy escape hatch), so no new gate was needed
on the Convex side — the client just wasn't setting it on the override path.

## Not in v1

Bulk parents (only serialised assets can be parents), nested accessories,
per-accessory pricing (`unitPrice` is nullable so a future ITEMIZED mode is a
data change), kit↔accessory conversion, a `MANDATORY` inclusion tier, serialised
*model-level* accessories, `DEDICATED` re-enable in the office UI, and return-side
partial cascade (issue #794 scopes the "Deploy Verified Only" narrowing — and
the accessory-parent stage-membership OR-with-own-state rule it depends on —
to deploy/checkout only; return behaviour is unchanged).

## Multi-quantity / model-level parents

A multi-quantity / model-level parent line (one `ProjectLineItem`, `quantity > 1`,
specific units assigned per-unit at prep/checkout) accumulates one accessory child
set per assigned parent unit. These are handled per-unit:

- **Per-unit return scoping.** `checkinAccessoryChildren` takes a `returnedAssetId`.
  On a per-unit return (`checkInItems`/`completeCheckAndStore` with a scanned
  asset) only that unit's accessories return — **serialised** children whose
  accessory `asset.parentAssetId === returnedAssetId`, plus the returned unit's
  **per-unit share** of each bulk accessory (a partial `returnLineUnits`, so the
  bulk child flips to RETURNED only once every parent unit is back). A whole-line
  return (no `returnedAssetId`) returns every child in full. So returning Light A
  no longer returns Light B's still-deployed cable, and a DAMAGED return only
  maintenance-routes the returned unit's accessories. `completeCheckAndDeprep`
  scopes its `prepStatus` reset the same way (serialised by `parentAssetId` +
  shared bulk rows).
- **Bulk demand scales with units.** `expandAccessoriesForAsset` keeps ONE bulk
  child per `bulkAssetId` but recomputes its quantity as the total demand across
  every assigned parent unit (qty-N line × 1 clamp each → bulk child quantity N).
  Recompute (not increment) keeps it idempotent under re-scans. Checkout syncs the
  bulk unit quantity from the child, so it tracks demand as units deploy.
- **Expansion race closed.** Partial unique indexes (migration
  `20260605120000_accessory_child_unique_index`) on `(parentLineItemId, assetId)`
  and `(parentLineItemId, bulkAssetId)` where `childKind = 'ACCESSORY'` backstop
  the read-before-create; the create catches the violation (`isUniqueViolation`)
  and falls back to an update. Prisma's DSL can't express partial indexes, so they
  are raw-SQL only and not in `schema.prisma` (see the migration's note on
  `migrate dev` drift).
- **`bulk-group` tab rendering.** `AccessoryChildRows` was wired into the
  `bulk-group` branch of the deploy/return tabs too, so a multi-qty serialised
  model line (which `groupItems` classifies `bulk-group`) shows its accessories
  — see the "Deploy/return tabs" caveat above; this component no longer exists
  under that name and current behaviour is unverified.

`resolveAssetAccessories` is the shared per-asset profile (serialised children +
bulk accessories, asset-level unioned with model-level) used by both expansion and
the per-unit return scoping. Tests: the multi-quantity isolation block in
`warehouse-accessories.int.test.ts` (return-isolation, DAMAGED + MISSING
isolation, mixed-condition batch, whole-line return, bulk scale + per-unit return,
double-check-in no over-return, idempotent re-scan, savepoint recovery).

**Concurrency & idempotency.** This domain now lives in Convex
([`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts), ported from
`src/lib/line-item-fulfillment.ts`); the two Postgres-specific tricks below no
longer apply as described — the file's header comment notes both collapse for
free under Convex's per-document serializable mutations:
- Accessory child creation is backstopped by the partial unique indexes (below);
  `createAccessoryChildIfAbsent` is now a plain check-then-insert — a concurrent
  racer serializes and the loser re-reads, no SAVEPOINT needed (Postgres
  previously wrapped each create in a SAVEPOINT so a 23505 conflict didn't
  poison the whole interactive transaction).
- `expandAccessoriesForAsset` no longer needs the Postgres `FOR UPDATE` row lock
  on the parent line — a Convex mutation is serialised for free, so two stations
  expanding different units of the same line still serialize and bulk demand
  sees every committed sibling (no concurrent undercount). Demand excludes
  RETURNED / CANCELLED units.
- The return cascade only fires when the parent return actually flipped a unit
  (`unitsFlipped > 0`), so a retry / double-scan can't re-return the shared bulk
  accessory.

**Known edge cases (bulk only; serialised is exact).** Bulk demand and the
per-unit return share are recomputed live from current config, not snapshotted at
checkout, so a **config edit mid-deployment** (changing/removing a model/asset
bulk accessory qty) only reconciles on the next expansion of a unit that still
ships it. An **orphaned serialised accessory** (parent asset deleted →
`parentAssetId` null) returns only via a whole-line return, not a per-unit scan.
**Per-unit deprep** clears every bulk accessory row's `prepStatus` (bulk rows are
shared) — staging-board cosmetic only. The robust fix is to snapshot each unit's
accessory contribution at deploy; tracked in TODOS.md.

**Still out of scope (pre-existing, untouched):** `checkOutItems` fetches+updates
an asset by global `assetId` without re-scoping to `organizationId` (cross-tenant
write risk), and accessories are materialised after the T&T checkout preflight
(`assertTestTagAllowsCheckout`) so a non-compliant accessory can deploy unchecked.
Both are tracked in TODOS.md.

**Perf note:** bulk demand recompute resolves each distinct parent-unit asset once
per expansion call (O(units) per call, O(units²) over a full multi-unit deploy).
Fine for typical rental line sizes; revisit if very large lines appear.
