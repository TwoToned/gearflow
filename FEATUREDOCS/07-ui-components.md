# UI Component Library

## Critical Convention: `render` prop
shadcn/ui v4 uses Base UI, which uses `render` prop for composition (NOT Radix's `asChild`):
```tsx
<DialogTrigger render={<Button variant="outline" />}>Open Dialog</DialogTrigger>
<DropdownMenuTrigger render={<Button size="sm" />}>Menu</DropdownMenuTrigger>
<SidebarMenuButton render={<Link href="/foo" />}>Link Text</SidebarMenuButton>
```

## Key Custom Components
- **BarcodeScanner** (`src/components/ui/barcode-scanner.tsx`) — Camera scanner with Web Audio chime, ref-based callbacks, continuous mode
- **ComboboxPicker** (`src/components/ui/combobox-picker.tsx`) — Searchable select with `creatable` mode for new entries
- **ScanInput** (`src/components/ui/scan-input.tsx`) — Text input optimized for barcode scanner focus
- **DataTable** (`src/components/ui/data-table.tsx`) — Shared table with server-side pagination, sorting, column visibility, enum filters
- **DynamicIcon** (`src/components/ui/dynamic-icon.tsx`) — Renders Lucide icon by string name
- **TagInput** (`src/components/ui/tag-input.tsx`) — Tag input with autocomplete from org-wide suggestions
- **UserAvatar** (`src/components/ui/user-avatar.tsx`) — Avatar with image + initials fallback
- **MediaUploader** (`src/components/media/media-uploader.tsx`) — Drag-to-reorder, primary marking, bulk upload
- **MediaThumbnail** (`src/components/media/media-thumbnail.tsx`) — Image with fallback placeholder
- **AddressInput** (`src/components/ui/address-input.tsx`) — Text input with Google Places API (New) autocomplete. Shows suggestions as user types (debounced 300ms, min 3 chars). On selection, fires `onPlaceSelect` with lat/lng. Freeform text clears coordinates. Shows teal MapPin icon when geocoded. Use with `Controller` from React Hook Form.
- **AddressMap** (`src/components/ui/address-map.tsx`) — Google Maps via `@vis.gl/react-google-maps` with teal `AdvancedMarker`. Dynamic import (no SSR). Built-in dark/light mode via `colorScheme`. Shows "Get Directions" link (Google Maps / Apple Maps). Props: `latitude`, `longitude`, `address`, `label`, `height`, `zoom`, `interactive`, `showDirectionsLink`.
- **AddressDisplay** (`src/components/ui/address-display.tsx`) — Conditional wrapper: renders `AddressMap` if coordinates exist, plain text if only address, nothing if empty. Use on all detail pages. Props: `address`, `latitude`, `longitude`, `label`, `compact` (150px non-interactive map for cards).

## Dialog vs Sheet
- **Dialog**: Centered modal. Full-screen on mobile with safe area padding via `style` prop
- **Sheet**: Side drawer (sidebar). Safe area padding merged into `SheetContent` via extracted `style` prop

## Base UI Gotchas
- Checkbox uses `indeterminate` boolean prop, not string value
- SelectValue can't resolve text from portal-rendered items — pass explicit label children
- DropdownMenuLabel must be inside DropdownMenuGroup
- Use `onMouseDown` with `preventDefault` (not `onClick`) for buttons inside popovers
- No `AlertDialog` component — use `Dialog` with confirm/cancel buttons instead
