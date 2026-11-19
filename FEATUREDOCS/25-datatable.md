# Advanced DataTable System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## ListPage — the new list pattern (Jobs and Assets, #1393; Wave D migrates the rest)
`ListPage` (`src/components/ui/list-page.tsx`, parts in `list-page-parts.tsx`) owns the page
chrome (head, segment strip, search, filter words, views, bulk bar, footer, empty states) and
renders rows through `LineRowList` — **not** `DataTable`. It is config-driven
(`{ segments, filters, sorts, columns, rowOf, rowMenu, bulk, primary, pageMenu, empty }`);
per-list configs live in `src/lib/list-views/{jobs,assets}.ts` and row menus in
`src/lib/row-actions/`. **The URL is the state** (D11): `src/lib/list-url-state.ts` is the pure
codec (defaults omitted, unknown/invalid params dropped), `useListUrlState` reads/writes it
(`replace` while typing, `push` for segment/filter/sort/page so Back works). `FilterWord` is a
Radix multi-select (`Status: 2 chosen ✕`); `ListEmpty` separates "none yet" from "nothing
matches" (`Clear filters`); phone shows cards, a sticky primary that `BulkBar` replaces, and
`Show 25 more`. `LineRowList` gained three additive props for this: `itemHeader`, sortable
headers (`sort`/`onSort`, `aria-sort`) and a `leading` slot. `useTablePreferences` and
`DataTable` remain for every list not yet migrated.

## Core Component: `DataTable<TData>` (`src/components/ui/data-table.tsx`)
- **Props**: `data`, `columns`, `totalRows`, `page`, `pageSize`, `sortField`, `sortDirection`, `filters`, `searchValue`, `columnVisibility`, plus callbacks
- **Features**: Server-side pagination/sorting, column visibility toggles (localStorage), enum filter dropdowns as checkbox popovers, text search, row selection, active filter chips
- **Column definitions**: `ColumnDef<TData>[]` with `id`, `header`, `accessorKey`, `cell`, `sortKey`, `filterable`, `filterType`, `filterOptions`, `defaultVisible`, `alwaysVisible`, `responsiveHide`

## Filter System
- **Enum filters**: Checkbox popover multi-select. Active filters shown as removable chips.
- **Filter state**: `Record<string, FilterValue>` where `FilterValue = string[] | string | { from?: string; to?: string } | boolean`
- **Server-side**: `buildFilterWhere(filters, columnDefs)` in `src/lib/table-utils.ts` — supports nested dot-paths (e.g., `model.categoryId`)

## Column Visibility
- Toggle on/off via popover. `alwaysVisible` can't be hidden. `defaultVisible: false` hidden by default.
- Persisted to localStorage via `useTablePreferences`

## `useTablePreferences` Hook (`src/lib/use-table-preferences.ts`)
- Persists sort, page size, view mode, column visibility, and filters to localStorage per table key
- Key fields: `columnVisibility`, `toggleColumnVisibility`, `filters`, `setFilter`, `clearFilters`, `resetPreferences`

## Tables Using DataTable
| Table | Location | Key Filters |
|-------|----------|-------------|
| Assets Registry | (ListPage, see above: `src/components/assets/assets-list.tsx`) | Status, Condition, Location, Category, Tags, Model |
| Equipment Models | `src/components/assets/model-table.tsx` | Category, Asset Type |
| Projects | (ListPage, see above: `src/components/projects/jobs-list.tsx`) | Status, Type, Client, PM, Dates |
| Kits | `src/app/(app)/kits/page.tsx` | Status, Condition, Location, Category |
| Clients | `src/components/clients/client-table.tsx` | Type |
| Locations | `src/components/locations/location-table.tsx` | Type |
| Suppliers | `src/components/suppliers/supplier-table.tsx` | Status (isActive) |
| Maintenance | `src/app/(app)/maintenance/page.tsx` | Status, Type, Result |
| T&T Registry | `src/components/test-tag/test-tag-table.tsx` | Equipment Class, Appliance Type, Status |
| Activity Log | `src/app/(app)/activity/page.tsx` | Action, Entity Type |

## Adding a New Table
1. Define `ColumnDef<TData>[]` with filterable columns and cell renderers
2. Use `useTablePreferences(tableKey, defaults)` for state management
3. Add `filters?: Record<string, FilterValue>` to the server action
4. Call `buildFilterWhere(filters, filterColumnDefs)` in the server action
5. Pass all state to `<DataTable>` component
6. For `tags` filters: handle separately with `{ hasSome: values }` (Prisma array filter)
7. To enable Saved Views, destructure `currentConfig, applyConfig` from `useTablePreferences`
   and pass `savedViews={{ tableId, currentConfig, applyConfig }}` to `<DataTable>` (see below)

## Saved Views (per-user, org-scoped presets)
Users can save a named filter + sort + column-visibility + page-size preset on any list
and recall it later. Views are **per-user and org-scoped** (server-persisted, so they
follow the user across devices) — unlike `useTablePreferences`, which is the user's
single live localStorage state per table.

- **Model:** `SavedTableView` (`saved_table_view`) — `organizationId`, `userId`, `tableId`,
  `name`, `config` (Json `SavedViewConfig`), `isDefault`. Unique on `(userId, tableId, name)`.
- **Config shape:** `SavedViewConfig` in `src/lib/saved-views.ts` — `{ filters, sortBy,
  sortOrder, columnVisibility, pageSize }`. Search text is intentionally NOT captured
  (it's an ephemeral lookup, not part of a reusable view).
- **Reads + writes:** `convex/savedTableViews.ts` (`list`, `getById`) and browser-direct
  mutations in `convex/savedTableViewsWrites.ts` (`createNative`, `updateNative`,
  `removeNative`, `setDefaultNative`) — the old `src/server/saved-views.ts` server
  actions (`getSavedViews`, `createSavedView`, `updateSavedView`, `deleteSavedView`,
  `setDefaultSavedView`) are gone. Personal data, so every query/mutation is scoped
  to BOTH `organizationId` AND `userId`. At most one default per `(user, tableId)`,
  enforced in the mutation (a new default unsets the prior one).
- **Hook surface:** `useTablePreferences` returns `currentConfig` (snapshot for "Save current
  view") and `applyConfig(config)` (restore a saved/default view into live state).
- **UI:** `SavedViewsMenu` (`src/components/ui/saved-views-menu.tsx`) renders in the DataTable
  toolbar when the `savedViews` prop is passed. It lists views (apply on click), shows a
  dirty marker (`*`) when the live state diverges from the active view, offers "Update",
  "Save current view…" (with a "make default" checkbox), per-view star (default toggle) and
  delete, and "Clear view". The **default view auto-applies on first mount** only when the
  table has no active filters, so it never clobbers a deep-linked or in-progress filter set.
- **URL mode (Jobs, Assets — `UrlSavedViewsMenu`, `src/components/ui/url-saved-views.tsx`):**
  a view's `config` is `{ query }`, the list's query string (`src/lib/list-views/saved-view-url.ts`;
  bounded by `MAX_VIEW_QUERY` in `convex/lib/viewLimits.ts`, enforced in `createNative`/
  `updateNative`). Applying a view is `router.push`; a saved view, a bookmark and a link are the
  same thing. Search text and the page are never captured. **Legacy rows** (`{ filters, sortBy,
  sortOrder }`) are converted ON READ by `viewQuery` (renamed keys via an alias map, anything the
  list no longer knows dropped) with no backfill. The active view is derived by matching the
  current query, so it survives a reload. A default applies only when the URL carries no list
  params. Built-ins (Jobs: My jobs, Out this week, Unquoted enquiries) are not stored and have no
  star or delete.
- **Wired on:** the 12 list pages that use `useTablePreferences` (assets, models, clients,
  crew, locations, projects, suppliers, kits, maintenance, T&T registry, activity log,
  timesheets); assets and projects now use URL mode. Damage and Stocktakes were both removed as features (`chore: remove
  Damage Capture feature`, `chore: remove Stocktake feature`) and no longer appear.

## Mobile data-table primitives (mobile-first redesign, Phase 1)

New primitives for rendering tables and dense data on phones without squishing everything
into cards. Design system: `docs/designs/archive/mobile-data-table-framework.md`.

- **`StickyTable` (`src/components/ui/sticky-table.tsx`)** — a horizontally-scrollable table
  with a frozen identity column ("Notion-style": the row label stays put while the rest
  scrolls sideways). It **owns its single scroll container** — do NOT feed it `ui/table.tsx`'s
  `<Table>` (which already wraps itself in `overflow-auto`); pass a raw `<table>` built from
  the `TableHeader/TableBody/TableRow/TableCell/TableHead` cell primitives. Freezes the first
  `frozenColWidths.length` columns via scoped, position-based CSS with cumulative left offsets
  and a seam shadow. Rows are `vertical-align:top` so wrapping cells grow downward and never
  overlap (smart wrapping). **Print-safe:** every enhancement (scroll, sticky, min-width, edge
  fade, col-count hint) is reset under `@media print`, so print-oriented sheets render exactly
  as before. Props: `frozenColWidths`, `minTableWidth`, `frozenBg`, `colCountHint`.
- **`ViewModeToggle` / `DensityToggle` (`src/components/ui/density-toggle.tsx`)** — two
  *separate* axes (eng review): view mode (`Cards | Table`, presentation) vs density
  (`Compact | Comfortable | Relaxed` = 44/52/60px row height, `DENSITY_ROW_PX`). Comparison/
  matrix surfaces omit `Cards`. Convenience hooks `useViewModePreference(tableId)` /
  `useDensityPreference(tableId)` persist per-user.
- **`usePersistentPref(key, default)` (`src/hooks/use-persistent-pref.ts`)** — localStorage
  preference **scoped to the signed-in user id**, so shared warehouse devices don't leak one
  operator's choice to the next. Re-reads the user's stored value when the session resolves
  after mount (fresh login on a shared tablet). NOTE: `useTablePreferences` still keys by table
  id alone — migrating its 14 list callers to per-user scoping is a tracked follow-up; new
  controls should use `usePersistentPref`.

Applied on: the warehouse **pull-sheet** (`warehouse/[projectId]/pull-sheet/page.tsx`) — frozen
checkbox + Item columns, the rest scroll; empty cells render blank (no "—" noise). See
`FEATUREDOCS/12-warehouse.md`.
