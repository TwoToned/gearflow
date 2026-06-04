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

## Server actions

All in [`src/server/category-slots.ts`](../src/server/category-slots.ts).
Validations in [`src/lib/validations/category-slot.ts`](../src/lib/validations/category-slot.ts).

| Action | Purpose | Permission |
|---|---|---|
| `getUncategorizedSubHireGroups(projectId)` | Read counterpart to `getUncategorizedLineItems`. Returns groups with `targetCategoryId IS NULL`. | `project:read` |
| `moveSubHireGroupToCategory(groupId, categoryId\|null)` | Placement-only update. Does NOT trigger `syncSubHireToProject` regenerate — just updates targetCategoryId, the synthetic parent line item's categoryId, and the slot row. Calls `recalculateProjectTotals` once. | `project:manage_line_items` + `subHire:update` |
| `moveProjectGroupToCategory(groupId, categoryId)` | Project-group counterpart to the sub-hire move. Updates `ProjectGroup.categoryId`, every contained `ProjectLineItem.categoryId`, and the slot row in one transaction guarded by the same destination-category advisory lock. Destination is required — `ProjectGroup.categoryId` is NOT NULL, so there is no "uncategorised project group" state. | `project:manage_line_items` |
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

`src/components/projects/equipment-rows.tsx` exports four sortable row
primitives:

- **`CategoryRow`** — ProjectCategory header. Drag id `cat-<id>`. Kebab:
  Add Equipment / Add Kit / Add Custom Item / Rename / Delete. The three
  Add entries open the unified add dialog scoped to the category with no
  group pre-set, so the new item lands as a standalone item directly
  under the category. Sub-hire is intentionally omitted — sub-hire
  orders don't carry a categoryId at the order level (their groups
  do), so use the toolbar Add for sub-hires.
- **`GroupRow`** — ProjectGroup. Drag id `grp-<id>`. Kebab: Edit price /
  Add Equipment / Add Kit / Move to category / Recalculate Prices /
  Save as Template / Delete. "Move to category" uses the same
  `ArrowRightLeft` icon as the line-item and sub-hire-group Moves.
- **`SubHireGroupRow`** — SubHireGroup. Drag id `shg-<id>`. Handshake icon,
  "via Supplier · $N margin" sub-line. Kebab: Edit price / Edit in
  sub-hire order / Move to category. "Save as Template" is hidden by design
  (8I — templates support own stock only).
- **`LineItemRow`** — ProjectLineItem. Drag id `li-<id>`. Pencil + kebab
  (Move / Delete).

Every row supports `e`/`m`/`d` keyboard shortcuts on hover via the
`useRowShortcuts` hook — Edit / Move / Delete. Skipped when focus is in
an input, dialog, or open menu (decision 8J). On `GroupRow`, `m` binds
to "Move to category".

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
- **`PriceEditDialog`** — single dialog for editing group pricing.
  `kind=project` shows a single price input; `kind=subHire` shows charge +
  cost + computed margin per unit.
- **`MoveSubHireGroupDialog`** — picks destination category for a sub-hire
  group. Uses `ComboboxPicker` with `creatable` — typing a new category
  name and pressing Enter calls `createCategoryAndPlaceGroup` atomically.
- **`MoveProjectGroupDialog`** — project-group counterpart, same
  `ComboboxPicker` + `creatable` shape. Calls `moveProjectGroupToCategory`
  for existing destinations and `createCategoryAndPlaceGroup` for new
  ones. Destination is required (no "uncategorised" option), so the
  Confirm button stays disabled until a category is picked.

## DnD (drag-and-drop)

Single `DndContext` in
[`src/components/projects/equipment-tab.tsx`](../src/components/projects/equipment-tab.tsx).
`handleDragEnd` routes drops based on sortable id prefix:

- `grp-`/`shg-` within same category → `reorderMixedGroupsInCategory` (or
  the lighter `reorderProjectGroups` when no sub-hire groups are involved).
- `shg-` to a different category → `moveSubHireGroupToCategory`.
- `cat-` ↔ `cat-` → `reorderProjectCategories`.
- `li-` ↔ `li-` → `reorderLineItems`.

`onDragOver` runs the **Drop Matrix 8C** predicate
(`getDisallowedDropReason` in `equipment-rows.tsx`). Disallowed targets
render `border-l-2 border-l-red-500` + `cursor-not-allowed`. Dropping on a
disallowed target surfaces a toast with the reason and aborts.

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
