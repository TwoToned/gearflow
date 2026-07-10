# Mobile & PWA

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
- **Scanning is not a tab.** The Warehouse screen owns the scan workflow. (An
  earlier version of this doc described a `Scan` tab; it no longer exists.)
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

### Known exceptions
- `components/projects/equipment-rows.tsx` — the project equipment table (kits,
  child assets, accessories, sub-hires, drag-and-drop). Its row actions sit in a
  `w-32` cell where 44px buttons would overflow. §15's answer is a card layout
  with an overflow menu, which is a redesign rather than a sizing fix. Allowlisted
  in the compliance test.
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

### Scan Lookup (`src/server/scan-lookup.ts`)
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
