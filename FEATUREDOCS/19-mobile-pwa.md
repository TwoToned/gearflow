# Mobile & PWA

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The compliance target is **DESIGN.md §15 (Mobile Rules)** and **§16 (Bottom Nav)**.
Those sections are the spec; this file records how the app implements them.

## Automated compliance guard

`src/lib/__tests__/mobile-compliance.test.ts` runs in normal CI (`pnpm test`) and
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
Three entry paths, all landing on the same `onScan` / `onChange` handlers:
- **Typing** — the host call site's own `onChange` / keydown handling.
- **HID wedge** — a USB/Bluetooth scanner is a keyboard; it types the tag and
  fires Enter, which each call site's existing submit path already handles.
- **Camera** — a `<ScanButton>` rendered beside the field (automatically
  wherever `onScan` is supplied), opening `CameraScannerDialog`.

`className` lands on the **Input**, not the wrapper — call sites style the field
through it. Where the field sits in a `relative` box carrying absolutely
positioned overlays (the warehouse and returns hero search bars), pass
`showScanButton={false}` and place `<ScanButton>` as a flex sibling of that box,
or the button lands underneath the overlays.

QR generation (`qrcode`, `react-qr-code`) and `AssetScanLog` logging are
unaffected.

### Camera barcode scanner (`src/components/scanner/`, `src/lib/barcode/`)

Reads **QR, Micro QR and rMQR**, Data Matrix, Aztec, PDF417 and the common
linear symbologies. Replaces the `html5-qrcode`-based scanner that was removed
for never working reliably on iPhone. Full rationale and the device-verification
checklist: [`docs/designs/barcode-scanner-2d.md`](../docs/designs/barcode-scanner-2d.md).

**One WASM engine on both platforms — never the platform `BarcodeDetector`.**
`micro_qr_code` and `rm_qr_code` are not in the Shape Detection API spec, so
Chrome/Android's ML Kit backend cannot decode them either; and WebKit has never
shipped that API at all, so every browser on iOS needs WASM regardless. A
native-plus-fallback split would mean two decoders with different format
coverage behind one button — which is how the first scanner came to behave
differently on the platform nobody tested.

| Module | Responsibility |
|---|---|
| `src/lib/barcode/formats.ts` | The curated symbology list + tag normalisation. Single source of truth. |
| `src/lib/barcode/decoder.ts` | The one ZXing-C++ WASM decode entry point. |
| `src/lib/barcode/camera.ts` | Constraints, capability probing, ROI, error classification — all pure. |
| `src/hooks/use-camera-scanner.ts` | Camera lifecycle + frame pump. |
| `src/components/scanner/camera-scanner-dialog.tsx` | The full-screen viewport UI. |
| `src/components/scanner/scan-button.tsx` | The trigger; the ONE "open camera, hand back a value". |

**The decoder binary is self-hosted.** `zxing-wasm` would otherwise fetch ~930
KiB from jsDelivr at first decode — a scanner that opens the camera and silently
never decodes, on flaky warehouse wifi or behind an egress proxy. `pnpm run
wasm:sync` copies it to `public/wasm/` (committed, so `pnpm dev` needs no build
step) and `pnpm run wasm:sync:check` gates staleness in CI.

**⚠️ Five iOS rules, all load-bearing.** Every browser on iOS is WKWebView, so
"works in Chrome on iPhone" and "works in Safari on iPhone" are one question:

1. `getUserMedia` runs **only inside a user gesture** — from the dialog's open
   handler, never a mount effect. Safari rejects a prompt that isn't
   gesture-attributed, and the rejection is indistinguishable from a denial.
2. `playsInline` + `muted` + an **awaited `play()`**, set in JSX *and*
   imperatively on each start (the element is reused across opens). Miss any of
   them and the track is live while the `<video>` paints black.
3. **Never `enumerateDevices` first.** Pre-permission, iOS returns blank labels
   and deviceIds, so "pick the back camera by label" picks nothing. `facingMode:
   { ideal: "environment" }` — `ideal`, never `exact`, which
   `OverconstrainedError`s on any device without a rear camera.
4. **One live capture at a time.** A leaked track blocks the next
   `getUserMedia` app-wide, so `stopStream` runs on every teardown path: close,
   unmount, visibility change, and each early return inside `start()`.
5. **Release on hide, re-acquire on show.** iOS suspends capture when
   backgrounded and never resumes it; holding a dead track means a permanently
   black viewport.

**No torch, no zoom on iOS** — `getCapabilities()` exposes neither and
`applyConstraints({advanced:[{torch:true}]})` is a silent no-op. Both are
feature-detected so the control is *absent* there rather than dead. Same reason
there is no lens selection: the web has no equivalent of
`AVCaptureDevice.minimumFocusDistance`, so a modern iPhone gets the wide camera
(min focus ≈ 10 cm) and we compensate with resolution, not optics.

**The camera plays `capture`, never `success`.** All the decoder knows is that
it read a code; whether that tag means anything is the caller's business, and
the caller plays one of the four verdicts (`success`/`error`/`exception`/`info`)
once it has resolved the value. An earlier version played `success` on decode,
so an unrecognised tag beeped success-then-error — two contradictory answers to
one scan. `capture` is deliberately the shortest and highest tone in the set
(1200 Hz / 35 ms) plus a 25 ms haptic tick, so the pair reads as
tick-then-answer rather than as competing opinions. It is the handheld
scanner's "gun beep", and it's the feedback that matters most in a warehouse
because you're looking at the gear, not the screen. `navigator.vibrate` is
unimplemented on iOS Safari, so the haptic half is a documented no-op there.

**Layout is split explicitly by breakpoint, not by one clever responsive
class.** On a phone the viewport fills the remaining column height (`flex-1`);
on desktop the dialog has no definite height, so the viewport defines its own
with a 4/3 frame. Combining `flex-1` with `aspect-[4/3]` leaves the winner up to
flex-basis resolution — which is how the square reticle once ended up taller
than the short, wide desktop frame it sat in, poking out top and bottom.

The reticle sizes itself with `min(72cqw, 72cqh)` against a
`container-type: size` viewport. That is the CSS spelling of `computeRoi`'s
`min(frameWidth, frameHeight) * ROI_FRACTION`: a square share of the SHORTER
side, so it can never exceed the box in either axis. A plain `min(72%, 340px)`
reads 72% of the WIDTH, which is the bug above.

**The decoded region is a native-resolution centre crop**, sized from the same
`ROI_FRACTION` the on-screen reticle uses — so the box cannot lie about the scan
area. Cropping is both faster than a full frame and better at small codes: the
alternative downscales 1080p, which is exactly what destroys an 11×11-module
Micro QR.

**Testing rule:** a data-shape or option change here needs a round-trip test in
`src/lib/barcode/decoder.test.ts` — encode a real symbol, render it to
`ImageData` the way the pump does, decode it back. The absence of exactly that
test is why "it doesn't work on iOS" could ship. Unit-testing the UI around a
decoder proves nothing about whether it decodes.

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
