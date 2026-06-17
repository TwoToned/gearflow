# Mobile & PWA

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
│       └── main (flex-1, overflow-auto ← content scrolls here)
└── MobileNav (shrink-0, paddingBottom: safe-area-bottom, md:hidden)
```

## Mobile Bottom Nav (`src/components/layout/mobile-nav.tsx`)
- Flow element (NOT position: fixed) — sits at bottom of flex column
- 5 items: Home, Assets, Scan, Projects, Warehouse
- Scan button opens a manual tag-entry dialog (`AssetTagInput` + submit). The
  in-app camera scanner was removed (it never worked on iPhone); external HID
  barcode wedges still work by typing into the field and submitting on Enter.
- Entered tag resolved via `scanLookup()` → navigates to matched entity
- **Note**: A UX-gaps pass proposed dropping Scan for a "4-tab" bar citing DESIGN.md.
  DESIGN.md has no such rule and names warehouse scanning as a primary daily
  workflow, so the Scan tab is intentionally kept (see header comment in the file).
- The full nav (everything beyond these 5 tabs + user/logout) lives in the
  off-canvas sidebar `Sheet`, opened by the `SidebarTrigger` hamburger in the
  TopBar. That `Sheet` **is** `AppSidebar`'s mobile rendering — it must stay
  mounted on mobile, so the sidebar is not stripped on small screens.

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

## Touch Targets
`min-height: 44px; min-width: 44px` for `.touch-target` on touch devices. Checkboxes get 24px min size.

Component-level mobile overrides (applied when `useIsMobile()` is true):
- **Sidebar menu buttons** (`SidebarMenuButton`): `min-h-11 py-2.5` on mobile (desktop stays compact at `h-8`).
- **Header search**: mobile trigger is `h-11 w-11`; the command palette mobile dialog is full-screen with safe-area padding.

## Full-screen mobile dialogs
Dialogs that benefit from edge-to-edge space on phones switch to a full-screen
sheet when `useIsMobile()` is true: `h-[100dvh] max-h-[100dvh] w-full max-w-full
rounded-none border-0` plus `env(safe-area-inset-*)` padding. Examples:
`CommandSearch` dialog and the task edit dialog in `tasks-panel.tsx`.
