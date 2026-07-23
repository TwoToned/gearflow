# Maps Integration — Address Autocomplete & Interactive Maps

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview
Universal address autocomplete (Google Places API) and interactive maps (Google Maps) across Location, Client, and Supplier entities. Selecting a suggestion captures coordinates and displays a map on detail pages. Freeform text works without coordinates — no map, just text.

## Environment Variables
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps API key with **Maps JavaScript API** and **Places API** enabled. Without this key, address input works as plain text (no autocomplete or maps).

## Components

### GoogleMapsProvider (`src/components/providers/google-maps-provider.tsx`)
- Wraps the app in `@vis.gl/react-google-maps` `<APIProvider>` with the API key
- Added to root layout inside `GlobalErrorBoundary`
- Gracefully renders children without wrapping if no API key is configured

### AddressInput (`src/components/ui/address-input.tsx`)
- Text input with inline autocomplete via Google Places API (New)
- Uses `useMapsLibrary("places")` from `@vis.gl/react-google-maps` to load the Places library
- Debounced (300ms), minimum 3 characters before querying
- Shows teal `MapPin` icon when geocoded; clears on manual edit
- `countryCode` prop biases results via `includedRegionCodes`
- On selection: creates `Place` instance and calls `fetchFields()` to get `formattedAddress` + lat/lng
- Keyboard navigation: arrow keys, enter to select, escape to close
- Dropdown shows "Powered by Google" attribution (required by ToS)
- Use with `Controller` from React Hook Form

### AddressMap (`src/components/ui/address-map.tsx`)
- Google Maps via `@vis.gl/react-google-maps`, dynamically imported (no SSR)
- Dark mode: `colorScheme: "DARK"` (built-in); Light mode: `colorScheme: "LIGHT"`
- Teal-colored `AdvancedMarker` with `InfoWindow` popup showing label + address
- "Get Directions" link (Apple Maps on iOS, Google Maps elsewhere)
- Inner component at `src/components/ui/address-map-inner.tsx`

### AddressDisplay (`src/components/ui/address-display.tsx`)
- Conditional wrapper: map if coordinates exist, plain text if only address, nothing if empty
- `compact` mode (150px, non-interactive) for cards/sidebars

## Country Bias
- `OrgSettings.country` (ISO 3166-1 alpha-2, e.g. "AU") set in Settings -> General
- `useOrgCountry()` hook (`src/lib/use-org-country.ts`) reads from cached org query
- Passed as `countryCode` to `AddressInput` in all forms
- Google Places `includedRegionCodes` restricts results to that country

## Database Fields
All coordinate fields are `Float?` (nullable). No coordinates = freeform text, no map.

| Model | Fields |
|-------|--------|
| **Location** | `latitude`, `longitude` |
| **Client** | `billingLatitude`, `billingLongitude`, `shippingLatitude`, `shippingLongitude` |
| **Supplier** | `latitude`, `longitude` |

Migration: `20260314100000_add_address_coordinates` (additive, safe for production)

## Coordinate Validation (Zod)
Coordinate fields use `z.union([z.null(), z.coerce.number()]).optional()` — the `z.null()` branch **must** come first in the union to prevent `z.coerce.number()` from coercing `null` to `0` (since `Number(null) === 0`). This ensures clearing an address properly nullifies coordinates so the map is hidden.

## Child Location Inheritance
- Child locations without their own address/coordinates inherit from their parent
- **Server-side** (`getProject`): location inheritance is resolved before returning, so project pages always show the resolved address and map
- **Client-side** (location detail page): falls back to `location.parent.address` / `location.parent.latitude` / `location.parent.longitude` when the child's own values are null
- **Edit form**: parent's address is shown as placeholder text (`"Inherited: {parent address}"`) with a hint below. Clearing the address field restores inheritance. The form always saves the child's own raw values (empty = inherit)
- `getLocation` returns raw (non-inherited) data so the edit form can distinguish between own and inherited values

## Get Directions
- Project detail page: "Get Directions" link shown on the Location card when coordinates exist
- Location detail page: shown via `AddressDisplay` -> `AddressMap` which includes directions link
- Links to Google Maps (`maps/dir/?api=1&destination={lat},{lng}`); iOS variant uses Apple Maps

## SelectValue Gotcha
All `Select` dropdowns must pass explicit label children to `<SelectValue>` because Base UI renders items in a portal and `SelectValue` cannot resolve portal-rendered items. Without this, raw enum values (e.g. "WAREHOUSE") or IDs are displayed instead of human-readable labels.

## Where Used

### Forms (AddressInput replaces plain text inputs)
- Location form: `address` field (with parent address as placeholder for child locations)
- Client form: `billingAddress` and `shippingAddress` fields
- Supplier form: `address` field

### Detail Pages (AddressDisplay shows map or text)
- Location detail: full-width map (250px) below header (inherits from parent if no own address)
- Client detail: compact maps in addresses card (billing + shipping)
- Supplier detail: compact map in contact card
- Project detail: location card shows address, map coordinates inherited from location (including parent inheritance), "Get Directions" link

## Dependencies
- `@vis.gl/react-google-maps` (map rendering + Places API loading)
- Google Maps JavaScript API + Places API (New) (requires API key)
