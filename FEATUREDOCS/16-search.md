# Search & Command Palette

> _Owner: Jayden Nawotka · Last reviewed: 2026-11-23 (review quarterly — POLICY.md R-5.5)_

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

**Role filter (UX Phase 11, Q4 — a security fix).** Every result type maps to its
RBAC resource in ONE table, `convex/lib/searchResultResource.ts`
(`SEARCH_RESULT_RESOURCE`: categories read under `model`, group templates under
`project`, the rest under their own). `readableSearchTypes` asks the EXISTING role
check once per resource through `callerMayRead` (`convex/lib/auth.ts`, the
non-throwing form of `requireOrgPermission(…, "read")`, Q3) and `filterReadable`
drops every type the role can't read on the SERVER — a dropped parent takes its
children with it. Before this, any token for the org searched all 14 types, member
row or not; a caller with no member row now gets nothing.

**`groups`** (additive): `{ type, total, truncated }[]` — per readable type, the rows
that matched BEFORE the per-type LIMIT (`truncated` = that type's org scan hit
`SCAN_CAP`). The palette's `Show all n in X ›` reads it.

**Recent rows** resolve through `paletteRecents.resolve` (`convex/paletteRecents.ts`,
Q7): at most five `{ type, id }` refs (`convex/lib/paletteRecentRefs.ts`, shared with
the browser), each read by `by_cuid` and dropped unless `organizationId` is the
requested org, then dropped again if the role can't read its type (the same resource
table). Titles and hrefs match search's. Like `search`, it is browser-only
(`agentAccess: "denied"`, the same per-result-type scope gap).

## Command Palette (UX Phase 11, §6d.3)
`src/components/layout/command-search.tsx` is the shell: the two triggers, the
hotkeys, the dialog (a full-screen sheet on a phone) and the shell `ShellScan` the
palette's `Scan a tag` opens (the camera mounts only while open; never a second
decoder). Everything inside lives in `src/components/layout/palette/`:
`palette-body.tsx` (render), `use-palette-state.ts` (one hook per mode:
`use-search-mode`, `use-at-mode`, `use-slash-mode`, `use-date-mode`),
`use-palette-keys.ts`, `use-palette-actions.ts`, `palette-results.tsx`,
`palette-chrome.tsx`. What shows, in what order, is the pure
`src/lib/palette/model.ts` (tested without a DOM).

- **Per open, per org.** The body mounts on open and is keyed by the active org, so
  closing it or switching org drops the query, results, any drill and the
  selection. Recent is a different storage key per org, so it is never shown in
  another org.
- **Empty**: **Recent** (5), then **`On #2341 …`** on a job / asset / model / kit page
  (that page's own slash commands; the label is the trail's record crumb), then
  **Actions**: New job, Scan a tag, New asset, New client. Gated: an action is
  present only when its slash command passes `matchSlashCommands`' permission check,
  Scan only with warehouse access. With nothing to show it says "Type to search…".
- **Recent** (`src/lib/palette/recents.ts`, `usePaletteRecents`): ids only, in
  localStorage under `gf:palette-recents:v1:<orgId>:<userId>`, Zod-parsed on read,
  every storage access in try/catch. Opening a record row (from results, Recent, a
  date, `@`) moves it to the top; at most five.
- **Typing** (2+ characters): results grouped Jobs / Assets / Models / Clients / Crew
  / Suppliers / Locations / …, best group first (where its best row ranked), four
  rows each, then `Show all n in X ›` (`n` from `groups`, `n+` when truncated). Jobs
  and Assets open their list on `?q=`; a group with no list expands in place. A
  group whose matches are all children of another group's row (assets under their
  model) still gets its `Show all` when it has a list. Rows: mono number, name,
  muted sub, a job's dot-word status. Children (assets under a model, jobs under a
  client) sit indented under their parent.
- **Dates**: `14/11`, `14 nov`, `nov 14`, `14/11/26`, ISO (`src/lib/palette/date-query.ts`,
  the year from a stable `now`): **Jobs on 14 Nov · n** — the first four through the
  EXISTING Jobs list query (`projects.listPage` with the day as `dateFrom`/`dateTo`),
  gated on `project` — then any gear matching words after the date (opening on that
  date), then `Schedule at 14 Nov ›` (`/availability?date=`). Also after `@`.
- **Nothing matches “…”** with the next step: "Try a job number, an asset tag or a
  client name · @ pages · / actions".
- **@ mode** (kept): Page navigation via `PAGE_COMMANDS` (`src/lib/page-commands.ts`)
  - Each page has: `label, href, aliases[], icon, description, searchable?, searchType?, children?`
  - Tab drills into children, space after page name searches entities
  - Example: `@warehouse drum` → searches projects containing "drum" and links to warehouse view
- **/ mode**: Slash commands via `SLASH_COMMANDS` (`src/lib/slash-commands.ts`)
  - Context-aware actions filtered by current pathname and user permissions
  - Page-specific commands shown first, then global commands
  - Commands execute actions: navigate, scroll to section, open dialog, generate PDF, or dispatch events
  - Commands define `pages` (route patterns) and optional `requiredPermission` ([resource, action])
  - Page components listen for `slash-command` CustomEvents for `open_dialog` and `trigger` action types
- **Open shortcuts**: `⌘K`/`Ctrl+K` toggles the palette. Bare `/` opens it pre-filled with `/` (slash-command mode) — but only when focus is **not** in an `<input>`/`<textarea>`/contentEditable, and the page does **not** render a `[data-search-input]` element (pages with their own search box opt out by tagging it, so `/` types into that box instead).
- **Keyboard**: `↑/↓` move, `Enter` opens, `Esc` closes (or leaves a drill), `Shift+↑/↓` skip children, `Tab` drill, `Shift+→/←` show/hide children, `Cmd+L` toggle children. The highlight belongs to what the box says: a new query starts it at the top (or at `@`'s best match).
- **Mobile** (§6d.6): full-screen sheet with safe-area padding, a 16 px input, `Cancel`, the word chips `@ Pages · / Actions · Scan a tag`, 58 px rows; a row with children drills in on tap. The trigger is a 44 px touch target.
- **Not built**: the `N` key hint on New job (§6d.3) — `N` is a list-page shortcut, and in the palette typing `n` searches.

## Slash Command Registry (`src/lib/slash-commands.ts`)
- `SlashCommand` interface: `id, label, command, aliases[], description, icon, pages[], action, requiredPermission?`
- `SlashCommandAction` types: `navigate`, `navigate_section`, `open_dialog`, `generate_document`, `trigger`
- Route matching: `[id]` for dynamic segments, `*` for global, `/path/*` for wildcard suffix
- `extractEntityId(pathname)` — pulls entity ID from URL for `:id` substitution in actions
- `matchSlashCommands(query, pathname, permissions)` — filters and scores commands
- `logout` trigger is handled directly in the palette (`palette/use-slash-mode.ts`) via `signOut()`, not dispatched as event

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
5. Add the icon name to `NAMED_ICONS` in `src/components/layout/palette/palette-icons.tsx` if it's a new icon
6. For `open_dialog`/`trigger` actions, add a `slash-command` event listener in the target page component
7. For `navigate_section`, ensure the target element has a matching `id` attribute
8. Add new path segments to `knownSegments` in `extractEntityId()` if they could be mistaken for IDs (> 5 chars)

## Adding New Entities to Search
1. Add search case to the `search` query in `convex/globalSearch.ts` (through `ranked(type, …)` so `groups` counts it)
2. Map the type to its RBAC resource in `SEARCH_RESULT_RESOURCE` (`convex/lib/searchResultResource.ts`) — a type missing there is never readable
3. Add page to `PAGE_COMMANDS` in `src/lib/page-commands.ts` with `searchable: true` and `searchType`
4. Add `searchType: ["type"]` to `ENTITY_TYPES` in `src/components/layout/palette/use-at-mode.ts`
5. Add the type to a family in `PALETTE_FAMILIES` (`src/lib/palette/model.ts`) and its icon to `TYPE_ICONS` (`palette-icons.tsx`)
6. For Recent, add it to `RECENT_TYPES` (`convex/lib/paletteRecentRefs.ts`) with a loader in `convex/paletteRecents.ts`
