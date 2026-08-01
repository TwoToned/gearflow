# 47 — Cross-Type Equipment Unification

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Project equipment tab renders own-stock items, sub-hire groups, and custom
items in a single ordered list per category. Adding, moving, reordering,
and pricing every row kind goes through the same dialogs and the same kebab
actions. Sits on top of the existing [Projects](./10-projects.md) and
[Sub-Hires](./39-sub-hires.md) docs — this file is the bridge between them.

Planning + decisions for this work live in
`~/.gstack/projects/TwoToned-gearflow/jayden-main-plan-20260603-164457.md`
and the test plan at
`~/.gstack/projects/TwoToned-gearflow/jayden-main-test-plan-20260603-164457.md`.

## Data model

**CategorySlot** (`category_slot` table) owns cross-type sort order so the
equipment tab can interleave `ProjectGroup` and `SubHireGroup` rows inside a
single category without Prisma needing to UNION two tables.

```prisma
model CategorySlot {
  id                String   @id
  projectCategoryId String
  sortOrder         Int
  projectGroupId    String?  @unique
  subHireGroupId    String?  @unique
  // XOR enforced by DB CHECK constraint (added in the migration SQL)
  // UNIQUE(projectCategoryId, sortOrder) keeps the order distinct
}
```

Each `ProjectGroup` and `SubHireGroup` has an optional `slot: CategorySlot?`
back-relation. Legacy groups without a slot row fall back to their own
per-table `sortOrder` field, so existing projects keep working.

`SubHireGroup.targetCategoryId` is the placement field for sub-hire groups
inside a project. `null` means uncategorised.

`ProjectGroup.categoryId` is **nullable since v0.10.0.0** (migration
`20260604030000_uncategorized_project_groups`) and `null` means
uncategorised — the same convention sub-hire groups already used. The
FK's `onDelete` switched from `CASCADE` to `SET NULL` at the same time,
so deleting a `ProjectCategory` now orphans its groups (they reappear
under Uncategorized) instead of destroying them together with every
contained line item.

## Server actions

> **Superseded (Convex-native browser-direct).** `src/server/category-slots.ts` no
> longer exists. The mutations below are now browser-direct in
> [`convex/categorySlotsWrites.ts`](../convex/categorySlotsWrites.ts) (called via
> `src/hooks/use-category-slots-writes.ts`); the two `getUncategorized*` reads are
> folded into the bundled [`convex/equipmentTab.ts`](../convex/equipmentTab.ts)
> `bundle` query, reconstructed client-side by `src/lib/equipment-tab-reconstruct.ts`.
> Names/behaviour below are unchanged (ported at parity), only the file/transport moved.

Validations in [`src/lib/validations/category-slot.ts`](../src/lib/validations/category-slot.ts).

| Action | Purpose | Permission |
|---|---|---|
| `getUncategorizedSubHireGroups(projectId)` | Read counterpart to `getUncategorizedLineItems`. Returns groups with `targetCategoryId IS NULL`. | `project:read` |
| `getUncategorizedProjectGroups(projectId)` | Project-group counterpart added in v0.10.0.0. Returns groups with `categoryId IS NULL` (including line items + child line items in the same include shape used by `getProjectCategories`) so the equipment tab can render orphan project groups in the Uncategorized zone next to orphan sub-hire groups and standalone uncategorised line items. | `project:read` |
| `moveSubHireGroupToCategory(groupId, categoryId\|null)` | Placement-only update. Does NOT trigger `syncSubHireToProject` regenerate — just updates targetCategoryId, the synthetic parent line item's categoryId, and the slot row. Calls `recalculateProjectTotals` once. | `project:manage_line_items` + `subHire:update` |
| `moveProjectGroupToCategory(groupId, categoryId\|null)` | Project-group counterpart to the sub-hire move. Updates `ProjectGroup.categoryId`, every contained `ProjectLineItem.categoryId`, and the slot row in one transaction. Destination is **nullable since v0.10.0.0** — passing `null` drops the slot, clears the line items' `categoryId`, and bypasses the advisory lock (no slot insert means nothing to race on). A non-null destination still takes the same `pg_advisory_xact_lock` keyed on the destination category that protects the sub-hire move. | `project:manage_line_items` |
| `reorderMixedGroupsInCategory(categoryId, orderedIds[])` | Reorders a mixed array of `pg-<id>` / `shg-<id>` prefixed IDs by updating `CategorySlot.sortOrder`. Uses a Postgres advisory lock (`pg_advisory_xact_lock`) keyed on the category id to serialize concurrent reorders, plus a phase-1 negation step to free the positive sortOrder range before writing new values. | `project:manage_line_items` + `subHire:update` |
| `createCategoryAndPlaceGroup(projectId, name, slot)` | Atomic: creates a new ProjectCategory at the END of the project's category list, places the chosen group (project or sub-hire) inside it via a slot row, and syncs the group's own placement field. Both branches (project + sub-hire) also `updateMany` the contained line items' `categoryId` so PDFs and reports that filter by category see the new home — the project-group branch missed this until v0.9.2.0. Used by the inline "Create category" affordance in the Move dialog. | `project:manage_line_items` |

Explicit non-existence: there is NO `moveLineItemToSubHireGroup`. Own-stock
items can't enter a sub-hire group per Drop Matrix 8C (below) — that's by
design, not a bug.

Cross-org / cross-FK validation on every placement param: both the source
group and the destination category must belong to the same org AND the
same project.

## Query shape

`getProjectCategories(projectId)` — formerly a Prisma read in
`src/server/project-categories.ts` (now deleted), now reconstructed client-side by
[`src/lib/equipment-tab-reconstruct.ts`](../src/lib/equipment-tab-reconstruct.ts)
from the [`convex/equipmentTab.ts`](../convex/equipmentTab.ts) `bundle` query —
includes:

```ts
category.groups: ProjectGroup[]              // with slot, lineItems
category.subHireGroupTargets: SubHireGroup[] // with slot, subHire shell, items, lineItems
category.mixedGroups: Array<                 // canonical ordered list
  | { kind: "project"; sortOrder: number; projectGroupId: string }
  | { kind: "subHire"; sortOrder: number; subHireGroupId: string }
>
```

`mixedGroups` is computed server-side from the slot rows, falling back to
per-table sortOrder when no slot exists. UI walks `mixedGroups` to render
in canonical order.

## UI primitives

`LineItemData`/`GroupData`/`SubHireGroupData`/`MixedGroupSlot`/`CategoryData` are
defined in `src/components/projects/equipment-row-types.ts` (pure types, no
React/Convex imports) and re-exported from `equipment-rows.tsx` for existing
consumers. `equipment-row-descriptors.ts` and `equipment-cards.tsx` import them
directly from `equipment-row-types.ts`, not from `equipment-rows.tsx` — importing
the component module there created a circular dependency with `equipment-rows.tsx`
(which itself imports `describeRow`/`LineAssetsIndicator`/the card primitives from
those two files). Fixed as part of the POLICY.md R-3.5 cycle burn-down (#730/#766).

`src/components/projects/equipment-rows.tsx` exports four row primitives.
Reordering is real **drag-and-drop** again (`@dnd-kit`, re-added after the
`chore/remove-pdf-builder-and-dnd` removal) — see
[Reordering](#reordering-drag-and-drop) below. Each row takes
`dragHandleRef`/`dragAttributes`/`dragListeners`/`isDragDisabled`
(`DragHandleControls`, `equipment-rows.tsx`), spread onto the row's/card's
ROOT element — there is no dedicated grab handle. Pressing and holding
anywhere on the row starts the drag; a delay-based sensor activation
constraint (not a drag-handle button) is what lets a normal click/tap on the
row's own buttons/checkboxes/inputs still work. `useSortable({disabled: true})`
already makes `listeners` a no-op, so a row with `isDragDisabled` simply never
activates a drag — no separate handle-hiding logic needed. The
`cat-`/`grp-`/`shg-`/`li-` id prefixes referenced below are real
`useSortable()` ids, not just historical scope labels.

- **`CategoryRow`** — ProjectCategory header. Kebab:
  Add Equipment / Add Kit / Add Custom Item / Rename / Delete. The three
  Add entries open the unified add dialog scoped to the category with no
  group pre-set, so the new item lands as a standalone item directly
  under the category. Sub-hire is intentionally omitted — sub-hire
  orders don't carry a categoryId at the order level (their groups
  do), so use the toolbar Add for sub-hires.
  Save as Template / Delete. "Move to category" uses the same
  `ArrowRightLeft` icon as the line-item and sub-hire-group Moves.
- **`SubHireGroupRow`** — SubHireGroup (scope `shg-<id>`). Handshake icon,
  "via Supplier · $N margin" sub-line. Kebab: Edit price / Edit in
  sub-hire order / Move to category. "Save as Template" is hidden by design
  (8I — templates support own stock only).
- **`LineItemRow`** — ProjectLineItem (scope `li-<id>`). Pencil + kebab
  (Move to category / Move to group / Delete). The two move entries
  opened a single combined dialog from v0.9.1.0 through v0.9.2.1; that
  dialog was split into two focused dialogs in v0.9.3.0 because mixing
  "land under a category" and "land inside a group" in one picker kept
  surprising users (the category-only path is lossless, the group path
  changes the item's owning category).

Every row supports `e`/`m`/`d` keyboard shortcuts on hover via the
`useRowShortcuts` hook — Edit / Move / Delete. Skipped when focus is in
an input, dialog, or open menu (decision 8J). On `GroupRow`, `m` binds
to "Move to category". On `LineItemRow`, `m` binds to "Move to
category" — the broader, lossless pick. Group moves need the explicit
kebab path.

The hook takes an optional second `scope` argument (`useRowShortcuts(cbs,
"equipment")`); when set it only fires while an element with the matching
`data-shortcut-scope` attribute is in the DOM. The equipment table wrapper in
`equipment-tab.tsx` carries `data-shortcut-scope="equipment"`, so these
single-key actions stay scoped to that table and don't leak onto other pages.
The hook also accepts an optional `c` callback (copy/close) for rows that have a
natural such action — currently unbound here, as equipment rows have none. The
same `scope` mechanism exists on the global `useKeyboardShortcut` hook
(`src/hooks/use-keyboard-shortcut.ts`) as an optional 4th argument.

## Dialogs

All under `src/components/projects/`:

- **`UnifiedAddDialog`** — single dialog for adding line items. Segmented
  switcher: Own stock / Kit / Sub-hire / Custom. Switching reshapes the
  body inline for all four kinds, including sub-hire (see
  `SubHireAddForm` in the same folder). Sub-hire submit creates the
  order via `createSubHire`, closes this dialog, and opens
  `SubHireOrderDialog` on the new order in manage view so the user can
  immediately add items. The legacy `onOpenSubHire` bounce prop was
  removed in v0.9.1.0.
- **`AddGroupToolbarDialog`** — the equipment-tab "Add group" dialog. The
  category `<select>` **defaults to Uncategorized** (since v0.23.x): a group
  is one field (title) to create, mirroring how sub-hire groups already
  default to uncategorised. Picking Uncategorized submits `categoryId: null`
  (the project's Uncategorized zone). There is no empty "Select category…"
  placeholder — Create is enabled as soon as a title is typed.
- **`PriceEditDialog`** — single dialog for editing group pricing.
  `kind=project` shows a single price input; `kind=subHire` shows charge +
  cost + computed margin per unit.
- **`MoveSubHireGroupDialog`** — picks destination category for a sub-hire
  group. Uses `ComboboxPicker` with `creatable` — typing a new category
  name and pressing Enter calls `createCategoryAndPlaceGroup` atomically.
- **`MoveProjectGroupDialog`** — project-group counterpart, same
  `ComboboxPicker` + `creatable` shape. Calls `moveProjectGroupToCategory`
  for existing destinations and `createCategoryAndPlaceGroup` for new
  ones. Since v0.10.0.0 the picker also offers an Uncategorized
  destination (mirrors `MoveSubHireGroupDialog`), which submits
  `categoryId: null`.
- **`MoveItemToCategoryDialog`** — picks a destination `ProjectCategory`
  (or "Uncategorized") for a single line item. Always lands the item
  with `groupId: null` so it appears as a standalone item under the
  category (or in the project's top-level uncategorised zone). Submits
  `{ categoryId, groupId: null }` to `moveLineItemToGroup` via the
  parent-owned mutation.
- **`MoveItemToGroupDialog`** — picks a destination `ProjectGroup` for a
  single line item. The picker lists every group in the project,
  labelled `<category> > <group>` and clustered by category via native
  `<optgroup>` so projects with many categories stay scannable. The
  item's `categoryId` follows the picked group's owning category.
  Empty-state copy with a Cancel button when the project has zero
  groups instead of an empty dropdown.

### Add-form visual pass (RVLT Flow)

The four inline add forms rendered by `UnifiedAddDialog`
(`equipment-add-form.tsx`, `kit-add-form.tsx`, `sub-hire-add-form.tsx`,
`custom-item-add-form.tsx`) share a common dialog-form layout, modelled on
`src/components/assets/asset-form.tsx`: labelled `SectionTitle` groups
separated by `border-t border-line`, sentence-case `Field` labels, the
registry `ComboboxPicker` for relational pickers, registry `Select`
(explicit `SelectValue` children; a `"__none__"` sentinel stands in for the
empty/none option since Radix forbids empty-string `SelectItem` values) and
`Checkbox`, registry `Button` variants (`line` Cancel + `loading` submit),
and a compact live summary line where it helps. Availability / overbook /
duplicate / conflict notices use RVLT semantic tokens (`t-out` / `ok` /
`warn` / `blue`) and the left-edge accent-bar notice style, not raw Tailwind
palette colours. The sub-hire supplier picker has an inline "New supplier"
quick-create (`QuickCreateSupplier`). This was a markup/component pass only —
no add/pricing/promotion/availability/mutation logic, data shape, or
persisted payload changed.

**Standardised placement box (`placement-fields.tsx`).** The three item add
forms used to show *different* placement boxes: own-stock had a Category picker
only, kit had none, custom had both Category + Group. They now all render the
same `PlacementFields` component — a Category + Group `Select` pair (explicit
`SelectValue` children, `"__none__"` sentinel, changing category clears the
group) driven by `CategoryData[]`. Own-stock feeds it the categories it already
fetches via `useProjectCategories` (which include their groups); kit receives
`categories` from `UnifiedAddDialog` and renders a new "Placement" section;
custom swapped its inline markup for the shared component. All three server
actions (`addLineItem`, `addKitLineItem`, `addCustomLineItem`) already accepted
`categoryId` + `groupId`, so this is additive UI — no add/pricing/data-shape
change. Placement pickers stay hidden when the form is launched from a specific
category/group context (a `targetLabel` chip shows the destination instead).

`add-service-dialog.tsx` (the standalone Add service/other dialog, separate
from `UnifiedAddDialog`) got the same dialog-context treatment: its two raw
`<select>` elements (type, pricing type) are now the registry `Select` with
explicit `SelectValue` children, the hand-rolled `Loader2` spinner is replaced
by `Button loading`, error copy moved to `t-out`/`t-micro`, a `line` Cancel
button was added to match the other dialogs, and labels/title are sentence
case. The group `ComboboxPicker` (creatable) and the `addLineItem` mutation
are unchanged.

Both move-item dialogs replaced the combined `move-line-item-dialog.tsx`
in v0.9.3.0. The server action (`moveLineItemToGroup`) is unchanged —
this is purely a UI split. The combined dialog landed in v0.9.1.0 and
got a `(no group)` escape hatch in v0.9.2.1; field reports kept showing
the mixed picker confused users about whether their pick would also
re-home the item's category, so we split it.

### Structural + discount unification pass (issue #883)

The visual pass above explicitly stopped short of form-library choice,
edit dialogs, and discount logic. This pass finishes that:

**Shared primitives (`src/components/projects/line-item-form-fields.tsx`).**
`SectionTitle` and `Field` were byte-identical copy-paste across all four
add forms — now one shared export each. The `$`/`%` discount toggle had
three independently hand-rolled implementations (`equipment-add-form`,
`edit-line-item-dialog`, `bulk-edit-line-items-dialog`) that had quietly
drifted in exact classes — now `DiscountField` (labelled) and
`DiscountAmountInput` (bare, for callers with their own label, e.g.
`bulk-edit-line-items-dialog`'s checkbox-gated rows). Every caller resolves
a `%` value to a flat dollar amount before it reaches the schema/mutation —
discount is *always* persisted as a flat $ amount (see `line-item.ts`'s
`discountField` and the new `project-group.ts` `discount` field below).

> **Superseded in part by #1012** (2026-07-28): the mode is no longer *purely*
> a client-side display convenience. `discount` is still always the resolved
> flat dollar amount, but the mode itself is now persisted next to it as
> `discountMode` (`"$" | "%"`, on `projectLineItems` + `projectGroups`) so
> quote/invoice PDFs can print the discount the way it was entered. The
> conversions moved out of this file into `src/lib/discount-mode.ts` (a plain
> module the Convex mutations, Zod schemas and PDF renderer can all import);
> `line-item-form-fields.tsx` re-exports them so the forms' imports are
> unchanged. See [FEATUREDOCS/13](./13-pdfs.md) and
> [FEATUREDOCS/10](./10-projects.md).

**RHF + Zod everywhere.** `custom-item-add-form.tsx` moved from hand-rolled
`useState` per field (only `.parse()`d at submit) to
`useForm + zodResolver(customLineItemSchema)`, matching
`equipment-add-form.tsx`. It also gained the `%` discount toggle it was
missing (dollars-only before, while its own edit path already supported
both).

**`edit-line-item-dialog.tsx` rebuilt on the add-form pattern.** This was
the single biggest structural gap: equipment has a richly-structured add
form, but editing that *same* line item dropped into a generic dialog with
no placement/category editing, no `isOptional` toggle, no section
grouping, no RHF/Zod. Worse, it was a live bug — `EditLineItemPayload`
never included `isOptional`, so `lineItemSchema.parse()`'s
`.default(false)` silently reset every edited item's optional flag to
`false` on save. Now rebuilt on RHF + `zodResolver(lineItemSchema)` +
`SectionTitle`/`Field`/`DiscountField`, with `isOptional` required in the
payload (always seeded from the item) and a new Placement section
(`PlacementFields`, hidden for kit children — they move with their parent
kit, not independently). Placement changes fire a separate `onMove`
callback into `groupWrites.moveLineItem` (only when the picker's value
differs from the item's current placement) rather than flowing through
`lineItemSchema`/`patchNative`, since a placement move is a different
mutation with its own category-slot/suggested-price side effects — this
mirrors how `EditGroupDialog` already fires price as a second, independent
call alongside its main update. `equipment-tab.tsx` threads the item's
current category/group into the dialog from the same closures the
neighbouring `onMoveToCategory`/`onMoveToGroup` handlers already use (line
items don't carry `categoryId`/`groupId` directly — tree position *is* the
placement).

**Kit and group discount capability.** Neither had any discount concept
before this pass.

- *Kits* reuse the existing `projectLineItems.discount` field (no schema
  change) — `createKitLineItemCore` / `addKitNative` /
  `useLineItemWrites().addKit()` / `kit-add-form.tsx` all thread an
  optional `discount`, gated to `KIT_PRICE` mode (the only mode with a
  flat `unitPrice` to discount against; `ITEMIZED` kits have no parent-row
  price).
- *Groups* got a new `discount: v.optional(v.number())` on the
  `projectGroups` Convex table, the same 0–999999.99 finite bound as
  line-item discount (`assertValidDiscount` in `projectGroupsWrites.ts`,
  mirrored in `src/lib/validations/project-group.ts`). Threaded through
  `createGroupNative` / `updateGroupPriceNative`, both `mapGroupDoc`
  copies (`project-equipment-reconstruct.ts` and
  `project-line-item-read.ts` — the latter feeds PDF generation),
  `equipment-tab-reconstruct.ts`, and `useProjectGroupWrites().updatePrice()`'s
  new optional third argument. `EditGroupDialog` and `PriceEditDialog`'s
  project branch both expose a `DiscountField`. Money-math consumers
  updated to actually apply it (a stored-but-ignored discount is worse
  than no field at all):
  - `convex/lib/recalc.ts` `groupRevenue` — `bundlePrice × quantity −
    discount`, clamped at 0, same as line-item discount's single
    flat-amount subtraction.
  - `convex/lib/allocation.ts` `poolOf` (per-model revenue allocation) —
    same clamp-then-subtract before the project-level discount factor
    applies.
  - `src/lib/pdfme/structure-line-items.ts` — the synthetic group row's
    `lineTotal` now reflects the discount (was hardcoding
    `discount: null` and never subtracting it), so quote/invoice PDFs
    match what `recalcProjectTotals` actually bills.
  - `equipment-rows.tsx` `GroupRow` — a `-$X disc.` caption under the unit
    price (matching the existing per-line-item convention) and the Total
    column reflects the discounted amount, desktop and mobile.

  `subHireGroups` already had an unused `discount` field in the Convex
  schema before this pass (never read/written by any mutation or dialog) —
  left as-is; sub-hire group discount is out of scope for #883 (it uses
  charge/cost, not a discount-off-price model).

**`Button loading` sweep.** `edit-line-item-dialog.tsx`,
`edit-group-dialog.tsx`, `price-edit-dialog.tsx`,
`bulk-edit-line-items-dialog.tsx`, and `add-group-toolbar-dialog.tsx` all
now use the registry `Button loading` prop instead of an inline
`Loader2`-in-button-children spinner.

Not changed in this pass: `sub-hire-add-form.tsx` (order-level fields only,
no pricing section to unify — it got the `SectionTitle`/`Field` dedup but
no RHF/Zod migration since it has no numeric bounds to validate beyond
what `ComboboxPicker`/`<input type="date">` already constrain) and
`unified-add-dialog.tsx`'s own segmented-switcher styling (still raw
`bg-primary`/`hover:bg-accent` Tailwind rather than the RVLT semantic
tokens `equipment-add-form.tsx`'s internal `ModeTab` uses — flagged as a
follow-up, not fixed here to keep this pass's blast radius to the
form-library/discount work the issue scoped).

## Reordering (drag-and-drop)

Drag-and-drop was removed (`chore/remove-pdf-builder-and-dnd`; `@dnd-kit`
dropped), then re-added row-kind by row-kind (line items, then groups, then
categories) once the cross-type unification above settled. All four row
kinds — `CategoryRow`, `GroupRow`, `SubHireGroupRow`, `LineItemRow` — are
real `@dnd-kit` sortables now; the ▲/▼ move-button era is over.

`src/hooks/use-equipment-dnd.ts` owns the wiring: sensors, hover/invalid-drop
tracking, a per-row-kind optimistic `sortOrder`/placement overlay applied to
the `equipmentTab.bundle` bundle BEFORE reconstruction (so a drop updates
instantly, cleared once the real write settles), and the justified-mutation
wrappers (`useJustifiedMutation` — #990's justify-tier prompt) that fire the
real reorder/move mutations.

Sensors are ONE `PointerSensor` (not `PointerSensor`+`TouchSensor` — Pointer
Events fire for both mouse and touch, so the two used to race for the same
gesture, with `PointerSensor`'s old distance-based constraint winning almost
instantly on touch and hijacking the long-press) with a single
`{delay: 200, tolerance: 8}` activation constraint covering mouse/touch/pen
uniformly, plus `KeyboardSensor` for accessibility. There is no dedicated drag
handle — every row's `useSortable()` ref/listeners are spread onto the
row's/card's own root element, so pressing and holding ANYWHERE on the row
starts the drag; the delay is what lets a quick tap on a nested
button/checkbox/input still work normally instead of a separate handle button
being the only pointer-capture target.

A single `DndContext` in
[`src/components/projects/equipment-tab.tsx`](../src/components/projects/equipment-tab.tsx)
wraps the whole tree; `handleDragEnd` dispatches on the active sortable id's
prefix to one of three pure, unit-tested decision functions:

- **`resolveLineItemDragAction`** (`li-` ids) — reorder within a container
  (category standalone / group / uncategorised) or move across containers
  (category, group, both). Containers indexed by `buildContainerMap`.
- **`resolveGroupDragAction`** (`grp-`/`shg-` ids) — reorder within a
  category's mixed project+sub-hire list, or move to a different category /
  Uncategorized. Containers indexed by `buildGroupContainerMap`; the
  underlying mutation (`groupWrites.reorder` vs
  `categorySlotWrites.reorderMixed`) is picked by `planGroupReorder`.
- **`resolveCategoryDragAction`** (`cat-` ids) — top-level reorder only.
  Categories don't nest into anything and nothing nests INTO a category via
  a "category drag" (a line item/group landing under a category is decided
  by *its own* drag — the group resolver's `cat-` branch is for that, not
  this), so there is exactly ONE category container for the whole project
  and no container-map builder is needed — just the ordered `cat-*` id list.
  Fires `categoryWrites.reorder`.

Cross-container moves (and uncategorise) for line items/groups are also
reachable through the kebab "Move to category" / "Move to group" dialogs
(`moveLineItemToGroup`, `moveSubHireGroupToCategory`,
`moveProjectGroupToCategory`) — both paths call the same underlying
mutations. Orphan (uncategorised) groups and sub-hire group children are
valid drop *targets* but can't originate a drag themselves
(`isDragDisabled`) — they were never independently reorderable.

`getDisallowedDropReason` (the Drop Matrix 8C predicate, `equipment-rows.tsx`)
IS wired into the live UI again — `handleDragOver` calls it to style an
invalid hover target, and `resolveLineItemDragAction`/`resolveGroupDragAction`
call it to short-circuit a disallowed drop with a toast. It has no
category-vs-category rule — categories don't nest into anything, so no
category drop needs blocking.

### Drop Matrix 8C summary

| Source ↓ \ Dest → | ProjectCategory | ProjectGroup | SubHireGroup | Uncat | SubHire (top) |
|---|---|---|---|---|---|
| ProjectLineItem (own/custom/kit) | ✓ standalone | ✓ enter group | ✗ toast | ✓ uncategorise | ✗ toast |
| ProjectGroup | ✓ move cat | ✗ no nested | ✗ no nested | N/A | ✗ |
| SubHireGroup | ✓ move cat | ✗ no nested | ✗ no nested | ✓ uncategorise | N/A |

## Margin column toggle (8H)

Toolbar button "Show margin" / "Hide margin" toggles a conditional Cost
column. State persisted to `localStorage` under
`gearflow-projects-show-cost`, default OFF. When on, the column shows
supplier cost on sub-hire group rows and an em-dash on every other kind.

## Permission seam

Cross-type writes that touch sub-hire data (`moveSubHireGroupToCategory`,
`reorderMixedGroupsInCategory`) require BOTH `project:manage_line_items`
AND `subHire:update`. The actions call `requirePermission` twice — once
per resource — so users holding only one perm are rejected before any
write happens. `moveProjectGroupToCategory` and the project-group branch
of `createCategoryAndPlaceGroup` only need `project:manage_line_items`
because they never read or write sub-hire rows. See
[04-auth-permissions.md](./04-auth-permissions.md) for the perm model.

## Test coverage

> The `src/server/` integration tests below were removed along with the server
> actions they covered. Equivalent coverage now lives in Convex:
> `convex/categorySlotsWrites.test.ts` (move/reorder/create + the perm seam) and
> `convex/equipmentTab.test.ts` (bundle query shape, including `mixedGroups`).

- `category-slot.int.test.ts` — schema invariants (S1, S2)
- `category-slots.int.test.ts` — move/reorder/create (S8, S10, S11, S15) plus the `moveProjectGroupToCategory` happy path and the `createCategoryAndPlaceGroup` project-group line-item sync (Fix A regression)
- `category-slots-permissions.int.test.ts` — perm seam (S9)
- `project-categories-mixed.int.test.ts` — mixedGroups query shape, plus a Fix C regression that verifies kit parents render inside their group's `lineItems` and category-scoped standalone items (`groupId: null`) render in `cat.lineItems`

Unit tests under `src/lib/validations/` and `src/components/projects/`:

- `category-slot.test.ts` — Zod schema coverage for every move/reorder/create input, including the new `moveProjectGroupToCategorySchema`
- `equipment-rows.test.ts` — RowDescriptor + Drop Matrix predicate (S7, S14)
- `use-row-shortcuts.test.ts` — keyboard shortcut suppression (8J)

PDF pipeline (`src/lib/pdfme/structure-line-items.ts`) already handles
SubHireGroup synthetic parents — pre-dates this work, no changes needed.

**#883 (structural + discount unification) test coverage:**

- `convex/recalc.test.ts` — group discount subtracted from `equipmentRevenue`, clamped at 0
- `convex/allocation.test.ts` — group discount shrinks the per-model revenue pool, clamped at 0
- `convex/projectGroupsWrites.test.ts` — `updateGroupPriceNative` discount bound, the omit-to-preserve-existing-value semantics, non-finite rejection
- `src/lib/validations/project-group.test.ts` — `discount` field + `updateGroupPriceSchema` bound coverage
- `src/lib/pdfme/structure-line-items.test.ts` — group discount subtracted from the synthetic row's `lineTotal`, clamped at 0

## What this work did NOT change

- `SubHireOrderDialog` (1946 LOC) — the PO workflow stays intact. Could
  be slimmed to PO-only in a follow-up (Phase 7b in the plan), but
  carries enough risk that it's not done yet.
- `ProjectLineItem` shape — synthetic sub-hire parents still exist, the
  warehouse + PDF pipelines still see them.
- The merge behaviour described in [10-projects.md §Sub-hire merge rules](./10-projects.md) —
  unchanged.
