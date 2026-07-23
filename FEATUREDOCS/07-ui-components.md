# UI Component Library

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Critical Convention: overlay primitives are **Radix**, compose with `asChild`
After the RVLT rebrand, every overlay primitive in `src/components/ui/` —
`Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Select`, `Tooltip` — is built on
**Radix** (`@radix-ui/react-*`). Compose triggers with Radix's `asChild` prop
(NOT Base UI's `render`):
```tsx
<DialogTrigger asChild><Button variant="line">Open Dialog</Button></DialogTrigger>
<DropdownMenuTrigger asChild><Button size="sm">Menu</Button></DropdownMenuTrigger>
```
`@base-ui/react` is still installed but is used **only for the utility helpers**
`mergeProps` / `useRender` (in `breadcrumb.tsx`, `sidebar.tsx`) — never for
overlays.

### ⚠️ NEVER nest a Base UI overlay inside a Radix modal Dialog
A Radix modal `Dialog` sets `pointer-events: none` on `document.body` and only
re-enables it on its own DismissableLayer stack. A Base UI popover/menu/select
portals to `<body>` as a sibling and therefore inherits that lock — **every click
inside it is silently swallowed**. This was the root cause of the "can't click
crew / models / supplier-create in any form" bug (the pickers are used inside
Dialogs everywhere). The fix: keep these pickers on Radix Popover so the popup
lives in the same layer stack as the dialog. `combobox-picker.tsx` carries a
banner comment warning not to revert it to `@base-ui/react/popover`.

## Key Custom Components
- **ComboboxPicker / MultiComboboxPicker** (`src/components/ui/combobox-picker.tsx`) — Searchable single/multi select with `creatable` mode and an optional `onCreateNew` action. Built on **Radix** Popover (see the dialog-nesting warning above) — used inside Dialogs across services (crew), add-asset (models), sub-hire (supplier create), project wizard, etc. This is the **only** combobox primitive (R-8.7.2) — a second, zero-usage `combobox.tsx` (Command+Popover, plus its `command.tsx`/`cmdk` dependency) was deleted in the 2026-07-23 hygiene pass rather than kept "for later."
- **Panel** (`src/components/ui/card.tsx`) — the lighter-weight surface (`cva`, 1px `border-line` vs `Card`'s 2px `border-border`) for stat tiles and standalone content sections that don't need the full `Card`/`CardHeader`/`CardContent` structure. `padding="responsive"` adds the `sm:p-6` step used on detail-page tab panels; omit for the plain `p-5` stat-tile variant.
- **SmartFormActions / SmartFormPreviewPill** (`src/components/ui/smart-form.tsx`) — round out the `SmartFormLayout` family: `SmartFormActions` is the trailing divider-topped Cancel/Submit row every entity form ends with; `SmartFormPreviewPill` is the small type/category meta pill shown under the entity name in a `SmartFormPreview` card.
- **SearchInput** (`src/components/ui/input.tsx`) — leading-icon search box for list-toolbar search fields (`ProjectBoard`, `AssetGallery`). Owns its own `relative` wrapper; size the parent slot around it (e.g. `<div className="max-w-xs flex-1"><SearchInput .../></div>`).
- **NativeSelect** (`src/components/ui/select.tsx`) — plain `<select>` for spots that can't use the Radix `Select` (registered fields, simple status pickers). `variant="default"` matches the RVLT Input recipe; `variant="compact"` preserves the pre-rebrand shadcn recipe still used by a handful of settings/dialog selects.
- **AssetTagInput** (`src/components/ui/asset-tag-input.tsx`) — Plain text input for entering asset/test tags. Drop-in replacement for the removed `ScanInput`; the in-app camera scanner was deleted (it never worked on iPhone). Manual typing and external HID barcode wedges (which act like a keyboard) still work everywhere. Accepts and ignores the old camera-only props (`onScan`/`scannerTitle`/`showScanButton`/`continuous`) for compatibility.
- **DataTable** (`src/components/ui/data-table.tsx`) — Shared table with server-side pagination, sorting, column visibility, enum filters
- **DynamicIcon** (`src/components/ui/dynamic-icon.tsx`) — Renders Lucide icon by string name
- **TagInput** (`src/components/ui/tag-input.tsx`) — Tag/chip input with autocomplete from org-wide suggestions. Suggestion dropdown is a **Radix** Popover (was a raw `document.body` portal that broke inside Dialogs — see the dialog-nesting warning above).
- **UserAvatar** (`src/components/ui/user-avatar.tsx`) — Avatar with image + initials fallback
- **MediaUploader** (`src/components/media/media-uploader.tsx`) — Bulk upload + primary marking (manual drag-to-reorder removed; `@dnd-kit` dropped)
- **MediaThumbnail** (`src/components/media/media-thumbnail.tsx`) — Image with fallback placeholder
- **AddressInput** (`src/components/ui/address-input.tsx`) — Text input with Google Places API (New) autocomplete. Shows suggestions as user types (debounced 300ms, min 3 chars). On selection, fires `onPlaceSelect` with lat/lng. Freeform text clears coordinates. Shows teal MapPin icon when geocoded. Use with `Controller` from React Hook Form.
- **AddressMap** (`src/components/ui/address-map.tsx`) — Google Maps via `@vis.gl/react-google-maps` with teal `AdvancedMarker`. Dynamic import (no SSR). Built-in dark/light mode via `colorScheme`. Shows "Get Directions" link (Google Maps / Apple Maps). Props: `latitude`, `longitude`, `address`, `label`, `height`, `zoom`, `interactive`, `showDirectionsLink`.
- **AddressDisplay** (`src/components/ui/address-display.tsx`) — Conditional wrapper: renders `AddressMap` if coordinates exist, plain text if only address, nothing if empty. Use on all detail pages. Props: `address`, `latitude`, `longitude`, `label`, `compact` (150px non-interactive map for cards).
- **Skeletons** (`src/components/ui/skeleton.tsx`) — design-system shimmer placeholders. Base `Skeleton` plus shape presets `TableSkeleton`, `CardSkeleton`, `DetailPageSkeleton`, `FormSkeleton`, `ListPageSkeleton`. **Prefer these over bare "Loading…" text or ad-hoc `animate-pulse` divs** when a page's shape is known: form/edit pages use `FormSkeleton`, list pages `ListPageSkeleton`, detail pages `DetailPageSkeleton`. Match the page's own layout — e.g. the mobile runsheet uses shape-appropriate `Skeleton` blocks rather than the (card-grid) `DetailPageSkeleton`.

## Providers
- **BrandingProvider** (`src/components/providers/branding-provider.tsx`) — applies per-org primary-color palette overrides.
- **MiraContextProvider** (`src/components/providers/mira-context-provider.tsx`) — lightweight client context for Mira (AI assistant) state (`open`, `pageContext`); `useMira()` reads it (returns `null` if unmounted). Mounted in the app layout inside `BrandingProvider`. Kept trivial so it never blocks paint — defer the heavy assistant UI at its own mount point rather than wrapping the app in an `ssr:false` dynamic boundary (which would drop SSR for the whole subtree).

## Layout Primitives

Shared layout components live in `src/components/layout/page-layouts.tsx`:

- **ListPageLayout** / **FormPageLayout** / **DetailPageLayout** — page-level shells (header + content).
- **DetailLayout** + **DetailMain** + **DetailSidebar** — the two-column body of a detail page: a flexible main column beside a fixed-width (`lg:w-[340px]`) sticky sidebar, stacking below `lg`. All 10 detail pages use these — never hand-roll the `flex flex-col gap-6 lg:flex-row` shell.
- **SidebarSection** (`title`, `divider?`) — one block inside a `DetailSidebar`: a `SectionHeader` plus content with a bottom divider. Pass `divider={false}` on the last section to drop the trailing rule.
- **SectionHeader** — teal overline label chip.

Motion components in `src/components/ui/motion.tsx` (`FadeIn`, `StaggerList`, `StaggerItem`, `AnimatedNumber`, `SurfaceLift`, `TabFade`) read the OS reduced-motion preference from a shared **ReducedMotionProvider** context (mounted once in the root layout) rather than each calling `useReducedMotion()` independently.

## Dialog vs Sheet
- **Dialog**: Centered modal. Full-screen on mobile with safe area padding via `style` prop
- **Sheet**: Side drawer (sidebar). Safe area padding merged into `SheetContent` via extracted `style` prop

### Overflow: modals scroll by default — don't spill off-screen
`DialogContent` and `SheetContent` both cap their height and scroll internally out
of the box, so tall forms never overflow past the viewport (the old bug: content
ran off the top/bottom with no scrollbar, forcing users to zoom out).
- `DialogContent` (centered): `max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain`
- `SheetContent` base: `overflow-y-auto overscroll-contain`; `top`/`bottom` variants also cap at `max-h-[calc(100dvh-2rem)]` (`left`/`right` are already `h-full`)
- Uses `dvh` (dynamic viewport height) so mobile browser chrome doesn't clip the modal.
- Per-dialog overrides still win via `tailwind-merge`: pass your own `max-h-*` /
  `overflow-*` in the `className` (e.g. `flex flex-col` + inner scroll region, or the
  full-screen mobile `h-[100dvh]` pattern) and it replaces the default cleanly.

## Base UI Gotchas
- Checkbox uses `indeterminate` boolean prop, not string value
- SelectValue can't resolve text from portal-rendered items — pass explicit label children
- DropdownMenuLabel must be inside DropdownMenuGroup
- Use `onMouseDown` with `preventDefault` (not `onClick`) for buttons inside popovers
- No `AlertDialog` component — use `Dialog` with confirm/cancel buttons instead
