# Mobile & PWA

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The compliance target is **DESIGN.md §15 (Mobile Rules)** and **§16 (Bottom Nav)**.
Those sections are the spec; this file records how the app implements them.

## Automated compliance guard

`src/lib/__tests__/mobile-compliance.test.ts` runs in normal CI (`npm test`) and
statically enforces three §15 rules that **typecheck, lint and `next build` all
pass on when violated** — they only show up when you open the app on a phone:

1. No unprefixed `grid-cols-3`+ (§15 caps mobile at 2 columns).
2. Every `opacity-0 group-hover:opacity-100` control also un-hides under
   `pointer-coarse:`. Tailwind gates `hover:` behind `@media (hover: hover)`, so
   without this a hover-reveal control is **invisible and untappable** on touch.
3. No `<Button size="icon">` shrunk below 44px without either a breakpoint
   restore (`size-11 sm:size-8`) or the `.touch-target` class.

Each rule has an allowlist keyed by file path, with a reason. Add to the
allowlist rather than loosening the pattern.

Playwright (`playwright.config.ts`) additionally defines `mobile-chrome`
(Pixel 5), `mobile-safari` (iPhone 12) and `tablet` (iPad Mini) projects. Those
device profiles carry a **coarse pointer**, which is what actually activates the
`pointer-coarse:` styles and the `.touch-target` media query — a narrow desktop
window does not.

## PWA Configuration
- Manifest: `public/manifest.json` — `display: standalone`, icons 192/384/512, start URL `/dashboard`
- Service worker via `@ducanh2912/next-pwa`
- Offline page: `src/app/offline/page.tsx`
- Meta: `apple-mobile-web-app-capable: yes`, `statusBarStyle: black-translucent`

## iOS PWA Viewport Fix (`src/app/globals.css`)
With `viewport-fit: cover` + `black-translucent`, iOS pushes content into the status bar but doesn't extend viewport height, leaving a bottom gap. Fix:
```css
html { min-height: calc(100% + env(safe-area-inset-top)); }
@media (max-width: 767px) {
  .app-shell { position: fixed; inset: 0; overflow: hidden; }
}
```

**Consequence for testing:** because `.app-shell` is `position: fixed` on mobile,
`window.scrollTo()` does nothing. The scroll container is `<main>`. Scroll it
directly (`document.querySelector("main").scrollTop = N`).

## Safe Area Pattern
**Always use inline styles for `env()` values** — Tailwind arbitrary values don't reliably preserve `env()`:
```tsx
// CORRECT
style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
// WRONG - may not work on iOS
className="pt-[env(safe-area-inset-top,0px)]"
```

Applied on: TopBar, Sheet (sidebar), full-screen mobile dialogs, MobileNav, AdminShell.

## App Layout Structure (mobile)
```
div.app-shell (position: fixed, inset: 0, flex column, overflow: hidden)
├── SidebarProvider (flex-1, min-h-0)
│   └── SidebarInset (min-h-0, flex column)
│       ├── TopBar (sticky, paddingTop: safe-area-top)
│       └── main (flex-1, overflow-y-auto overflow-x-clip ← content scrolls here)
└── MobileNav (shrink-0, paddingBottom: safe-area-bottom, md:hidden)
```

⚠️ `main` is `overflow-x-clip`. Horizontal overflow is **cut off, not scrollable** —
an element that extends past the viewport is silently unreachable, not
swipe-able. This is how the primary CTA on six list pages ("New job", "New
model", "Export CSV") went missing until the DataTable toolbar was made to wrap.

## Mobile Bottom Nav (`src/components/layout/mobile-nav.tsx`)
- Flow element (NOT position: fixed) — sits at bottom of flex column
- 5 items, matching DESIGN.md §16: **Dashboard, Jobs, Warehouse, Crew, Assets**
- Tag entry and lookup live on the Warehouse screen (`warehouse/page.tsx`), not
  in the nav.
- Any IA change (add/remove/reorder/rename) must be applied to BOTH
  `mobile-nav.tsx` and `app-sidebar.tsx` in the same PR.
- The full nav (everything beyond these 5 tabs + user/logout) lives in the
  off-canvas sidebar `Sheet`, opened by the `SidebarTrigger` hamburger in the
  TopBar. That `Sheet` **is** `AppSidebar`'s mobile rendering — it must stay
  mounted on mobile, so the sidebar is not stripped on small screens.

## Card lists, not data tables (§15)

`DataTable` (`src/components/ui/data-table.tsx`) renders a **card list below `md`**
and the table at `md` and up. Both trees are in the DOM; the swap is a pure CSS
breakpoint (`md:hidden` / `hidden md:block`), which avoids a hydration flash and
keeps the hidden tree out of the accessibility tree (`display: none`).

Columns declare the slot they occupy in the card via `ColumnDef.mobile`:

| Role | Meaning |
|---|---|
| `title` | Primary identifier. One per table. |
| `subtitle` | One secondary line under the title. |
| `badge` | Status pill, top-right. Keep to 1–2. |
| `meta` | Label/value pair in the 2-column meta grid. **The default.** |
| `actions` | Trailing overflow menu. |
| `hidden` | Omitted from the card. |

With no annotation at all, the first visible column becomes the `title` and the
rest become `meta` — a table gets a usable card layout for free.

Two things to know when annotating:

- **Composite title cells.** Several `title` cells already render a muted subline
  inside them (project name → client, crew name → "role · department", asset
  model → category). Mark that underlying column `hidden`, or the card prints the
  value twice.
- **Empty values.** A meta pair is dropped when its value is empty, so cards
  don't print "—" noise. This is inferred from `accessorKey`. When a column has a
  custom `cell` and no accessor, give it `mobileEmpty: (row) => boolean`.

Opt out with `mobileCards={false}` only for genuinely grid-shaped data where a
horizontally scrolling table beats cards.

### `MobileCardList` — cards for bespoke `<Table>` sub-tables
Many surfaces are a bespoke ui `<Table>` (a detail-page sub-table, a settings list),
not a full `DataTable` — they shouldn't inherit DataTable's toolbar / filter / search /
pagination, but they still need cards below `md`. `MobileCardList` (exported from
`components/ui/data-table.tsx`) is the DataTable card renderer extracted standalone: it
takes the same `ColumnDef[]` mobile roles (`title`/`subtitle`/`badge`/`meta`/`actions`)
and renders just the card list. Pair it with the existing desktop table via a CSS
breakpoint swap (both mount, one is `display:none` — hydration-safe, same as DataTable):

```tsx
const cols: ColumnDef<Row>[] = [
  { id: "name", header: "Name", mobile: "title", cell: (r) => <Link …>{r.name}</Link> },
  { id: "status", header: "Status", mobile: "badge", cell: (r) => <StatusIndicator … /> },
  { id: "created", header: "Created", mobile: "meta", cell: (r) => fmtDate(r.createdAt) },
];
<div className="hidden … md:block"><Table>…existing table…</Table></div>
{rows.length > 0 && <MobileCardList className="md:hidden" data={rows} columns={cols} getRowId={(r) => r.id} />}
```

The `columns` `cell` renderers MUST be pure/presentational (they render on both
breakpoints). Reuse the exact JSX the desktop `<TableCell>` renders. Converted so far:
`clients/[id]`, `suppliers/[id]`, `locations/[id]`, `assets/registry/[id]`,
`assets/categories/[id]`, `assets/models/[id]`, `kits/[id]`, `projects/templates`,
`settings/check-items`, `settings/services`, `settings/test-and-tag/profiles`,
`model-roi-tab` (projects list), `auditor/[token]` (public report),
`model-checks-tab` + `kit-checks-tab` (checklist editors — reorder ▲▼ is
desktop-only, dropped on mobile), `test-and-tag/[id]` (test history — row
expansion is desktop-only), `sub-hire-expanded-items` (flattened grouped items),
and warehouse `close-out-tab` (read-only exceptions as scan-card-style cards —
inline, since the `scan-card.tsx` primitives all require an interactive control),
`crew/[id]` (assignments, availability, time-entries sub-tables). The project
**crew panel** (`crew-panel.tsx`) uses the equipment-style self-branch card
instead (its `AssignmentRow`/`PhaseGroup` render a card below `md`) because it
has bulk-select + an inline status control MobileCardList can't host. The
**sub-hire order dialog** (`sub-hire-order-dialog.tsx`) likewise self-branches its
`SubHireItemRow` item tables to cards below `md` (the dialog itself is already a
scrollable `max-h-[85vh]` sheet). With this the bespoke-table→cards sweep is
**complete** — every operator-facing list table renders as cards on a phone.
Genuinely grid-shaped
surfaces (calendars, the crew planner matrix, ROI/allocation matrices, the print
pull-sheet, desktop-only admin) stay tables — do NOT `MobileCardList` those.

### Project equipment tab — table on desktop, cards below `md`
The equipment tab (`components/projects/equipment-tab.tsx`) is a bespoke table, not a
`DataTable`, so it can't inherit the free card layout. Instead each row component in
`components/projects/equipment-rows.tsx` (`LineItemRow`, `GroupRow`, `SubHireGroupRow`,
`CategoryRow`) **self-branches on `useIsMobile()`**: desktop returns its `<TableRow>`,
mobile returns a card variant that reuses the row's already-computed vars and live
Convex subscriptions (collaboration lock chip, `ReviewMarkerBadge`, comment-thread
count/panel, per-unit `LineAssetsIndicator`). The card presentation primitives live in
`components/projects/equipment-cards.tsx` (`MetricLine`, `GroupCard`,
`CategoryCardHeading`, `CardAddButton`), styled to match the warehouse `scan-card.tsx`
family.

**Three-tier card style (so the nesting reads at a glance):**
- **Container cards** — project groups, sub-hire groups, and kits / accessory-parents
  (any line with children). `bg-card` + **`ring-1 ring-line-2`** (heavier edge), a
  leading glyph (`Container` / `Handshake` / `Package`), a `font-medium` **weight** title,
  and a qty·total summary. **Same compact size (`py-2`, `text-table-cell`) as line-item
  cards** — containers are set apart by the glyph, heavier ring, weight and summary, NOT
  by a larger title (deliberate: user asked for one uniform card size).
- **Line-item cards** (leaf) — plain items. `bg-card` + `ring-1 ring-line`, `py-2`,
  `text-table-cell` title. Grouped / sub-hire members (desktop `indent="ml-12"`) get a
  small **`ml-3` left inset** so they nest under the container above.
- **Child rows** — kit members / accessories inside a container. `bg-paper-2/40`, no
  ring, `pl-6` — the most recessed tier.

Selection still shows as `ring-2 ring-red` on any tier.

`equipment-tab.tsx` builds the category→group→item row map **once** and renders it in
whichever shell matches the breakpoint (desktop `<table>` in a bordered scroll
container; mobile `<div className="space-y-1.5">`), so the per-row subscriptions aren't
duplicated. Any inline `colSpan` separator/empty-state `<TableRow>`s branch to a plain
`<div>`/`CategoryCardHeading` under `isMobile` (a bare `<tr>` in a `<div>` is invalid
HTML). Tapping a line-item card toggles **selection** (like `ScanItemCard`); edit / move
/ delete live behind a trailing kebab. The reorder ▲▼ are dropped on mobile. There is no
`StickyTable` / frozen-column treatment here anymore. Smoke-tested in
`__tests__/equipment-mobile-cards.smoke.test.tsx`. Allowlisted in the compliance test.
- `app/(app)/test-and-tag/page.tsx` — the *dashboard* summary tables (Overdue /
  Due soon) stay tables, but drop to 2–3 columns below `md` via
  `hidden md:table-cell`. Verified legible at 375px. The main Test & Tag registry
  is a `DataTable` and does get cards.
- Month calendars (`availability`, `booking-calendar`, `range-calendar`) keep
  `grid-cols-7`. Seven columns is the correct rendering of a week, not a
  violation; verified legible at 375px.

## Touch Targets
`min-height: 44px; min-width: 44px` for `.touch-target` on touch devices
(`@media (hover: none) and (pointer: coarse)`). Checkboxes get 24px min size.

Three ways to satisfy the 44px rule, in order of preference:
1. Don't override `Button`'s `size="icon"` (already `size-11` = 44px).
2. Add `.touch-target` — grows the hit box on coarse pointers only, so desktop
   density is untouched. This is what §15 prescribes.
3. Breakpoint restore (`size-11 sm:size-9`) when the element must also be large
   in a narrow desktop window.

`Button`'s `size="sm"` is `h-11 sm:h-9` — 44px on a phone, 36px from `sm:` up.

Component-level mobile overrides (applied when `useIsMobile()` is true):
- **Sidebar menu buttons** (`SidebarMenuButton`): `min-h-11 py-2.5` on mobile (desktop stays compact at `h-8`).
- **Header search**: mobile trigger is `h-11 w-11`; the command palette mobile dialog is full-screen with safe-area padding.

## Hover-reveal controls

Tailwind's `hover:` variant compiles to `@media (hover: hover)`. A control styled
`opacity-0 group-hover:opacity-100` therefore stays at `opacity-0` forever on a
phone — visible nowhere, tappable nowhere. Pair it with
`pointer-coarse:opacity-100`.

Where the reveal is a full-bleed overlay (the crew and account avatar editors,
`absolute inset-0` + scrim), un-hiding it permanently would bury the avatar.
Those collapse to a 44px camera badge in the corner under `pointer-coarse:`
instead.

## Tag Entry & QR Code

### Tag Input (`src/components/ui/asset-tag-input.tsx`)
- Plain text input for asset/test tags — no camera. The in-app camera scanner
  (`html5-qrcode` via the old `BarcodeScanner`/`ScanInput`) was removed because
  it never worked reliably on iPhone.
- Manual typing works everywhere. External USB/Bluetooth HID barcode wedges
  behave like a keyboard, so physical scanners still work — they "type" the tag
  and submit on Enter through each call site's existing keydown/form handler.
- QR generation (`qrcode`, `react-qr-code`) and `AssetScanLog` logging are
  unaffected and retained.

### Scan Lookup (`convex/scanLookup.ts`, `resolve` query — formerly `src/server/scan-lookup.ts`)
Resolves barcode value to entity URL:
1. Check `Asset` by `assetTag` → `/assets/registry/{id}`
2. Check `Kit` by `assetTag` → `/kits/{id}`
3. Check `BulkAsset` by `assetTag` → `/assets/registry/{id}`
4. Check `TestTagAsset` by `testTagId` → `/test-and-tag/{id}`

### QR Code Generation
`src/components/assets/asset-qr-code.tsx` — generates and prints QR codes encoding asset tag value.

## Full-screen mobile dialogs
Dialogs that benefit from edge-to-edge space on phones switch to a full-screen
sheet when `useIsMobile()` is true: `h-[100dvh] max-h-[100dvh] w-full max-w-full
rounded-none border-0` plus `env(safe-area-inset-*)` padding. Examples:
`CommandSearch` dialog and the task edit dialog in `tasks-panel.tsx`.
