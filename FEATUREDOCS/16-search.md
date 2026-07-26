# Search & Command Palette

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Global Search (`convex/globalSearch.ts`)
The `search` query (called via `useGlobalSearch()`, `src/hooks/use-global-search.ts`) searches across:
- Models (name, manufacturer, modelNumber, description) — children: assets
- Assets (assetTag, serialNumber, customName)
- Bulk assets (assetTag)
- Kits (assetTag, name)
- Projects (projectNumber, name) — non-templates only
- Clients (name, contactName, contactEmail, plus every `clientContacts` row's
  name/email — WS9 #948, resolved via a per-matched-client drill over
  `clientContacts.by_clientId` rather than a 16th org-wide scan) — children:
  projects. Result subtitle prefers the client's PRIMARY contact.
- Suppliers (name, contactName, accountNumber, email, tags)
- Locations (name, address) — children: child locations
- Categories (name) — children: models
- Maintenance (title)
- Crew members (firstName, lastName, email, phone, department, role)
- Check items (label, category, description)
- Group templates (name, description) — deep-links to `/settings/group-templates`
- Sub-hires (orderNumber, supplier name, supplierReference, item descriptions) — deep-links to the parent project's equipment tab

Native Convex query — re-implements the old Postgres `pg_trgm` engine in pure JS
(`convex/lib/searchScore.ts`) so results stay live now that the domain tables are
Convex-primary and Postgres is frozen. `includesLower`/`includesNorm` mirror ILIKE
+ normalized substring matching, `trigramSimilarity` mirrors `pg_trgm` similarity
(Jaccard index over 3-grams) for fuzzy/typo matching, and `anyTagMatches` mirrors
the old raw-SQL `EXISTS(SELECT 1 FROM unnest(tags) t WHERE t ILIKE ...)` tag match —
all computed backend-local over live Convex docs in one round trip. The old
`src/server/search.ts` file (and its `globalSearch` server action) no longer exists.

## Command Palette (`src/components/layout/command-search.tsx`)
- **Normal mode**: Free text → `globalSearch()` results
- **@ mode**: Page navigation via `PAGE_COMMANDS` (`src/lib/page-commands.ts`)
  - Each page has: `label, href, aliases[], icon, description, searchable?, searchType?, children?`
  - Tab drills into children, space after page name searches entities
  - Example: `@warehouse drum` → searches projects containing "drum" and links to warehouse view
- **/ mode**: Slash commands via `SLASH_COMMANDS` (`src/lib/slash-commands.ts`)
  - Context-aware actions filtered by current pathname and user permissions
  - Page-specific commands shown first, then global commands
  - Commands execute actions: navigate, scroll to section, open dialog, generate PDF, or dispatch events
  - Commands define `pages` (route patterns) and optional `requiredPermission` ([resource, action])
  - Page components listen for `slash-command` CustomEvents for `open_dialog` and `trigger` action types
- **Date shortcuts**: Typing DD/MM/YYYY navigates to availability calendar
- **Open shortcuts**: `⌘K`/`Ctrl+K` toggles the palette. Bare `/` opens it pre-filled with `/` (slash-command mode) — but only when focus is **not** in an `<input>`/`<textarea>`/contentEditable, and the page does **not** render a `[data-search-input]` element (pages with their own search box opt out by tagging it, so `/` types into that box instead).
- **Keyboard**: `Shift+↑/↓` skip children, `Tab` drill, `Esc` back, `Cmd+L` toggle children
- **Mobile**: Full-screen dialog with safe area padding, `/` and `@` quick-access buttons; mobile trigger button is a 44px touch target

## Slash Command Registry (`src/lib/slash-commands.ts`)
- `SlashCommand` interface: `id, label, command, aliases[], description, icon, pages[], action, requiredPermission?`
- `SlashCommandAction` types: `navigate`, `navigate_section`, `open_dialog`, `generate_document`, `trigger`
- Route matching: `[id]` for dynamic segments, `*` for global, `/path/*` for wildcard suffix
- `extractEntityId(pathname)` — pulls entity ID from URL for `:id` substitution in actions
- `matchSlashCommands(query, pathname, permissions)` — filters and scores commands
- `logout` trigger is handled directly in command-search via `signOut()`, not dispatched as event

### Document generation
- `generate_document` action opens `/api/documents/{entityId}?type={docType}` in a new tab
- Valid `docType` values: `quote`, `invoice`, `pull-slip`, `delivery-docket`, `return-sheet`
- Available on both project detail (`/projects/[id]`) and warehouse (`/warehouse/[projectId]`) pages

### Tab switching vs section scrolling
- Pages using `<Tabs>` (projects, assets, models, clients) use `trigger` with `event: "switch-tab:{tabValue}"`
- Pages with scrollable sections (kits) use `navigate_section` with `hash` matching an element `id`
- Page components must add event listeners for `slash-command` CustomEvents to handle `switch-tab:*` and other triggers

### Adding a new slash command
1. Add entry to `SLASH_COMMANDS` array in `src/lib/slash-commands.ts`
2. Set `pages` to the route patterns where the command is available
3. Set `action` to what happens on execution
4. Set `requiredPermission` if the action needs permission gating
5. Add the icon name to `pageIcons` map in `command-search.tsx` if it's a new icon
6. For `open_dialog`/`trigger` actions, add a `slash-command` event listener in the target page component
7. For `navigate_section`, ensure the target element has a matching `id` attribute
8. Add new path segments to `knownSegments` in `extractEntityId()` if they could be mistaken for IDs (> 5 chars)

## Adding New Entities to Search
1. Add search case to the `search` query in `convex/globalSearch.ts`
2. Add page to `PAGE_COMMANDS` in `src/lib/page-commands.ts` with `searchable: true` and `searchType`
3. Add `searchType: ["type"]` to BOTH `typeMap` objects in command-search.tsx
4. Add icon to `pageIcons` map in command-search.tsx
5. Add to `typeIcons` and `typeLabels` records
