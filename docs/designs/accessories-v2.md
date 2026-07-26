# Accessories v2 — office-first selection, warehouse kit-parity

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-07-26
**Driver:** [Issue #794](https://github.com/TwoToned/gearflow/issues/794) — "Redo accessories:
PM-selectable optional accessories at add-time, removable defaults, warehouse treats like
kits". Jayden: "fully redream how accessories currently work… I hate that it's currently
mostly managed in the warehouse view."
**Related:** [FEATUREDOCS/48](../../FEATUREDOCS/48-child-assets-accessories.md) (owning doc),
[FEATUREDOCS/12](../../FEATUREDOCS/12-warehouse.md) (kit verification / deploy),
TODOS.md § accessories.

**Implementation status (2026-07-26):** Rollout phases 1–2 (schema + config,
office selection incl. the checkout-honours-plan fix) shipped in full. Phase 3
(warehouse parity) shipped partially — Online Pick List + Pull Sheet render/count
accessories correctly now (closes the un-completable progress bug), and
`KitChildRows` has an Accessory badge, but the main warehouse page's
Deploy/Return/Prep/De-prep tabs do **not** yet group accessory parents like kits
(no verification circles, no "Deploy Verified Only" dialog there) — see
FEATUREDOCS/48's "Deploy/return/prep/de-prep tabs" note for the confirmed
current state. The post-add "Edit accessories" mutation
(`updateAccessoryPlanNative`) is implemented and tested but has no row-menu entry
point yet. Phase 4 (this doc + FEATUREDOCS/48 + FEATUREDOCS/12) is done; the
per-file PDF five-consumer audit found no `DocumentLineItem` shape change was
needed (phases 1–3 don't touch which line items exist by the time PDFs render,
only which accessories cascade at office-add/checkout time). Both left off here
are tracked as explicit follow-ups, not silent gaps.

## Problem

Accessories are configured per model (`ModelBulkAccessory`) and per asset
(`Asset.parentAssetId`, `AssetBulkChild`), then expand onto projects automatically. The
PM's *only* control is a one-shot, all-or-nothing "Include accessories" checkbox at
add-time (`equipment-add-form.tsx`). There is no optional tier, no per-accessory choice,
no per-line override of defaults, and no way to edit the selection after the line exists.

Meanwhile the warehouse — the place the PM shouldn't have to think about — holds the only
real per-accessory UI in the app, and it's broken in three load-bearing ways found during
the current-state audit (2026-07-26):

1. **Prep selection is silently overridden at checkout.** The prep asset-picker dialog
   (`warehouse/[projectId]/page.tsx:2945-2971`) lets the operator untick accessories via
   `includeAccessoryIds`, but `finalizeCheckoutItem` (`convex/warehouseOps.ts:166-180`)
   re-runs `expandAccessoriesForAsset` with **no** filter and checks everything out anyway.
   The one control that exists doesn't stick.
2. **Accessory children are invisible in every warehouse tab.** `equipmentItems`
   (page.tsx:1400-1407) drops all `isKitChild` lines with `subHireId:null`, which is every
   accessory child. No rows, no verification circles, no partial deploy — the kit
   machinery (`verifiedKitItems`, `collectAllVerifiableIds`, "Deploy Verified Only")
   never sees them. The `AccessoryChildRows` component FEATUREDOCS/48 describes no longer
   exists (doc section flagged ⚠️ stale; TODOS.md:511).
3. **The pick-list progress bar is un-completable on any project with accessories.**
   `pick-list-progress.ts:48-54` counts accessory children in the denominator via
   `getAccessoryChildren`, but neither `online-pick-list.tsx:162-164` nor
   `pull-sheet/page.tsx:276-278` renders them (`isGroup = isKit` only), so the counted
   rows can never be ticked.

Smaller sores: `modelBulkAccessoriesWrites` has no update mutation, yet its duplicate-add
error says "Edit the quantity instead"; the quantity-merge path in `addLineItem` never
rescales accessory children; `DEDICATED` allocation is server-supported but UI-dormant.

## Competitive research (2026-07-26)

Six products surveyed. Full citations in the issue-linked research; the load-bearing
findings:

| Product | Default vs optional axis | Add-time UX | Removable defaults per job | Warehouse behaviour |
|---|---|---|---|---|
| **Current RMS** | `mandatory / default / optional` inclusion types per accessory, with per-parent quantity ratio (4-decimal) | "Show accessories" expander in the product picker with live availability; defaults pre-filled, optionals start at 0 | Yes (defaults); mandatory can't be reduced/deleted; parent qty change cascades to children | Ticking a parent selects its accessories too; each accessory individually scannable; allocate → prep → book-out stages |
| **HireHop** | 5 "autopull" types: prompt-unselected, prompt-selected, compulsory, conditional, detached reminder | Autopull checkbox dialog on add; skipped entirely when nothing needs a prompt; "extended view" hides rare options | Yes, except compulsory | Autopulls become normal supplying-list lines |
| **Rentman** | Per-accessory `Automatic` yes/no (no = confirm prompt), `Free`, "skip if already present", merge-rows | Confirm dialog per non-automatic accessory | Trivially — the link **dissolves** after add (accessories become independent lines) | Ordinary lines; virtual combinations get expandable tiles + per-item booking |
| **Flex Rental** | `Contents` (auto-add) vs `Suggestions` (popup picker, per-type Required + Included-in-Price flags) | Suggestions popup; qty auto-scales from parent, adjustable; lands as child or sibling per config | Suggestions are opt-in; contents auto-add | Container scan-out pulls contents; "Contents Permanent" governs scan-in; "Free Pick Container" for ad-hoc packing at prep |
| **Booqable** | Bundles only (no accessory object; add-ons still on their roadmap) | Bundle contents auto-populate | Yes — removed content greys to qty 0 with "3/2" slash showing original config | Contents are real tracked lines |
| **Cheqroom** | Kits only; org/per-kit "locked" toggle | Book kit as a whole; booking a member offers the whole kit | Unlocked: yes; locked: admins only | Per-item scan with kit-completeness validation; partial check-in supported |

**Takeaways adopted:**
- The **default/optional inclusion type on the model-level accessory** is the industry
  standard (Current RMS inclusion types, HireHop prompt-selected/unselected, Flex
  Contents-vs-Suggestions). Issue #794's ask maps 1:1 onto it.
- **The picker only appears when there's a choice to make** (HireHop: no prompts → no
  dialog). Defaults with nothing optional shouldn't add a modal to the add flow.
- **Quantities scale from the parent and are adjustable at add-time** (Current RMS, Flex).
- **The selection is per-line state, durable on the job** — everyone but Rentman keeps
  the parent/child link on the job, and Rentman's dissolve-on-add is the trade we
  explicitly don't want (we need the link for warehouse cascade + PDFs).
- **Warehouse: parent selection sweeps children, but children stay individually
  verifiable/scannable** (Current RMS) — exactly the kit-parity issue #794 asks for.
- Not adopted (out of scope, noted for later): mandatory/compulsory tier, per-accessory
  pricing ("Included in Price" / "Free" flags), suggestion popups for cross-sell,
  Booqable's qty-0 tombstone display.

## Design principles

1. **The office decides, the warehouse verifies.** Accessory *selection* happens at
   add-time (and is editable on the equipment tab until deploy). The warehouse never
   silently changes the selection — it verifies and deploys it, with the same partial-
   deploy escape hatch kits have.
2. **One source of truth per rule (POLICY R-3.1, R-8.2.4).** The model config is the
   *template*; the per-line **accessory plan** is the *authority* for that line. Every
   expansion site (office add, prep, checkout) reads the same plan — no site may union
   config in fresh and override a stored choice (that's exactly today's checkout bug).
3. **Reuse the kit machinery, don't clone it.** Verification circles, `verifiedKitItems`,
   `collectAllVerifiableIds`, the partial-deploy dialog — accessories plug into these,
   with `childKind` driving only copy/badges.

## Data model changes

### 1. `modelBulkAccessories.inclusion` — `"DEFAULT" | "OPTIONAL"`

New optional field, absent = `DEFAULT` (zero-migration back-compat; every existing row
keeps today's auto-attach behaviour).

- `DEFAULT` — auto-attaches when the model is added to a project; PM may deselect per line.
- `OPTIONAL` — never auto-attaches; offered in the add-time picker.

Also: add the missing **`updateNative`** mutation (quantity, inclusion, notes) +
field-guard bounds, fixing the "Edit the quantity instead" dead end. Schema stays
hand-merged per the generator warning in CLAUDE.md. A future `MANDATORY` tier is one enum
value away; not in scope.

Asset-level accessories (`parentAssetId` serialised children, `assetBulkChildren`) stay
always-default: they model *physical attachment* to a specific unit, not a template
choice. The per-deploy escape hatch for them is the warehouse partial-deploy (below), not
the office picker.

### 2. `projectLineItems.accessoryPlan` — the durable per-line selection

New optional field on the **parent** line:

```ts
accessoryPlan?: {
  excluded: string[];              // bulkAssetIds of deselected DEFAULT model accessories
  added: {                         // opted-in OPTIONAL model accessories
    bulkAssetId: string;
    quantityPerParent?: number;    // override; absent = template quantity
  }[];
}
```

- Absent plan ⇒ template behaviour (all defaults, no optionals) — existing lines are
  untouched.
- Written at add-time from the picker; editable afterwards from the equipment tab until
  the parent line has deployed units.
- **Every** expansion site resolves the effective accessory set through one shared
  function (`resolveLineAccessoryPlan` in `convex/lib/fulfillment.ts`):
  `effective = (model DEFAULTs − plan.excluded) ∪ plan.added ∪ asset-level children`,
  asset-level still winning dedup by `bulkAssetId`.
- `expandAccessoryChildLines` (office add), `expandAccessoriesForAsset` (prep **and**
  checkout), and the availability preview all call it. This structurally kills bug #1:
  checkout can no longer resurrect a deselected accessory because it no longer consults
  raw config.

Rejected alternative — child-rows-as-truth with qty-0 tombstones (Booqable style): keeps
no record for by-model lines before children exist at prep, pollutes the ~40
`isKitChild:false` filters' row space, and puts ghost rows in front of all five PDF
consumers. A plan field on the parent is invisible to all of them.

### 3. `includeAccessories` params retired

The booleans on `addLineItem`/`checkOutItems` become derived: "exclude all" is just a
plan with every default excluded; checkout takes the per-deploy verified set (below).
Kept accepted-but-deprecated for one release for API/import callers, then removed
(R-3.1: two switches for one rule is a defect).

## Office UX

### Add-time picker (replaces the "Include accessories" checkbox)

In `equipment-add-form.tsx`, when the chosen model/asset has accessories, render an
inline **"Accessories" section** (not a second modal — the add form is already a form):

```
Accessories                                    2× IMX6A selected
  Included (2)
  ● 4× PowerCON cable        [qty 4]  ✕   ← DEFAULT, deselectable
  ● 2× Safety wire           [qty 2]  ✕
  Optional (2)
  ○ 2× Scroller clip         [qty –]      ← OPTIONAL, opt-in
  ○ 1× Rain cover            [qty –]
```

- Defaults pre-selected with quantities scaled by line qty (template × parent qty, live
  as the qty input changes); deselecting one records it in `plan.excluded`.
- Optionals listed unselected; ticking one records it in `plan.added` (with optional qty
  override).
- Availability shown per accessory row (reuse the `checkAvailability` machinery) —
  Current RMS does this and it's cheap for us.
- **No accessories on the model ⇒ section absent** (unchanged form). Defaults only, none
  optional ⇒ section renders collapsed ("4 accessories included · edit") so the happy
  path stays two clicks (HireHop's no-prompt rule).
- By-asset-tag adds show the same section including the asset's serialised/bulk children
  (read-only "attached to this unit" group — physically attached, not deselectable here).

### Post-add editing

`equipment-rows.tsx` accessory-parent rows get an **"Edit accessories"** action (row menu)
reopening the same picker against the current plan. Server mutation re-reconciles child
lines: creates newly-added children, cascade-removes newly-excluded ones (allowed while
no unit of that child is prepped/deployed; blocked after with a pointed error). This also
gives us the hook to finally **rescale on parent-quantity change and on the merge path**
(recompute child quantities from the plan — closes the FEATUREDOCS/48 "known limitation").

The direct child-removal guard (`ACCESSORY_CHILD`) stays; removal goes through the plan
so the record and the rows can't diverge.

## Warehouse UX — kit parity

### Rendering (Deploy / Return / Pick-Prep / De-prep tabs)

- `groupItems` / `groupCheckinItems` (warehouse page) learn a third parent kind:
  **accessory parent** (top-level, no `kitId`, has `childKind:"ACCESSORY"` children —
  same detector `describeRow` and the PDF pipeline already use). Children come out of the
  `equipmentItems` filter exclusion and into the parent's `children`, rendered by the
  existing `KitChildRows`/`MobileKitChildCards` with an "Accessory" badge
  (`childKind`-aware copy — the component currently never checks `childKind`).
- Verification circles, `bg-ok-soft` tint, and the "X/Y verified" badge come free via
  `collectAllVerifiableIds` once the children are in the group. Scanning an accessory's
  own tag flips its circle (today's "scan the parent" toast becomes verify-the-child,
  matching kit-member scan behaviour).
- **Pick sheets fixed:** `online-pick-list.tsx` + `pull-sheet/page.tsx` treat an
  accessory parent as a group parent (`isGroup = isKit || isAccessoryParent`), rendering
  children indented/badged — which is what FEATUREDOCS/48 already (wrongly) claims and
  what makes `pickListProgress`'s denominator completable (bug #3).

### Partial deploy (issue #794 refinement, 2026-07-25)

- Deploying an accessory parent with unverified accessory children raises the same
  confirmation kits get: **"2/4 items verified — Deploy Verified Only / Deploy All"**
  (`kitConfirm` dialog, extended to accessory groups).
- "Deploy Verified Only" checks out the parent + verified children only. `checkOutItems`
  gains `includeAccessoryIds` (the same whitelist `prepUnit` already takes) wired from
  the verified set — replacing the hardcoded `includeAccessories: true`.
- An un-deployed accessory child **stays in the Prep tab** (prepStatus untouched, not
  auto-advanced), individually deployable later — its verification circle in Deploy
  remains actionable once the parent is out.
- **Return side unchanged** (issue scopes this to deploy): full cascade on return via
  `checkinAccessoryChildren`, per-unit scoping as today.

### Prep

The prep asset-picker's checkbox list survives but is **seeded from the line's plan**
(not raw config) and its result now sticks, because checkout honours stored state instead
of re-expanding. The pick/prep tab shows accessory children nested (closes the
FEATUREDOCS/48 "known gap").

## Explicitly in scope: bug fixes bundled

| Bug | Fix |
|---|---|
| Checkout overrides prep deselection (`warehouseOps.ts:171`) | All expansion via `resolveLineAccessoryPlan`; checkout takes `includeAccessoryIds` |
| Un-completable pick progress | Render accessory children on pick/pull sheets |
| No model-accessory update mutation | `updateNative` (qty/inclusion/notes) |
| Merge/qty-change never rescales children | Plan-driven reconcile on quantity edit + merge path |

## Out of scope (unchanged from FEATUREDOCS/48 "Not in v1")

Per-accessory pricing (ITEMIZED — Flex's "Included in Price" is the reference when we do
it), a MANDATORY tier, serialised *model-level* accessories, nested accessories, bulk
parents, kit↔accessory conversion, `DEDICATED` re-enable (TODOS P3), cross-sell
suggestion popups, return-side partial cascade.

## Issue #794 acceptance-criteria mapping

| Criterion | Where satisfied |
|---|---|
| Model config: default vs optional | `modelBulkAccessories.inclusion` + manager UI |
| Add-time picker for optionals | Equipment-add-form "Accessories" section |
| Deselect defaults per line, template untouched | `accessoryPlan.excluded` |
| Warehouse renders accessories like kit children | Accessory parent groups → `KitChildRows` |
| Verification circles + X/Y confirm dialog | `collectAllVerifiableIds` over accessory children |
| Partial deploy, leftovers stay in Prep | "Deploy Verified Only" + `includeAccessoryIds` on checkout |
| FEATUREDOCS/48 updated | Phase 4 (same PRs as behaviour changes, R-5.2) |

## Rollout

1. **Schema + config** — `inclusion` field, `updateNative`, `ModelAccessoriesManager`
   default/optional toggle + qty edit. Invisible to projects (optionals don't expand).
2. **Office selection** — `accessoryPlan`, `resolveLineAccessoryPlan`, add-form picker,
   post-add edit, retire `includeAccessories` on add. *(Checkout-honours-plan lands here
   too — it's the same resolver.)*
3. **Warehouse parity** — grouping, `KitChildRows` accessory support, verification +
   partial deploy, pick/pull-sheet rendering, progress fix.
4. **Docs + audits** — FEATUREDOCS/48 (data model + flow + de-staling the deploy/return
   section), FEATUREDOCS/12, glossary ("default accessory", "optional accessory",
   "accessory plan"). PDF pipeline: no `DocumentLineItem` shape change is planned, but
   phase 3 changes which child rows exist — run the five-consumer audit from CLAUDE.md
   § PDF generation before shipping, plus one full-pipeline integration test with an
   optional-accessory fixture.

Each phase ships independently behind no flag (phase 1–2 are strictly additive;
absent-plan lines behave exactly as today).

## Decisions (Jayden, 2026-07-26)

1. **Optional accessories on by-asset-tag adds: yes, same picker.** Tag adds render the
   same Accessories section — model defaults deselectable, model optionals opt-in, the
   unit's physically-attached children shown read-only. One flow everywhere.
2. **Post-deploy plan edits: hard-block.** Once any unit of the line is checked out the
   plan is frozen; the error points the PM at the warehouse return/swap flow.
3. **Warehouse is verify/narrow only.** No Flex-style free-add at prep — the warehouse
   can deselect or partially deploy planned accessories, never add unplanned ones.
   "Office decides, warehouse verifies" holds without exception in v1.
