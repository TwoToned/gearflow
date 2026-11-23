# Customizable Dashboard — the drag-and-resize widget board

> _Owner: Jayden Nawotka · Last reviewed: 2026-11-21 (review quarterly — POLICY.md R-5.5)_

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

## Home v2 (UX Phase 11, §6c, 2026-11-21)

The same eleven kinds, grid and per-user save, in a calmer skin:

- **Header.** `Good morning, Jayden`, then the date · org name, then ONE red `+ New job`.
  Warehouse, Add gear and `Customise…` live in the page ⋯ (`ActionMenu`, spec from
  `src/lib/row-actions/home-page.ts`). An item the viewer can't take is absent:
  Warehouse needs `warehouse:read`, Add gear needs `asset:create`, and Customise is
  desktop only. The aside line under the greeting is gone; it repeated the Overdue
  returns tile.
- **Customise (desktop only, D89).** It is entered from the ⋯. While customising, the
  primary becomes `Done`, with `Add widget` and `Reset layout` beside it. The widget title
  is the drag handle, a dashed frame replaces the hairline, and `Hide` (✕) removes the
  widget from the board.
  - **Every layout change toasts with Undo (Q6):** move, resize, hide, add and reset.
    `useDashboardLayout` returns ONE `LayoutRestore` closure per change, and the page hands
    it to `announceListWrite`.
  - **An Undo is tied to the board its change produced.** Once a later change moved the
    board, an older Undo refuses ("Layout changed since. Undo the newer change first.")
    instead of silently reverting the later change too.
  - A no-op (for example, Reset on the default board) doesn't toast.
  - A failed save is surfaced, not swallowed.
  - **Per org.** The board is stamped with its org. An org switch drops the pending save,
    takes a fresh row id and re-hydrates from the new org's row; `dashboardLayouts.get` /
    `saveNative` take an optional `orgId` that must match the token's org, so org A's
    board can never be written into org B. An Undo held from the old org writes nothing,
    and Customise mode ends.
  - **Hiding the setup panel hides both setup kinds** in one change (`withoutWidget`), and
    `Add widget` offers the panel again (once, as its first kind) when neither is on the
    board (`addableKinds`).
  - A stat tile doesn't navigate while customising.
  - The keyboard handle (↑↓ Enter Delete) and the per-widget ⋯ (Move, Width, Hide) from
    §6c.3 are deferred follow-ups.
- **Phone.** The board is read-only, in the saved (y, x) order, with the stat tiles two to
  a row. Customise is absent; the ⋯ sheet says it is on desktop. `+ New job` is a sticky
  bar above the bottom nav (`PinnedAboveBottomNav`).
- **Chrome.** `DashboardCard` is a hairline top rule with:
  - a 13 px/600 title;
  - a muted mono count;
  - a quiet `View all ›` from the registry's `viewAll`. The grid drops it when
    `canOpenLink` fails for the viewer's role. `canOpenLink` is the shell's own rule
    (`canSee` in `nav.ts`): ANY action on the resource opens it (`reports` grants
    `view`, not `read`). On a phone it has the shared `.tap-area` (44 px hit area).

  Widgets write their count, and one header action (the setup panel's Dismiss), into the
  card header through `WidgetCount` / `WidgetAction` (`widget-chrome.tsx`, portals). A stat
  tile (`stat: true`) has no header outside Customise.
- **Links: ONE table, `src/lib/dashboard-links.ts`.** Every tile, line and View all reads
  its href and tooltip from it. `dashboard-links.test.ts` proves that each href is a real
  route and survives the Jobs or Assets URL parser.

  | Tile | Opens |
  |---|---|
  | Active jobs | `/projects?seg=active` (D86) |
  | Overdue returns | `/projects?overdue=1`: segment All, the shared rule, D85/Q1 |
  | Gear deployed | `/assets/registry?status=CHECKED_OUT`. Not the `on-jobs` segment, which also counts RESERVED. |
  | Crew booked | `/crew` |

  The Overdue returns tile counts **jobs** (`overdueReturnJobs`, `n+` when truncated); the
  lines still out (`overdueReturns`) are its sub-line, `67 items to chase`.
- **Needs attention** is a set of dot-word lines with a mono count, derived by the pure
  `src/lib/needs-attention.ts`.
  - **Gating.** Each read is skipped when the role can't open the list it links to
    (`useAuthedQuery` doesn't catch errors, so hiding the line alone would not be
    enough). The line is then absent:

    | Source | Read needed |
    |---|---|
    | stats, blockers, overbookings | `project` |
    | sub-hire | `subHire` + `supplier` (it opens Suppliers) |
    | finance | `invoice` |
    | crew offers | `project` + `crew` |

    The maintenance lines are dropped without `maintenance`. On top of the read's gate,
    every line checks its TARGET (`canOpen` → `canOpenLink`), so a line only exists when
    the role can both count it and open where it links.
  - **Suppression.** The overdue-returns line is suppressed while its stat tile is on the
    board (`DashboardBoardContext`), so the same fact never shows twice.
  - **D88.** `N invoices overdue · $X outstanding` comes from `financeOrg.counts`
    `overdueCount` / `overdueOutstanding`.
  - **All clear** is a sentence; the mascot is gone.
- **Setup panel** (`setup-panel.tsx`). Finish setup and Get started are ONE panel (§6c.2,
  Q2): one progress line, and rows with a destination word (`Branding ›`).
  - The rows come from `useFinishSetupState` / `useActivationState`, with every row still
    derived from real org state.
  - **Dismiss with Undo.** Dismiss acts on each visible half (`Promise.allSettled`). Its
    Undo calls `undismissNative` with exactly the ids that click created, even when the
    other half failed. A half that was already dismissed creates nothing, so Undo doesn't
    touch it. The activation-dismissed analytics fire only for a dismissal that happened.
  - **Reads.** With no setup kind on the board every setup read is skipped. While they
    load the slot keeps its height (a skeleton), so the board doesn't shift. Milestone
    analytics (`useActivationMilestoneAnalytics`) are mounted by the board, outside the
    slot, so they keep reporting once the panel is dismissed or hidden.
  - **One slot.** Both kinds stay registered. `renderedWidgets()` renders the panel in the
    first of the two slots in reading order and drops the other, and drops both once
    neither half has anything to show. This fixes the old "empty shell" limitation.
  - **Title.** The slot's title follows what the panel shows, not which kind hosts it:
    "Finish setup" while the setup half shows, else "Get started" (`useSetupPanelState`).
- **My tasks.** A tick completes with the same `projectTasksWrites.updateNative` write
  `/my-tasks` uses. The toast's Undo restores the exact prior status. Due reads `2d
  overdue` / `Today` / the date (`src/lib/home-rows.ts`). High priority is a dot-word. The
  row ⋯ has Open and Mark done. The tick and Mark done are ABSENT for a role without
  `work:update` or `project:update` (the pair the write checks).
- **On the floor now.** The ORG's live jobs (the Jobs `out` segment through
  `projects.listPage`, `useNativeFloorJobs`), soonest due back first, in two columns. The
  header counts the org-wide total, never a slice, matching its org-wide `/warehouse`
  link. The status word is the real one: `Out` for CHECKED_OUT, `On site` for ON_SITE (it
  used to say On site for both). An overdue job is red.
- **Upcoming.** Dot-word status, the lock glyph and a mono date range. Quoted and booked
  jobs (`HOME_UPCOMING_STATUSES`, `convex/lib/jobStatusGroups.ts`, shared with
  `dashboardLists.upcoming`). `View all ›` → the Jobs list filtered to exactly those
  statuses, so it holds every row the widget showed. The header prints `8+` once the read
  returned its limit.
- **Recent activity.** Sentences with who · when; no icon discs. `View all ›` →
  `/activity` (gated on `reports`).

## What it is

The page ⋯'s `Customise…` (desktop only) switches between a locked VIEW mode (no drag
handles, resize corners or Hide buttons; clicks on widget content just navigate) and an
EDIT mode that reveals all three, plus `Add widget` and `Reset layout`. Each change saves as
it happens (debounced) and toasts with Undo. The greeting and the `+ New job` primary stay
FIXED page furniture above the grid, never a widget, so the page always has something
recognizable on it even with an emptied board.

## Widget catalog — zero new backend reads (R-3.1)

Every v1 widget is a thin extraction of JSX/logic that already rendered on
`/dashboard`, into its own file under
`src/components/dashboard/widgets/`, reusing the exact same data hooks:

| Widget kind | Source | Extracted from |
|---|---|---|
| `onTheFloorNow` | `use-native-dashboard.ts`'s `useNativeFloorJobs` (`projects.listPage`, segment `out`; was the user's own `useNativeHome` projects until the Phase 11 review) | dashboard Zone 1 |
| `needsAttention` | several `useNative*` hooks | dashboard Zone 2 chip tray |
| `statActiveJobs` / `statOverdueReturns` / `statGearDeployed` / `statCrewBooked` | `useNativeDashboardStats` | dashboard Zone 3 (4 separate widgets, not one — each independently sizeable/removable). UX Phase 11 (D85): `dashboardStats.bundle` also returns `overdueReturnJobs` (overdue-return JOBS, the shared rule in `convex/lib/overdueReturns.ts`, the same set the Jobs `overdue=1` filter lists) and `overdueTruncated`; `overdueReturns` stays the line count, now the tile's sub-line |
| `upcomingProjects` | `useNativeUpcoming` | dashboard Zone 3 |
| `recentActivity` | `useNativeActivity` | dashboard Zone 3 |
| `finishSetupChecklist` | `<SetupPanel>` (one panel with the activation half) | dashboard (C6, #1104) |
| `activationChecklist` | `<SetupPanel>` (same panel; only the first slot renders) | dashboard (D1, #1105) |
| `myTasks` | `<MyTasksWidget>` | The caller's open tasks (first 6), linking to `/my-tasks` — **in the default layout** |

The registry (`src/lib/dashboard-widgets.ts`) is the single source of truth
for `{ title, description, component, defaultSize, minSize, maxSize }` per
kind (plus `stat`, `viewAll` and `setupSlot`). It also holds:
- `DEFAULT_DASHBOARD_LAYOUT`, what a fresh board or `Reset layout` produces. Since D87 the
  order is: setup panel → four stat tiles → My tasks + Needs attention (6 + 6) → On the
  floor now → Upcoming → Recent activity.
- `DASHBOARD_WIDGET_ORDER`, the `Add widget` listing order. With either setup kind on the
  board, the other isn't offered.
- `renderedWidgets()`, what actually renders. A widget kind is a singleton per board (`id === kind`) — v1's
widgets take no per-instance config.

### The setup panel's Dismiss vs Hide

The panel's Dismiss is a DIFFERENT bit from hiding the widget on one board. It writes the
per-(org, user) `orgSetupDismissals` / `orgActivationDismissals` rows, so the panel stays
gone on every board that user has, until Undo. Hide only changes this layout. Since Phase 11
the grid drops the panel's slot before react-grid-layout once neither half has anything to
show (`renderedWidgets` + `useSetupPanelVisible`), so no empty shell is left behind.

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
dragging around for a few seconds produces ONE write. Since UX Phase 11, each change
returns a `LayoutRestore` closure, the toast's Undo. A no-op change returns `null` and
doesn't toast. A failed save shows an error toast instead of being swallowed.

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
two-column CSS grid in saved `(y, then x)` order (`readingOrder`). Stat tiles take one
column, everything else spans both. The same `<DashboardCard>` shell is used, and it is
**read-only**: `editMode` is ignored on a phone (D89). Touch drag-and-drop is unreliable
enough that RGL's own one-column breakpoint wasn't worth making work, and the
add/remove-only phone Customize was removed. The phone shows the arrangement made on a
desktop.

## Tests

- `convex/dashboardLayouts.test.ts` — round-trip, upsert-not-duplicate,
  cross-user/cross-org isolation (R-8.4.3), anonymous rejection, geometry
  validation, the widget-count cap.
- `src/components/dashboard/__tests__/dashboard-grid.smoke.test.tsx` renders the grid for
  real. It checks:
  - every widget renders, and an unknown saved kind is dropped;
  - stat tiles are headerless outside Customise;
  - `View all ›` is gated by role;
  - Hide only appears in edit mode, and calls back with the right id;
  - the phone path is read-only, with stat tiles two to a row.
- `src/components/dashboard/__tests__/setup-panel.smoke.test.tsx` covers the merged panel:
  - loading and dismissed states;
  - destination words;
  - pending invites counting toward Team;
  - the merge with Get started;
  - Dismiss → Undo with exactly the created ids, and no Undo when nothing was created.
- `src/app/(app)/dashboard/__tests__/dashboard-page.smoke.test.tsx` runs the real layout
  hook over a stubbed Convex and OPENS each overlay. It checks:
  - the D87 order;
  - the D85 tile;
  - the Needs attention lines, suppression and invoice gating (the finance read never
    runs without `invoice:read`);
  - the page ⋯ and `Customise…`, including Hide → Undo, Add widget and a no-op Reset;
  - the phone sheet (no Customise) and the sticky `+ New job`;
  - the My tasks tick → Undo.
- Pure:
  - `src/lib/dashboard-links.test.ts`;
  - `src/lib/needs-attention.test.ts`;
  - `src/lib/home-rows.test.ts`;
  - `src/lib/dashboard-widgets.test.ts` (D87 order, no overlaps, every kind present, a
    pre-D87 saved board still loads, one setup slot);
  - `src/lib/row-actions/home-page.test.ts`.
