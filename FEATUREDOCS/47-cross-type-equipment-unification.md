# 47 — Cross-Type Equipment Unification

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

All in [`src/server/category-slots.ts`](../src/server/category-slots.ts).
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

`getProjectCategories(projectId)` in
[`src/server/project-categories.ts`](../src/server/project-categories.ts)
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

`src/components/projects/equipment-rows.tsx` exports four row primitives.
Reordering is via **▲/▼ move buttons** (the former drag handle column) —
drag-and-drop was removed (`chore/remove-pdf-builder-and-dnd`, `@dnd-kit`
dropped). Each row takes `onMoveUp`/`onMoveDown`/`canMoveUp`/`canMoveDown`
(`MoveControls`); the shared `MoveButtons` helper renders the stacked
chevrons and disables the up button on the first row / down on the last.
The legacy `cat-`/`grp-`/`shg-`/`li-` id prefixes are still referenced
below only to describe scope, not drag identity.

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

## Reordering (▲/▼ move buttons)

Drag-and-drop was removed (`chore/remove-pdf-builder-and-dnd`; `@dnd-kit`
dropped). Each level now reorders via ▲/▼ buttons in the leading column.
The handlers in
[`src/components/projects/equipment-tab.tsx`](../src/components/projects/equipment-tab.tsx)
(`moveCategory`, `moveGroupSlot`, `moveLineItemInList`) swap a row with its
neighbour, build the new ordered id array, and call the **same server
actions** the old `handleDragEnd` used:

- Categories → `reorderProjectCategories`.
- Group slots within a category → `reorderProjectGroups` (when no sub-hire
  group is involved) or `reorderMixedGroupsInCategory` (mixed).
- Line items (group / standalone / uncategorised) → `reorderLineItems`.

Move buttons reorder within a scope only — they do not move items *across*
categories/groups. Cross-container moves (and uncategorise) remain available
through the kebab "Move to category" / "Move to group" dialogs
(`moveLineItemToGroup`, `moveSubHireGroupToCategory`, `moveProjectGroupToCategory`).
Orphan (uncategorised) groups and sub-hire group children have no inline
reorder buttons (matching prior behaviour — drag had no reorder path there).

`getDisallowedDropReason` (the Drop Matrix 8C predicate) is retained in
`equipment-rows.tsx` and unit-tested, but is no longer wired into the UI
(it gated drag targets, which no longer exist).

### Drop Matrix 8C summary (historical — drag removed)

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

Integration tests under `src/server/`:

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

## What this work did NOT change

- `SubHireOrderDialog` (1946 LOC) — the PO workflow stays intact. Could
  be slimmed to PO-only in a follow-up (Phase 7b in the plan), but
  carries enough risk that it's not done yet.
- `ProjectLineItem` shape — synthetic sub-hire parents still exist, the
  warehouse + PDF pipelines still see them.
- The merge behaviour described in [10-projects.md §Sub-hire merge rules](./10-projects.md) —
  unchanged.
