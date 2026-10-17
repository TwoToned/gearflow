# Customizable Dashboard — the drag-and-resize widget board

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-18 (review quarterly — POLICY.md R-5.5)_

Per explicit product-owner sign-off, reverses the "no widget boards" decision
DESIGN.md's "Dashboard Layout" section used to record — see that section for
the dated rationale. `/dashboard` is now a per-user, drag-and-resize widget board built on
`react-grid-layout`.

**Update (2026-10, work layer removed):** `/today` and the three Today widgets
(`todayWorkList` / `todayDayRail` / `todayNeedsYouRail`) are gone; a simple `myTasks` widget
(`MyTasksWidget` — the first few of the caller's open tasks, linking to `/my-tasks`) replaced
`todayWorkList` in `DEFAULT_DASHBOARD_LAYOUT`. Saved boards that still hold a removed kind are
filtered out at render time (`dashboard-grid.tsx`) instead of crashing; existing boards are
otherwise not rewritten.

## What it is

A "Customize" toggle in the dashboard page header switches between a locked
VIEW mode (no drag handles, resize corners or remove buttons — normal clicks
on widget content just navigate) and an EDIT mode that reveals all three
plus an "Add widget" popover and a "Reset to default" action. Leaving
Customize (or its "Done" button) persists whatever arrangement is on screen.
The greeting hero + "New job"/"Warehouse"/"Add gear" actions stay FIXED page
furniture above the grid — never a widget, so the page always has something
recognizable on it even with an emptied board.

## Widget catalog — zero new backend reads (R-3.1)

Every v1 widget is a thin extraction of JSX/logic that already rendered on
`/dashboard`, into its own file under
`src/components/dashboard/widgets/`, reusing the exact same data hooks:

| Widget kind | Source | Extracted from |
|---|---|---|
| `onTheFloorNow` | `use-native-dashboard.ts`'s `useNativeHome` | dashboard Zone 1 |
| `needsAttention` | several `useNative*` hooks | dashboard Zone 2 chip tray |
| `statActiveJobs` / `statOverdueReturns` / `statGearDeployed` / `statCrewBooked` | `useNativeDashboardStats` | dashboard Zone 3 (4 separate widgets, not one — each independently sizeable/removable) |
| `upcomingProjects` | `useNativeUpcoming` | dashboard Zone 3 |
| `recentActivity` | `useNativeActivity` | dashboard Zone 3 |
| `finishSetupChecklist` | `<FinishSetupChecklist bare>` | dashboard (C6, #1104) |
| `activationChecklist` | `<ActivationChecklist bare>` | dashboard (D1, #1105) |
| `myTasks` | `<MyTasksWidget>` | The caller's open tasks (first 6), linking to `/my-tasks` — **in the default layout** |

The registry (`src/lib/dashboard-widgets.ts`) is the single source of truth
for `{ title, description, component, defaultSize, minSize, maxSize }` per
kind, plus `DEFAULT_DASHBOARD_LAYOUT` (what a fresh board or "Reset to
default" produces — everything from the pre-widget-board `/dashboard` at its
original order/size) and `DASHBOARD_WIDGET_ORDER` (the "Add widget" popover's
listing order). A widget kind is a singleton per board (`id === kind`) — v1's
widgets take no per-instance config.

### `bare` checklists

`<FinishSetupChecklist>`/`<ActivationChecklist>` each gained a `bare`
prop: `bare` skips the component's own outer card/title (the shared
`<DashboardCard>` shell supplies both when hosted on the board) while
keeping every other behavior — including `FinishSetupChecklist`/
`ActivationChecklist`'s own "Dismiss" action, which is a DIFFERENT, org-wide
"done showing me this" bit (`orgActivationDismissals`/`orgSetupDismissals`)
from removing the widget from just this one board.

**Known limitation:** a self-hiding widget (`finishSetupChecklist`/
`activationChecklist`, which render nothing once dismissed or complete)
still occupies its `<DashboardCard>` shell on the board — react-grid-layout
needs the grid cell's DOM node to exist for its position math regardless of
whether the hosted content chose to render nothing. In practice this only
shows up once, briefly, for an org that finishes onboarding with either
widget still on their personal board; removing it (or the empty state
disappearing once the underlying checklist card is dismissed elsewhere) is
one click. A future pass could special-case auto-removal on completion.

## Persistence — `convex/dashboardLayouts.ts`

Modeled file-for-file on `savedTableViews`'/`orgActivationDismissals`'
self-scoped per-user pattern (CLAUDE.md's explicit instruction): one row per
`(organizationId, userId)`, indexed by `by_organizationId_userId` (never a
bare `by_userId` — R-8.4.3, a user is multi-org elsewhere in this codebase).
`get` and `saveNative` both derive `userId`/`orgId` from the VERIFIED token
(`getAuthContext`/`isMemberAuth`) — never a client arg — and both go through
`requireSelfScope`, the same personal-scope guard `savedTableViews*`/
`orgActivationDismissals*` use (no `Resource` fits "a user's own dashboard
arrangement"). `saveNative` re-validates widget geometry server-side
(positive `w`/`h`, non-negative `x`/`y`, no duplicate ids, ≤40 widgets) —
the client's own bounds are bypassable by any caller hitting the mutation
directly (CLAUDE.md's "the write security bar"). No row yet ⇒ `get` returns
`null` and the client falls back to `DEFAULT_DASHBOARD_LAYOUT` — the default
lives in exactly one place (`src/lib/dashboard-widgets.ts`), never invented
twice. Not audited (`writeActivityLog`) — a personal UI arrangement, not a
domain event, same call as `orgActivationDismissalsWrites.dismissNative`.
The table also carries a bare `by_organizationId` index (alongside the read
path's `by_organizationId_userId`) purely so it exports DIRECT in the per-org
export (`scripts/org-export-tables.ts`'s `DIRECT_TABLES`,
`convex/orgExport.ts`'s `exportTablePage` hardcodes that exact index name) —
without it the table would need a FILTER (full-scan) export, or worse, get
silently dropped (`convex/orgExport.test.ts`'s coverage guard is what catches
a new table missing from either bucket).

`useDashboardLayout` (`src/hooks/use-dashboard-layout.ts`) hydrates local
state once from the query result (or the default), then treats local state
as the source of truth so an in-flight drag isn't clobbered by the
subscription re-running. Writes are debounced 800ms and fire only from
`onDragStop`/`onResizeStop` (never a per-frame `onLayoutChange`) — a user
dragging around for a few seconds produces ONE write. A failed save is
silently retried on the next successful one; a personal layout write isn't
worth a toast.

## Grid engine — `react-grid-layout` v2

**Dependency justification** (`scripts/check-dependency-justification.mjs`):
no existing in-tree library does drag+resize+responsive-collision layout —
`react-grid-layout` is the standard tool for exactly this. The installed
version (2.2.4) is a full TypeScript rewrite with a hooks-based API
(`useContainerWidth`, `useGridLayout`, `useResponsiveLayout`) that REPLACES
v1's `WidthProvider(Responsive)` HOC — `<DashboardGrid>`
(`src/components/dashboard/dashboard-grid.tsx`) uses `Responsive` +
`useContainerWidth()` directly per the v2 migration guide, rather than the
older HOC pattern. Its peer dependency (`react >= 16.3.0`) and its rewritten,
actively-maintained v2 line make it React-19-clean; no fork was needed. A
`/legacy` entry point ships v1-compatible API if ever needed.

**CSS is fully overridden, never the library's default.**
`src/components/dashboard/dashboard-grid.module.css` restyles
`.react-grid-item`/`.react-grid-placeholder`/`.react-resizable-handle` (the
library's own global class names — hence `:global()` inside a CSS Module,
importable from any component per Next.js rules, rather than a plain global
stylesheet restricted to the root layout) to the app's own `--r-lg` radius,
hard-offset-shadow (`--sh-hover`) and `--primary`/`--line` tokens. The
library's own `css/styles.css` is never imported.

**`<DashboardCard>`** (`src/components/dashboard/dashboard-card.tsx`) is the
one shared shell every widget renders inside — a title bar (drag handle +
remove button, edit-mode only), a content area, and (CSS-driven) a
bottom-right resize handle. It's `forwardRef` and spreads `...rest`
deliberately: react-grid-layout's `GridItem`/`Resizable` CLONE this exact
element to attach position `ref`/`style`/`className` and drag/resize
handlers directly onto its root DOM node — a non-forwarding shell would make
the whole grid silently inert. The resize handle a `Resizable` injects
arrives via `props.children` (not the widget's own content, passed instead
as the `widget` prop) so it renders as a plain sibling of the header/body,
never nested inside the scrollable content area where it could be clipped.

## Mobile — a plain stack, not react-grid-layout's own breakpoint

Below the existing `useIsMobile()` threshold (768px, the same hook the
sidebar already uses to decide when to stack), `<DashboardGrid>` doesn't
mount `react-grid-layout` at all — it renders the same widgets as a plain
`space-y-4` stacked column in saved `(y, then x)` order, with the same
`<DashboardCard>` shell (drag handle/resize corner never shown, since
`editMode` still only reveals the remove button there). Touch drag-and-drop
is unreliable enough that trying to make RGL's own responsive 1-column
breakpoint work on mobile wasn't worth it; Customize mode still supports
add/remove on mobile (a plain click), just not drag-reorder or resize.

## Tests

- `convex/dashboardLayouts.test.ts` — round-trip, upsert-not-duplicate,
  cross-user/cross-org isolation (R-8.4.3), anonymous rejection, geometry
  validation, the widget-count cap.
- `src/components/dashboard/__tests__/dashboard-grid.smoke.test.tsx` — the
  CLAUDE.md-mandated jsdom smoke test that actually renders the grid: every
  widget's title/content shows, the remove button is edit-mode-only and
  calls back with the right id, and the mobile stacked path renders without
  mounting react-grid-layout.
- `src/app/(app)/dashboard/__tests__/dashboard-reorder.smoke.test.tsx` —
  updated for the board: mocks `useDashboardLayout` to a fixed
  `DEFAULT_DASHBOARD_LAYOUT` and re-asserts the same DOM-order/no-duplicate-
  My-work/single-blocker-surface invariants the pre-widget-board page had.
