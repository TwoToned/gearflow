<!-- /autoplan restore point: /Users/jayden/.gstack/projects/TwoToned-gearflow/feat-pick-list-grouping-rework-autoplan-restore-20260602-162154.md -->

# Pick List + Delivery Docket Grouping Rework

> **SHIPPED.** `expandProjectGroups`/`packerSort`/`getPackerSortOrder` and
> sub-hire-group-awareness are all live in
> `src/lib/pdfme/structure-line-items.ts` / `build-document-data.ts`. Archived
> here as design rationale.

**Status**: ~~Draft for review~~ Shipped
**Branch**: `feat/pick-list-grouping-rework`
**Owner**: Jayden
**Date**: 2026-06-02

## Problem

The PDF data builder (`src/lib/pdfme/build-document-data.ts:236-323`) collapses every Project Group into a single virtual line item row (`isGroupRow: true`) for **all document types** — quote, invoice, packing list, return sheet, delivery docket. The child line items inside each group are silently filtered out.

This is **correct for client-facing docs** (quote / invoice show "Lighting Package x1 @ $5000" — the client buys an outcome, not 50 itemized rows). It is **wrong for warehouse-facing docs**: packing list (the pick slip) and return sheet currently render a project with groups as a 3-row PDF instead of the 50 items warehouse staff need to count and pack.

Additionally, the existing P1 TODO calls out broader problems that go beyond the immediate bug:
- Pick slip ordering is just category alphabetical — not packer-friendly (location / case / category)
- Delivery docket already has special-case kit grouping but ignores Project Groups and Sub-Hire Groups
- Sub-hire boundaries are not visually separated on warehouse docs

The in-app pull-sheet at `src/app/(app)/warehouse/[projectId]/pull-sheet/page.tsx` already renders correctly (groups expanded with children). The bug is PDF-only.

## Scope

**In scope:**
1. **Per-template `expandGroups` setting** *(replaces original docType-hardcode approach per D2)* — add a boolean to `TemplateSettings.table` that controls whether Project Groups expand to header + children rows or collapse to a single virtual row. Defaults: `packing-list`, `return-sheet`, `delivery-docket` → `true` (expand). `quote`, `invoice` → `false` (collapse).
2. **Delivery docket expands groups with serials** *(per D1)* — delivery docket renders group header + every child line item + per-unit asset tag so warehouse handover has full evidence. Trades page count for legal/operational accuracy.
3. **Packer-friendly pick slip ordering** — within each group, sort by `Asset.location.name` first, then category, then model name. Location-less items (bulk assets without location, custom items) sort last under "No Location". Wrap the sort behind a `getPackerSortOrder(org)` function so per-org configuration becomes a 10-minute change later.
4. **Sub-hire group awareness** — render Sub-Hire Groups (`SubHireGroup`) as their own top-level section on pick slips and delivery dockets, separate from organisation-owned gear. Sub-hire items currently mix into the regular categories.
5. **Kit boundary on pick slip** — kit parents render as a header row labeled `[Kit] <name>`, with children indented. Today, packing list groups by `groupName || prepContainer`; that already happens to work for kits if they have a group, but it falls back to "Ungrouped" otherwise.
6. **Unit-level detail under group headers** — for serialised assets, render each unit row under its parent line so packers can tick individual asset tags.
7. **Snapshot fixtures FIRST** *(per CEO subagent finding #8)* — before any refactor, write snapshot fixtures for all 6 doc types (`quote`, `invoice`, `packing-list`, `return-sheet`, `delivery-docket`, `call-sheet`) covering: grouped project, kit (both pricing modes), sub-hire (both pricing modes), `showOnDocs:false` items, `isKitChild` + group combo, custom items, uncategorized items. Lock baseline on `main`. Then refactor against the locked snapshots.
8. **Category-total regression test** *(per CEO subagent finding #6)* — explicit test that moving sub-hire items out of their category section does NOT change the quote/invoice category-level subtotals.
9. **Nesting flexibility** *(per CEO subagent finding #5)* — do not assume max-2-level nesting in any new helper. The Child Assets/Accessories work (next P1) will add a 3rd level (kit → asset → accessory).
10. **Tests** — add `build-document-data.test.ts` covering per-docType + per-template behaviour for grouped projects, sub-hire groups, kits, and unit expansion.

**NOT in scope:**
- In-app pull-sheet rewrite (already correct, no user-reported issue)
- Custom user-configurable packer order (use sensible defaults; revisit if asked)
- Cross-warehouse transfers (Two Toned operates a single warehouse — flagged in roadmap)
- Case / road-case entities (no `Case` table exists; kits are the current case abstraction)
- Bulk Check-In Totals Screen (separate P1 TODO, depends on Child Assets)
- Child Assets / Accessories (separate P1 TODO)
- Configurable packer order per org (defer to TODOS as P3 follow-up if Two Toned asks)

## Data model (current, no migration needed)

```
ProjectCategory
├── lineItems[]  (direct — ungrouped within category)
└── groups[]: ProjectGroup
    └── lineItems[]  (the items we're currently hiding on pick slips)

ProjectLineItem
├── categoryId      (optional)
├── groupId         (optional — group inside category)
├── subHireGroupId  (optional — links to SubHireGroup)
├── kitId           (optional — kit parent or child)
├── isKitChild      (boolean)
├── parentLineItemId (kit child → parent)
└── childLineItems[] (kit children, max 2 levels nesting)

Asset.locationId → Location.name        (packer-friendly sort key)
BulkAsset.locationId → Location.name    (same)

SubHireGroup
├── id, subHireId, title, sortOrder
├── targetCategoryId, targetGroupId  (where it maps on the project)
└── lineItems[] (projected line items it generates)
```

No schema migration. Everything we need is already on the records.

## Approach

### Phase 0 — Snapshot fixtures + Prisma include extension (one commit, ~1.5h) *(NEW per CEO + Eng review)*

**Critical pre-work per Eng subagent finding #1**: `build-document-data.ts:127-141` does NOT include `Project.subHireGroups`. Without this, the entire Sub-Hire Section feature ships as a no-op. Add to the project include:

```ts
subHireGroups: {
  orderBy: { sortOrder: "asc" },
  include: {
    subHire: { select: { supplier: { select: { name: true } } } },
    lineItems: { include: lineItemInclude },
  },
},
```

Then the snapshot fixtures:

Before touching `build-document-data.ts`, lock the current behaviour as snapshot tests so the refactor has a regression net.

- New file `src/lib/pdfme/build-document-data.test.ts`.
- Mock the prisma client (or use a thin in-memory factory) with a comprehensive fixture project containing:
  - 2 categories, each with 1 group of 3 items, 1 ungrouped item
  - 1 kit (2 children, ITEMIZED pricing)
  - 1 kit (2 children, KIT_PRICE pricing)
  - **1 kit with ITEMIZED pricing inside a Project Group** (precedence test per Eng finding #10)
  - 1 sub-hire group (2 items)
  - **1 sub-hire item with `targetGroupId` set (lives in both Group and Sub-Hire tree)** (Eng finding #10)
  - **1 empty Project Group + 1 ungrouped item in the same category** (Eng — edge case)
  - **1 project with `subHireGroups` but no categories** (Eng — edge case)
  - **1 project with 50+ line items spanning 3 categories** (pagination test, Eng finding #6)
  - **1 legacy project with no categories at all** (Eng — covers `line 320-322` fallback)
  - **1 Category "Lighting" + Project Group "Lighting" same project** (Map-key collision test, Eng finding #4)
  - 1 custom item
  - 1 uncategorized item
  - items with `showOnDocs:false`
- Call `buildDocumentData()` for each of the 6 doc types.
- Snapshot the returned `line_items` array.
- These tests should be passing on `main` (current behaviour) and stay passing through the quick fix only for `quote` and `invoice` (where behaviour shouldn't change). Other doc types get new snapshots after Phase 1.

### Phase 1 — Per-template `expandProjectGroups` setting + warehouse-doc fix (one commit, ~2h, revised per Eng finding #8)

*Renamed from `expandGroups` per Eng finding #7 — avoids collision with `ProjectGroup`/`groupId`/`groupName`/`showGroupHeaders`.*

Add `expandProjectGroups: boolean` to `TemplateSettings.table` in `src/lib/pdfme/template-settings.ts`:

```ts
// Default per docType:
//  packing-list   → true
//  return-sheet   → true
//  delivery-docket → true   (D1 decision — warehouse handover evidence)
//  quote          → false
//  invoice        → false
//  call-sheet     → n/a (no line items table)
```

**Before** the conditional branch lands, extract the line-item structuring logic into a `structureLineItems(rawItems, categories, subHireGroups, { expandProjectGroups, isInternalDoc })` helper (Eng finding #8 — 10+ branches in one function). The helper returns the ordered `DocumentLineItem[]`.

In `build-document-data.ts`, replace the unconditional group-collapsing block (lines 250-323) with a settings-aware call to the helper:

```ts
const settings = resolveTemplateSettings(docType, /* template? */);
const expandProjectGroups = settings.table.expandProjectGroups;

const structured = structureLineItems(rawLineItems, categories, subHireGroups, {
  expandProjectGroups,
  isInternalDoc: docType !== "quote" && docType !== "invoice",
});
```

The table plugin (`gearflow-table.ts:281-315`) already supports group header rendering via `groupName` + `showGroupHeaders`. Populate `groupName` on real line items instead of substituting a synthetic row.

For sub-hire items, set `groupName` to a derived label like `Sub-Hire: <SubHire.supplier.name> — <SubHireGroup.title>` so the plugin's existing group-header path renders them as their own section.

**Critical — Map key collision fix** (Eng finding #4): The plugin currently uses `groupName` as the Map key at `gearflow-table.ts:263,281`. With user-named groups, "Lighting" (category) and "Lighting" (Project Group) silently merge. Phase 1 must also change the plugin to use a composite key like `category:<id>` / `group:<id>` / `subhire:<id>` and keep the display label separate. Two-line change at `:263,307`.

**Critical — delete delivery-docket special case** (Eng finding #5): `gearflow-table.ts:237-256` has bespoke kit grouping that fights with the new `groupName: "[Kit] X"` emission. Delete the special branch in this same commit so both pipelines don't run.

**Pagination orphan check** (Eng finding #6): Before drawing a group header at `:291-315`, also reserve space for at least one body row (`ghHeight + minRowHeight`). If that doesn't fit, force a page break before the header.

**Sub-hire precedence** (Eng finding #10): Items with both `categoryId` and `targetGroupId`/`subHireGroupId` go to the sub-hire section. Excluded from category aggregation. Document this in the helper's JSDoc.

Update the template editor's table-settings panel (if it has one) to expose the new `expandProjectGroups` toggle. If no such UI exists, leave it as a settings-file default for now — that's a P3 follow-up.

**Section-renderer audit** *(per T2)*: Read `src/lib/pdfme/section-renderer.ts:208` and `:1168-1174`. Verify the filter at `:208` does not undo the new structured `line_items` shape. If it does, fix in this same commit. Add a snapshot test that runs both the legacy template pipeline and the section-renderer pipeline against the same fixture and asserts identical rendered row order.

**Legacy settings default merge** *(per T1)*: In `src/lib/pdfme/template-settings.ts` (or wherever the settings load happens), update the resolution to:
```ts
function resolveTemplateSettings(docType, savedJSON) {
  const defaults = getDefaultSettings(docType);
  return deepMerge(defaults, savedJSON ?? {});
}
```
Test: a saved settings JSON missing `expandProjectGroups` resolves to the docType default (`true` for packing-list).

### Phase 2 — Packer-friendly ordering (one commit, ~45 min)

Within each emitted group, sort child line items by:
1. `unit.asset.location.name` (use the **first unit** for serialised; `bulkAsset.location.name` for bulk)
2. `categoryName` (already present)
3. `model.name`

For multi-unit line items, sort units within the line by `asset.location.name` then `assetTag` so packers walk the warehouse in order.

Add a "Location" mini-row prefix to each group block on the packing list (above the items table) when `showCategories` is true, like:
```
Group: Lighting Package        Location: Truss Room (8), Warehouse A (12), No Location (3)
```

### Phase 3 — Sub-hire & kit awareness (one commit each, ~45 min total)

**Sub-hire on pick slip & delivery docket:**
- Build a synthetic top-level section for each `SubHireGroup` that appears on the project. Sub-hire items leave their category section and join the sub-hire section instead.
- Section header: `Sub-Hire: <SubHire.supplier.name> — <SubHireGroup.title>`
- Pick slip: warehouse staff need to know what's not from their inventory (so they don't pull it from stock). Delivery docket: client sees what's hired-in.

**Kit boundary on pick slip:**
- Today's gearflow-table.ts groups by `groupName || prepContainer` for non-delivery-docket docs. That means kit children with a `kit.name` set as their `prepContainer` already render under a kit header. Verify and tighten.
- For each kit parent on the project, emit a group block titled `[Kit] <kit.name>` containing the kit's children (the `childLineItems`).
- Items inside a kit do NOT also appear in their original category — kit boundary wins.

### Phase 4 — Tests (one commit, ~30 min)

New test file `src/lib/pdfme/build-document-data.test.ts`:
- Group expansion is conditional on docType
- Sub-hire groups become their own section
- Kit children render under their kit, not under their original category
- Ungrouped items in a category render directly under the category header
- Uncategorized items render last
- Quote / invoice unchanged (regression guard)

Mock the prisma client with fixture data covering: project with one Group containing 3 line items, one Sub-Hire Group containing 2 line items, one Kit containing 2 children, and 1 uncategorized item.

## UX changes (PDF output)

**Before (packing list):**
```
Lighting Package                                  1
Lighting Package                                  1     ← group row, same name twice
                                                          (no items — bug)
```

**After (packing list):**
```
─── Lighting (Category) ────────────────────────────
Group: Lighting Package          Location: Truss Room
  Source 4 Leko 36°                                12   [ ]
  Source 4 Leko 26°                                 8   [ ]
  Iris kit                                          2   [ ]

─── Sub-Hire: Mainstage AV — Moving Lights ────────
  Robe Pointe                                       4   [ ]
  Hog 4 console                                     1   [ ]

─── [Kit] FOH Rack #2 ──────────────────────────────
  DiGiCo SD12                                       1   AT-00123 [ ]
  Yamaha PM7 stage box                              1   AT-00456 [ ]

─── No Category ────────────────────────────────────
  Custom: Borrowed sub                              1   [ ]
```

Delivery docket: **same expanded structure as packing list** (per D1) so the signed handover doc has every serial number. Sub-hire and kit boundaries break out into their own sections. The visual difference vs packing list is the per-row "Received" checkbox column and the signature block.

## Risks & open questions

1. ~~`delivery-docket` keeps groups collapsed~~ — **resolved D1**: delivery docket expands groups with serials.
2. **Sub-hire items currently inherit `categoryId` of their target.** Moving them to a separate section means they no longer count toward category totals. Phase 4 includes an explicit category-total regression test that must fail on `main` and pass after the refactor.
3. **Locations are optional.** Many BulkAssets have no `locationId`. Default sort order for those: "No Location" bucket at the bottom of each group.
4. **Custom items (`isCustomItem: true`)** have no asset or location. Default to "No Location" sort.
5. ~~Multi-page pagination~~ — addressed in Phase 1 (orphan check added).
6. **`pdfme/templates/packing-list.ts`** has hardcoded layout dimensions. New group structure might push past 200mm table height; verify against a tall project (covered by 50+ item fixture).

## Failure Modes Registry *(per Eng subagent)*

| # | Severity | What breaks | Symptom | Likelihood | Mitigation |
|---|---|---|---|---|---|
| 1 | **Critical** | Legacy `DocumentTemplate.settings` JSON has no `expandProjectGroups` key → default falls back to `false` for warehouse types | First deploy: packing lists regress to today's 3-row bug for every org with a saved template | High — every existing template row | **TASTE DECISION at gate** — strategy for legacy default merge |
| 2 | **Critical** | Sub-hire groups never load (Prisma include missing) | Pick slips show no sub-hire section despite spec | Certain | Phase 0 extends `lineItemInclude` with `subHireGroups` |
| 3 | **High** | Section-based pipeline (`section-renderer.ts:1168-1174`) bypasses new logic | Some orgs see fix, others don't, depending on whether template is sections-based or legacy | High | **TASTE DECISION at gate** — fix both or feature-flag one |
| 4 | **High** | Map key collision: Category "Lighting" + Project Group "Lighting" merge silently | Items render under wrong section | Medium — content-dependent | Composite keys (Phase 1) |
| 5 | **High** | Sub-hire items with `categoryId` AND `targetGroupId` render twice or disappear | Wrong quantities on docket | Medium | Precedence: sub-hire wins (Phase 1 + test) |
| 6 | **High** | Pagination orphan: group header alone at page bottom, body next page | Visual mess on tall projects | Medium | Header + 1-row reservation (Phase 1) |
| 7 | **Medium** | Section pipeline's own filter at `section-renderer.ts:208` re-collapses or double-expands | Inconsistent rendering across orgs | Medium | Snapshot fixtures for both pipelines (Phase 0) |
| 8 | **Medium** | Removing kit special case `gearflow-table.ts:237-256` regresses kit children rendering on delivery docket | Kit items missing or unordered | Low — covered by snapshot fixtures | Snapshot before/after delete (Phase 1) |
| 9 | **Medium** | 3-level Prisma include adds a 4th level (`subHireGroups → lineItems → ...`) — query cost | Slow PDF gen on large projects | Low | Single-query still; benchmark 100-item fixture |
| 10 | **Low** | `expandProjectGroups` setting introduced but template-editor UI doesn't expose it | Orgs can't toggle without DB edit | High but acceptable | P3 follow-up |

## Test plan

- **Unit**: `build-document-data.test.ts` — 6+ tests covering the expansion matrix.
- **Integration**: Generate a PDF for a real project with groups + sub-hires + kits using `npx prisma db push` against a fresh test DB + the existing `generate-pdf.ts` pipeline. Eyeball the output.
- **Regression**: Snapshot test the quote and invoice output for a project with groups to confirm they're unchanged. Use existing template-validation tests as a base.
- **Manual**: Open the actual app, create a test project with 3 groups + 1 sub-hire + 1 kit, generate each PDF, verify warehouse staff can read it.

## Dependencies & shipping order

1. **Commit 1** — Snapshot fixtures (Phase 0). Locks all 6 doc types' current behaviour. Passes on `main`.
2. **Commit 2** — `expandGroups` template setting + warehouse-doc fix (Phase 1). Bug unblocked. Snapshot diffs reviewed.
3. **Commit 3** — Packer-friendly ordering with `getPackerSortOrder()` helper (Phase 2). Builds on Commit 2.
4. **Commit 4** — Sub-hire group as own top-level section (Phase 3a).
5. **Commit 5** — Kit boundary tightening (Phase 3b).
6. **Commit 6** — Tests (Phase 4) + explicit category-total regression test.
7. **Commit 7** — FEATUREDOCS/13-pdfs.md + TODOS.md updates.

All atomic, each independently revertable. Each commit must pass `npm test` and `npm run build`.

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | CEO/D1 | Delivery docket expands groups with serials | User-confirmed premise | — | Warehouse handover evidence. User chose B. |
| 2 | CEO/D2 | Per-template `expandGroups` setting | User-confirmed premise | P1+P5 | User chose B. Matches Current RMS / Rentman behaviour. |
| 3 | CEO/D3 | Ship standalone, Cross-Type Unification next | User-confirmed | P6 | Active pain TODAY. User chose A. |
| 4 | CEO | Snapshot fixtures land before refactor | Auto | P1 (completeness) | Lock baseline on all 6 doc types before touching shared code path. |
| 5 | CEO | No max-nesting cap in new helpers | Auto | P2 (boil lakes) | Child Assets/Accessories will need 3rd level — leave room. |
| 6 | CEO | Explicit category-total regression test | Auto | P1 | Sub-hire item placement risk on shared invoice path. |
| 7 | CEO | Defer Cross-Type Unification to next branch | User-confirmed | P3 (pragmatic) | Active bug fix > theoretical unification. |
| 8 | CEO | Defer section-based template builder fold-in | Auto | P3 (pragmatic) | Larger refactor; address in Cross-Type Unification PR. |
| 9 | CEO | Wrap sort behind `getPackerSortOrder(org)` helper | Auto | P2 (boil lakes) | Per-org config becomes 10-min change later. |
| 10 | Eng | Add `subHireGroups` to Prisma include in Phase 0 | Auto | P1 (completeness) | Plan ships broken without this — sub-hire section never renders. |
| 11 | Eng | Use composite Map keys (`group:<id>`, `category:<id>`, `subhire:<id>`) | Auto | P1+P5 | Eliminates Category/Group name-collision class of bugs. |
| 12 | Eng | Delete `gearflow-table.ts:237-256` delivery-docket special-case in Phase 1 (not 3b) | Auto | P4 (DRY) | Otherwise both grouping pipelines run and fight over the same docType. |
| 13 | Eng | Add pagination orphan check (header + 1-row reservation) | Auto | P1 | Header alone at page bottom is a visible regression vs today. |
| 14 | Eng | Rename `expandGroups` → `expandProjectGroups` | Auto | P5 (explicit) | Avoids collision with `ProjectGroup`/`groupId`/`groupName`/`showGroupHeaders`. |
| 15 | Eng | Extract `structureLineItems()` helper before adding the conditional | Auto | P5 (explicit) | 10+ branches in one function; helper is testable in isolation. |
| 16 | Eng | Sub-hire precedence: items with both `categoryId` and `subHireGroupId` go to sub-hire section, excluded from category | Auto | P5 (explicit) | Documented in helper JSDoc + snapshot test. |
| 17 | Eng | Phase 1 time estimate revised ~45min → ~2h | Auto | — | 10+ branches + helper extraction + Map-key fix + special-case delete + orphan check. |
| 18 | Eng | Snapshot fixtures expanded: collision, sub-hire-targetGroupId, kit-in-group, empty group, no-categories, 50+ items | Auto | P1 | Locks every failure-mode scenario before refactor. |
| 19 | Eng/T1 | Legacy settings: read-time merge with `getDefaultSettings(docType)` | User-confirmed taste | P5 (explicit) | User chose A. No migration risk; matches `generate-pdf.ts:92` pattern. |
| 20 | Eng/T2 | Audit + fix both legacy and section-renderer pipelines in this PR (~1h added to Phase 1) | User-confirmed taste | P1 (completeness) | User chose A. Eliminates ship-broken-for-some-orgs risk. |

## Follow-ups (TODOS.md)

- Configurable packer order per org (default: location → category) — P3 if Two Toned asks
- Custom field per asset for "case number" — superseded by Kit feature
- Operator override: per-project packer order — defer

