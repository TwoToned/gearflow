# Changelog

All notable changes to GearFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.14.3.0] - 2026-06-05

### Fixed
- **App-wide stability after data backfills.** After the v0.14.2.0 model-accessory
  backfill, the app intermittently froze for everyone for about a minute, then
  recovered on its own (the kit picker would come up empty, moving items stalled,
  prep felt slow). Root cause: the bulk insert left Postgres on stale query-planner
  statistics, so it occasionally chose a pathological plan for hot queries — and with
  no per-query timeout, one slow query held a database connection long enough to
  starve the whole pool. The fix refreshes statistics at deploy time instead of
  waiting hours for autovacuum to catch up.

### Changed
- **Database connections are now bounded so one slow query can't take the app down.**
  The runtime connection sets a `statement_timeout` (default 30s) plus pool-wait
  limits, so a single slow query fails on its own instead of stalling every other
  request. Tunable via `DB_STATEMENT_TIMEOUT_MS`, `DB_POOL_TIMEOUT_S`, and
  `DB_CONNECTION_LIMIT`; migrations are unaffected, so backfills are never cut off.

## [0.14.2.0] - 2026-06-05

### Fixed
- **Model accessories now show when you add gear by model.** Previously an
  accessory set on a *model* ("every IMX6A ships with a Micon adaptor") only
  appeared if you added that gear by scanning a specific asset tag — not when you
  added it by model + quantity, which is how most quotes are built. So the
  adaptor was missing from the project and every document. Now adding a line by
  model expands the model's accessories immediately (quantity scaled — "2x IMX6A"
  gets 2 adaptors), so they show on the project, the quote, and the docket.

### Changed
- **Existing jobs backfilled.** A one-time backfill adds model accessories onto
  your existing model lines on active (quote/confirmed, not-yet-prepped) projects,
  so current jobs get their accessories too — not just new ones. Finalized
  (invoiced/completed) and already-deployed lines are left untouched.

### Fixed
- **Accessories on multi-asset bookings now return with the right unit.**
  Previously, on a line booked with several of the same asset (each carrying its
  own attached accessory), returning one asset also marked its siblings'
  still-deployed accessories as returned — and a "damaged" return could send a
  sibling's cable to maintenance. Returns now follow the specific asset scanned.
- **Attached accessory quantities now scale with the booking.** Ten lights that
  each ship with a clamp now reserve ten clamps, not one — so pull sheets,
  availability, and the deploy/return screens show the real count. Returning one
  asset brings back its share; the accessory clears once every asset is back.
- **Re-scanning an already-returned asset no longer double-returns** its shared
  accessories, and two warehouse stations checking out the same booking at once
  no longer under-count its accessories.
- Attached accessories now also show on the deploy/return screens for
  multi-asset model lines, and hide correctly when the group is collapsed.

## [0.14.0.0] - 2026-06-05

### Added
- **Accessories now travel with their asset everywhere.** Permanently-attached
  accessories (cables, clamps, adaptors on a serialised asset) are wired
  end-to-end. Add the asset to a job and its accessories come with it as
  indented child lines. They show on the pick list and printable pull sheet —
  badged "Accessory", counted in pick progress — so warehouse staff actually
  pick them instead of leaving them on the shelf. They appear nested under the
  parent in the deploy and return tabs, and expand under the parent in the
  project equipment table.

### Fixed
- **Check-and-store returns now release the accessories too.** Returning an
  asset through the check-and-store workflow previously freed the parent but
  left its cables and clamps stuck "Checked Out"; the return now cascades to the
  attached accessories, and de-prep clears them from the deploy-staging board.

### Known limitations
- Multi-quantity / model-level lines that carry per-unit accessories are not yet
  fully handled — returning one unit can release accessories belonging to
  sibling units that are still out. Single-asset bookings (the common case) are
  correct. A follow-up tracks the multi-quantity fix.

## [0.13.0.1] - 2026-06-05

### Fixed
- **Discord bot login failed with "Used disallowed intents".** The client was
  requesting the privileged `GuildMembers` intent, which Discord rejects unless
  the "Server Members Intent" toggle is enabled in the Developer Portal. Dropped
  the intent — the only consumer was a single-ID `guild.members.fetch(id)` call,
  which falls back to a REST request and works without the intent. No Developer
  Portal change required; just restart and the bot connects clean.

## [0.13.0.0] - 2026-06-04

### Added
- **Model-level accessories.** Set a default accessory on a Model — "every
  asset of this model ships with N of this bulk asset" — and every asset of
  that model inherits it automatically. The new `ModelBulkAccessory` join
  table is unique on `(modelId, bulkAssetId)`, so duplicates are blocked at
  the DB layer. Bulk only at the model level (you can't pick "the" specific
  cable for every asset of a model); always SHIPS_WITH (DEDICATED at the
  model level would drain the whole shelf in one click). UI: "Accessories"
  section on the Model detail page; asset detail page shows inherited bulk
  rows tagged "from model".

### Changed
- Project expansion (`expandAccessoryChildren`) and warehouse scan-time
  expansion (`expandAccessoriesForAsset`) now union the asset's own bulk
  children with the asset's model's `bulkAccessories`, deduped by
  `bulkAssetId` so an asset-level row wins on conflict (different quantity,
  DEDICATED override). Idempotent — re-scans don't duplicate.
- `getModel` and `getAsset` include `model.bulkAccessories` so the UI can
  render the inherited rows and the asset's "(from model)" tag.
- Removing a model accessory after a project already expanded it does NOT
  retroactively delete the project line items — the template only governs
  *new* expansions.

## [0.12.0.0] - 2026-06-04

GearFlow now bridges Discord. Every project gets its own private channel,
crew can link their Discord accounts via email, and they can look up assets
and log faults from their phone without opening the app. The bot runs
in-process — there's nothing to deploy separately, no `.env` to manage. Admins
configure everything at **Settings → Discord**.

### Added
- **Discord integration.** Per-org config row, transactional outbox for events,
  per-project private channels created automatically when a project hits a
  configurable status (default: `CONFIRMED`) and archived to a separate
  category when it hits a terminal status (default: `COMPLETED, INVOICED,
  RETURNED, CANCELLED`). Crew get channel access as soon as they're assigned;
  late-linking crew get retroactive access on confirm.
- **`/link [email]` enrollment.** Crew run `/link` in Discord, get a magic
  link emailed to their GearFlow profile, and click to confirm. Anti-hijack
  hardened (the token binds the invoker's Discord ID at issue time), constant
  "if that email is on file" response (no enumeration oracle), durably
  rate-limited (3/hr per Discord user, 3/day per crew member).
- **`/asset code:TTP-042`.** Linked crew look up any asset by tag from
  Discord: current status, test-and-tag validity, and which project it's
  deployed on.
- **`/fault code:… description:… severity:MINOR|MAJOR hold:true`.** Crew log
  a DamageEvent from Discord. `hold` flips the asset to `IN_MAINTENANCE` (needs
  `maintenance:create`). Idempotent on the Discord interaction id — a retry
  never double-logs.
- **Admin Discord settings page** (`/settings/discord`). Discord bot token
  (encrypted at rest via AES-256-GCM keyed off `BETTER_AUTH_SECRET`),
  application id, guild id, project + archive categories, channel lifecycle
  rules (multi-select status arrays), welcome-on-create + fault-echo behaviour
  toggles, signing-secret rotation, linked-accounts roster (linked + pending
  in one table), recent activity.
- **One-click bring-up.** A **Deploy commands & start bot** button on the admin
  page pushes the slash command registry to Discord AND restarts the
  in-process bot so it picks up the latest credentials and config — no
  `pm2 restart gearflow` needed. Every config-changing save (toggle Enabled,
  save token, save settings) auto-restarts the bot for the same reason. A
  live "Bot running" / "Bot stopped" pill on the connection-health card
  surfaces gateway state. `startBot()` awaits the Discord `ClientReady`
  handshake (10s timeout) so the post-restart status read is accurate.

### Changed
- **Bot architecture: in-process, no separate service.** The bot lives inside
  the GearFlow Next.js server (booted by `instrumentation.ts`). Slash commands
  call services directly; the outbox poller reads the DB directly. Same
  service-layer invariants (`requireActorPermission`, transactional outbox,
  idempotent converge) as a separate service would have — but with one process,
  one call path, and no HMAC trust boundary to enforce. **Zero env vars** on
  the host for Discord.
- **`DamageEvent` records the true reporter.** New nullable
  `reportedByCrewMemberId` preserves who filed the fault when a non-User
  freelancer reports it from Discord, while `createdById` keeps a real User to
  satisfy the existing FK (`20260604130000_discord_fault_reporter` migration).
  A new unique `discordIdempotencyKey` makes retried fault POSTs safe.
- **Project + crew-assignment writes emit transactional Discord events.**
  `createProject`, `createAssignment`, `deleteAssignment`, `updateProject`, and
  `updateProjectStatus` wrap their Prisma calls in a `$transaction` and append
  a `DiscordOutbox` row inside it — a rolled-back mutation never leaks a
  channel-sync event. Orgs without an enabled integration emit nothing.

## [0.11.0.0] - 2026-06-04

### Added
- **Child Assets / Accessories.** Permanently attach accessories (cables,
  clamps, adaptors) to a parent serialised asset. They travel with the parent
  onto projects and through warehouse checkout/checkin, and render indented on
  pull sheets, delivery dockets, quotes, and invoices. New data model:
  `Asset.parentAssetId` self-relation, `AssetBulkChild` join table,
  `ProjectLineItem.childKind` (`KIT | ACCESSORY`). The structural `isKitChild`
  flag is reused so the ~40 existing totals/count filters exclude accessories
  with no migration.
- **Scan-time accessory travel.** When the warehouse assigns a specific asset
  to a model-level line at prep or deploy, that asset's accessories
  materialise as child lines automatically (idempotent — dedups by asset/bulk
  id, so re-scans don't duplicate). Accessories travel whether the office
  books a specific asset or the warehouse picks the unit later.
- **Accessory manager UI** on the asset detail page (connector-glyph list,
  Attach dialog) with a plain-language allocation explanation. An "Accessory
  of <parent>" badge appears on children's detail pages.
- **Scanner "scan the parent" prompts** in all three warehouse tabs (prep /
  deploy / return) when an accessory is scanned directly.

### Changed
- `removeLineItem` is now transactional and cascade-aware: accessory parents
  cascade-delete their children atomically; direct removal of a child line is
  blocked with a `childKind`-aware error message.
- `deleteAsset` refuses to delete a parent that still has accessories
  attached.
- PDF pipeline: an "accessory parent" (top-level line, no `kitId`, has
  `ACCESSORY` children) is recognised by both `gearflow-table` rendering and
  `section-renderer` height reservation, so accessories render indented and
  pagination doesn't tail-drop them.
- VERSION file reconciled with package.json after the 0.10.0.0 drift.

### Fixed
- Concurrent `addSerializedChildToAsset` calls attaching the same child to
  different parents now use a guarded update — the second attach throws
  instead of silently overwriting the first.
- `lookupAssetForScan` org-scopes the parent lookup (tenant isolation).
- A serialised accessory cannot be detached while it's deployed on a project
  (avoids a dangling project child line and a mis-stated shelf count).
- `addSerializedItemToKit` (single + batch) rejects an asset that's already an
  accessory of another asset — symmetric to the existing kit-to-accessory
  guard.
## [0.9.3.0] - 2026-06-04

The line-item Move action splits into two clearer choices.

### Changed
- **Line-item kebab "Move" → two actions: "Move to category" and
  "Move to group".** The combined picker that v0.9.1.0–0.9.2.1
  evolved (Uncategorized + per-category root + per-category-group
  entries in one dropdown) confused users every time — picking
  "Audio" looked equivalent to "Audio > PA System" but landed the
  item in a different place. Each row's kebab now offers an explicit
  category-only and group-only path:
    • *Move to category* — lists every category plus
      Uncategorized. The item lands as a standalone under the picked
      category (or in the truly uncategorised zone).
    • *Move to group* — lists every group, clustered by its
      category. The item lands inside the picked group and adopts
      its category.
  The `m` row shortcut binds to *Move to category* (the broader
  pick); *Move to group* needs the explicit kebab.
- Group-only dialog renders an explanatory empty state with a
  Close button when the project has zero groups, instead of an
  empty dropdown over a disabled Move button.

### Removed
- `move-line-item-dialog.tsx` — the combined picker. Replaced
  by `move-item-to-category-dialog.tsx` + `move-item-to-group-dialog.tsx`.

## [0.9.2.1] - 2026-06-04

### Fixed
- **Move-item dialog: pick a category as the destination.** The
  destination dropdown only listed `<category> > <group>` entries
  plus a single top-level "Uncategorized" option. Users wanting to
  drop an item under a category — but not into one of its groups —
  had no UI affordance, so they picked the only top-level option
  (Uncategorized), the server obediently moved the item to truly
  uncategorised, and it "disappeared" from where they expected.
  Each category now contributes a `<name> (no group)` entry
  alongside its child groups so category-root is a real destination.
  Server side unchanged — `moveLineItemToGroup` already accepted
  `{ categoryId, groupId: null }`.

## [0.9.2.0] - 2026-06-04

Project groups can now move between categories, and categories themselves
gain inline add actions for equipment, kits, and custom items. Fixes two
bugs reported against v0.9.1.0: structure-creation was stuck (a project
group was glued to whichever category it was born in), and there was no
inline path to drop a kit straight into a category without first making
a group inside it.

### Added
- **Move project groups across categories.** Group kebab gains a
  "Move to category" action with the same `ArrowRightLeft` icon as the
  line-item Move. Picks any category in the project, or types a new
  category name and presses Enter to create-and-place in one atomic
  step (matches the sub-hire group move S15 pattern). The `m` row
  shortcut binds to it.
- **Add actions on category rows.** Category kebab gains
  "Add Equipment", "Add Kit", and "Add Custom Item" entries — each
  opens the unified add dialog scoped to that category with no group
  pre-set, so the new item lands under the category as a
  standalone item. Sub-hire is intentionally omitted because sub-hire
  orders don't carry a categoryId at the order level (their groups do
  — use the toolbar Add).

### Changed
- Sub-hire group Move kebab icon switched from `Package` to
  `ArrowRightLeft` so the three rows (LineItem, SubHireGroup,
  ProjectGroup) all render Move with the same affordance.
- MoveLineItemDialog description now says "Choose a destination
  group or category" since Uncategorized is a valid pick.

### Fixed
- **Category sync on group placement.** `createCategoryAndPlaceGroup`
  was leaving line-item categoryIds stale when the new category was
  created via the project-group branch — the sub-hire branch had
  always synced its synthetic parents but the project-group branch
  skipped its own line items. PDFs and reports that filter by
  category would have shown items under their OLD category for any
  group moved through the create-by-name path. Both branches now
  call the same `projectLineItem.updateMany` so the placement is
  always consistent.

## [0.9.1.0] - 2026-06-04

Unified the project equipment "Add" surface. The four separate toolbar
buttons (Add Equipment / Add Kit / Custom Item / Sub-Hire) collapse into
one dialog that picks kind via a tab strip, and sub-hire creation now
lives inline alongside equipment, kits, and custom items instead of
bouncing to a separate window. The "New" button in the Sub-Hire Orders
panel is gone for the same reason. Add Group and Add Category now sit
next to each other in the toolbar so the structure-creation cluster
reads as one group instead of being split across a spacer.

### Added
- `SubHireAddForm` — inline form mirroring `EquipmentAddForm` /
  `KitAddForm` / `CustomItemAddForm`. Captures supplier, supplier
  reference, hire start/end, and notes. After `createSubHire` succeeds,
  the unified dialog closes and `SubHireOrderDialog` opens on the new
  order in manage view so the user can immediately add items.
- `UnifiedAddDialog` now renders one of four kinds inline: `own-stock`,
  `kit`, `custom`, or `sub-hire`. The `onOpenSubHire` bounce prop is
  removed.

### Changed
- Equipment toolbar reduced to three buttons: `Add` (unified, opens the
  add dialog at the last selected kind), `Add Group`, `Add Category`.
  The four-button add cluster is gone.
- Group-kebab `Add Equipment` and `Add Kit` actions still pre-set the
  unified dialog's kind so the per-group context is preserved.
- `Add Category` moved next to `Add Group` (was on the right of the
  spacer next to Show margin) so structure-creation buttons cluster.

### Removed
- Standalone "Sub-Hire" toolbar button — duplicate of the unified Add
  dialog's Sub-hire tab.
- "New" button at the top of the Sub-Hire Orders panel — same duplicate.
- The `onOpenSubHire` callback prop on `UnifiedAddDialog` and the
  bounce-to-other-dialog behaviour it implemented.

## [0.9.0.0] - 2026-06-04

Cross-type group/category unification for the project equipment tab.
Own-stock items, sub-hires, and custom items now live in the same
ordered list per category, share the same dialogs, and respond to
the same kebab actions and keyboard shortcuts.

### Added

- **Unified "Add" surface.** One dialog with a segmented switcher
  (Own stock / Kit / Sub-hire / Custom). Picking Own-stock, Kit, or
  Custom reshapes the body inline; Sub-hire bounces to the existing
  sub-hire order workflow. Four toolbar buttons and the two group
  kebab actions all open the same dialog with the right tab pre-set.
- **Sub-hire groups in the main table.** Sub-hire groups now render
  as first-class rows interleaved with project groups in each
  category, complete with handshake icon, "via Supplier" sub-line,
  and a "$N margin" tail. Orphan sub-hire groups (no
  `targetCategoryId`) surface in the Uncategorized zone instead of
  vanishing.
- **Cross-type drag-and-drop.** Reorder mixed lists within a
  category; drag a sub-hire group across categories or to the
  Uncategorized zone. Drop Matrix 8C rejects disallowed combinations
  (own-stock items onto sub-hire groups, group-into-group nesting)
  with a 2px red left-edge bar plus an explanatory toast.
- **Move dialog for sub-hire groups.** Kebab "Move to category"
  opens a category picker. Typing a new category name and pressing
  Enter creates the category at the end of the project's list AND
  places the sub-hire group inside it in a single atomic transaction.
- **Unified price-edit dialog.** One dialog covers both group kinds:
  project groups get a single Price input, sub-hire groups get
  Charge + Cost inputs with an auto-computed Margin per unit.
- **Show-margin column toggle.** "Show margin" toolbar button
  reveals an optional Cost column showing supplier cost on sub-hire
  rows. Preference persists per-user in localStorage; default OFF.
- **Per-row keyboard shortcuts.** Hovering a row and pressing `e`,
  `m`, or `d` triggers Edit / Move / Delete. Suppressed when focus
  is in an input, contentEditable element, or open dialog/menu.

### Changed

- Equipment-tab.tsx slimmed from 2148 LOC to 1393 LOC (-35%) by
  extracting 10 dialog and helper components into dedicated files.
  Same behavior — easier to navigate, easier to test.
- `getProjectCategories` now returns a `mixedGroups` array per
  category that interleaves project and sub-hire groups in
  CategorySlot order. Existing consumers (sub-hire order dialog,
  equipment add form) read only the unchanged `groups` field.

### Fixed

- **Concurrent reorder race.** Two simultaneous reorders of the same
  category previously hit `UNIQUE(projectCategoryId, sortOrder)`.
  `reorderMixedGroupsInCategory` now acquires a Postgres advisory
  lock keyed on the category id and runs a phase-1 negation pass
  before the upsert loop. Both reorders complete; last write wins on
  sortOrder.
- **Sub-hire group placement query.** Sub-hire group availability
  now threads `rentalStartDate`/`rentalEndDate` through to
  `checkKitAvailability` instead of always passing `new Date()`.

### Removed

- Standalone `AddEquipmentDialog` wrapper file — superseded by the
  unified add dialog.
- Inline `Set group price` dialog in equipment-tab — superseded by
  the unified `PriceEditDialog`.

## [0.8.2.0] - 2026-06-03

Quick-wins bundle: three TODOs knocked out plus follow-up polish from
an adversarial review pass.

### Added
- **Configurable days-per-month for billing.** The pricing optimiser
  treated a "month" as exactly 28 days. Orgs whose customers use 30 or
  calendar-month conventions can now set it in Settings → Project
  Defaults. Values are clamped to 20-31 in the form, and the server
  defensively re-validates on read so corrupt metadata can never
  produce a degenerate optimiser run.
- **Template builder settings for `call-sheet-info` and `day-header`.**
  The two section types rendered with hard-coded defaults; now the
  toggles (PM contact, client contact, venue details, schedule times,
  equipment summary, phases, crew count) are editable in the builder
  UI. Day-header toggles flow through to every per-day section the
  call-sheet pipeline injects.

### Changed
- The crew availability overlap query now backs onto a composite
  `(crewMemberId, startDate, endDate)` index so look-ups stay
  index-only once the assignment table grows past the point where the
  existing `(crewMemberId, startDate)` index forces a row scan to
  evaluate `endDate`.

### Fixed
- Pre-existing call-sheet-info sections persisted with empty settings
  (a legacy bug where the dispatcher returned `{}`) used to render a
  blank section because every toggle read as `undefined`. The renderer
  now merges defaults at read time so old data still renders the
  expected fields.

## [0.8.1.2] - 2026-06-03

Second hotfix in the v0.8.1.x series — delivery dockets and return
sheets were silently dropping every Project Group from the doc. The
status filter (CHECKED_OUT for dockets; CHECKED_OUT + RETURNED for
return sheets) compared against the synthetic group row's status field,
which is hard-coded to CONFIRMED because the row is a label, not a
real line item. Result: the parent failed the filter, took its
attached members with it, and the entire group vanished from the doc
the warehouse hands to the client.

### Fixed
- **Status filter now passes synthetic Project Group rows through if
  ANY attached child meets the filter criteria.** The kit-style
  children-loop inside the parent's row still filters each member
  individually, so only checked-out (or returned, for return sheets)
  members indent under the group. Groups with zero passing members
  drop entirely — no empty group headers stranded on the doc.
- Mirrors the same isGroupRow special case in both the plugin filter
  (`gearflow-table.ts`) and the section-renderer's
  `getFilteredParentItems` (used for height calc + pagination).
- Bulk children of a group respect `checkedOutQuantity > 0` instead of
  the parent's status, matching how top-level bulk items are filtered.

### Added
- 5 regression tests across `section-renderer.test.ts` (group filter
  with bulk children, any-child-passes for both docket and return
  sheet) and `gearflow-table.test.ts` (docket renders group parent
  with only checked-out children indented; group with zero checked-out
  children drops entirely).

## [0.8.1.1] - 2026-06-03

Hotfix for v0.8.1.0: warehouse PDFs were silently dropping tail items
when groups carried members as `childLineItems`. The section-renderer
height calculator only counted attached children for kit parents — not
group parents — so the table under-estimated its space, the plugin
ran out of vertical room, and everything past the first page (or past
the first oversized group) just vanished from the doc instead of
paginating onto a second page.

### Fixed
- **Section-renderer pagination now accounts for `childLineItems` on
  Project Group rows.** `calculateItemHeight` treats `isGroupRow` +
  attached `childLineItems` the same as `isKit` + `showKitChildren`:
  the parent row's reserved height includes every indented member.
  Without this, an entire warehouse doc could lose its tail content
  on the first deploy of v0.8.1.0 — the "Drum Kit Mic Set" group
  rendered fine, then everything after it (other groups, ungrouped
  items, kit breakouts) was silently dropped.

### Added
- 2 height-calc regression tests in `section-renderer.test.ts`:
  group row with N children reserves strictly more space than a plain
  row (by at least N child rows worth), and a group row with EMPTY
  `childLineItems` uses plain-row height (collapse-mode parity).

## [0.8.1.0] - 2026-06-03

Project Groups on warehouse PDFs now look like kits — bold parent rows
with their members indented underneath — and sit inside their category
section. The previous version turned every group into its own
top-level teal section header, which doubled-up against the group's
own row and lost the category context warehouse staff use to walk the
warehouse.

### Fixed
- **Project Groups on pick lists, return sheets, and delivery dockets
  now render inside their category.** "Drum Kit Mic Set" shows up as a
  bold sub-header inside the "Band" category section, with its mics
  indented underneath, instead of breaking out as its own top-level
  section. The data builder now buckets group rows under `cat.name`
  and attaches non-kit members as `childLineItems` on the synthetic
  group row; the renderer treats group rows with attached members the
  same as kit parents (bold name, indented children).
- Removed the duplicate "group title" rows that appeared both as a
  section header AND as the first row inside the section.

### Changed
- Kit parents that live inside a Project Group still break out into
  their own `[Kit] <name>` section — the kit-boundary contract is
  preserved end-to-end.
- `gearflow-table.ts` adds an `isGroupParent` detection so the
  existing kit-children rendering path (indent, smaller font, per-unit
  checkboxes for multi-quantity members) extends to group members
  with zero new rendering code.

### Added
- **PDF renderer test harness** (`src/lib/pdfme/plugins/test-utils.ts`).
  Wraps a real `@pdfme/pdf-lib` page with capturing proxies on
  `drawText`, `drawRectangle`, and `drawLine` so plugin tests can
  assert font choice (bold vs regular), text content, and indent
  positions without producing a PDF on disk. Closes the long-standing
  "no unit tests for PDF rendering" gap.
- 7 harness-based tests in `gearflow-table.test.ts` covering: group
  parent renders bold, regular rows stay regular (control), children
  indent right of parent and stack below, child order preserved, group
  row without children stays regular (collapse-mode parity), kit
  parents still bold (regression), category section header sits above
  group contents.

## [0.8.0.0] - 2026-06-02

Warehouse-facing PDFs now show every item inside a Project Group, plus
sub-hire and kit gear get their own clearly-labelled sections. Pick
lists, return sheets, and delivery dockets render in packer-walk order
so warehouse staff walk the warehouse rack-by-rack instead of
ping-ponging across the building.

### Fixed
- **Pick list, return sheet, and delivery docket now show every line
  item inside a Project Group.** Previously, any project with Project
  Groups rendered as just the group title rows on warehouse docs —
  staff couldn't see the 50 lamps to actually pick. The data builder
  was collapsing groups into one synthetic row for every doc type;
  now it's controlled by a per-template `expandProjectGroups`
  setting, defaulting to expand for warehouse docs and collapse for
  quote / invoice.

### Added
- **Sub-Hire Groups render as their own top-level section** on
  warehouse docs (`Sub-Hire: <Supplier> — <Group Title>`). Packers
  see what's hired-in vs owned at a glance; clients see the same
  separation on the delivery docket they sign.
- **Kit boundary wins over Project Group placement.** A kit that
  sits inside a Project Group now breaks out into its own `[Kit]
  <name>` section on warehouse docs. Kit contents stay grouped as a
  unit instead of getting lost in the surrounding gear.
- **Packer-walk sort order** within each section: location →
  category → model name. Bulk items and custom items without a
  location bucket to the bottom of each section.
- **Delivery docket expands groups with serials** so the signed
  handover doc has full evidence of what physically left the
  building.

### Changed
- New `TemplateSettings.table.expandProjectGroups` boolean. Defaults
  true for packing-list, return-sheet, delivery-docket; false for
  quote, invoice, call-sheet.
- `resolveTemplateSettings(docType, stored)` deep-merges legacy
  stored template JSON against the docType defaults so new settings
  keys pick up safe values automatically. Without this, every
  existing template would silently regress to today's
  collapsed-row bug on first deploy.
- `gearflow-table.ts` delivery-docket grouping respects `groupName`
  for non-kit items so Project Groups and Sub-Hire Groups get their
  own section headers. Kit promotion (kit name as header,
  CHECKED_OUT children as rows) preserved.
- Pagination orphan check: group headers now reserve space for the
  header AND at least one body row before drawing, so headers never
  strand at a page bottom with items continuing onto the next.
- Both render pipelines (legacy template + section-based) get the
  fix simultaneously because both consume `data.line_items` from
  the same builder.

## [0.7.1.0] - 2026-06-02

iCal feed now shows the right time when subscribed in Google Calendar.
Previously, every event was shifted by the org's UTC offset (about 10–11
hours for Australia/Sydney) and often landed on the wrong day.

### Fixed
- **iCal feed times were off by the org's UTC offset on Google Calendar.**
  The generator used the server's local time and emitted "floating"
  DATE-TIMEs with no timezone anchor. On Vercel (UTC) a 9am Sydney event
  came out as `DTSTART:...T230000` floating, so Google rendered it at
  11pm in the viewer's local zone. The feed now anchors every DTSTART /
  DTEND with `TZID=<org-timezone>` and ships a matching `VTIMEZONE` block
  for AU (Sydney, Melbourne, Hobart, Adelaide, Brisbane, Perth, Darwin),
  NZ (Auckland), UK (London), US (LA / NY), and UTC. DST is handled by
  embedded `RRULE`s so events render correctly across the daylight-saving
  transition. `DTSTAMP` is now UTC with the mandatory `Z` suffix per RFC
  5545. The org timezone comes from `OrgSettings.timezone` (default
  Australia/Sydney) on the projects, services, maintenance, crew, per-
  crew-member, and per-assignment feeds. All-day events use explicit
  `VALUE=DATE` instead of relying on midnight detection. Backed by 16
  regression tests covering winter (AEST), summer (AEDT), Brisbane
  no-DST, unknown-zone fallback, all-day rendering, and the original
  floating-time bug shape.

## [0.7.0.4] - 2026-05-30

Patch release — delivery dockets now list every assigned asset tag, one
row per unit, instead of collapsing to "tag, tag +N".

### Fixed
- **Delivery docket collapsed multi-quantity lines.** A line with qty > 1
  rendered "TTP00042, TTP00045 +3" instead of one row per assigned unit,
  so the client had no per-unit list to tick off on receipt. The section
  render path (`generate-pdf` `loadTemplate` reads `sections` first) is
  the active path, but `getDefaultSections("delivery-docket")` was the one
  place `showPerUnitCheckboxes` was missed — the legacy
  `getDefaultSettings()` blob already had it `true`, so the two default
  sources disagreed and the section one won at render. Set it `true` on
  the section default to match packing-list/return-sheet.
- **`migrate:docket-per-unit` was a no-op for section-based templates.**
  The original script only flipped the legacy `settings.table` blob, but
  render reads `sections` first — so org templates customised through the
  modern editor kept the old single-row layout. The migration now flips
  both `sections[type=table].settings` and the legacy `settings.table`,
  with `--org` scoping. Idempotent, dry-run by default, `--apply` to write.

## [0.7.0.3] - 2026-05-30

Patch release — makes the v0.7.0.2 explicit-merge handoff actually
usable against production data.

### Fixed
- **`collapse:historic-splits` hid the ids you need.** A project-scoped
  dry-run truncated every line-item id to 10 chars and only collected
  singletons under `--diagnose`, so an operator saw neither the
  free-text priced parent (a singleton — its `modelId` is null or
  differs from the scan-created children) nor copyable child ids. The
  scoped dry-run now auto-dumps singletons + the unmatched bucket with
  **full ids**, ready to paste into `--merge-into` / `--children`.

## [0.7.0.2] - 2026-05-29

Patch release — finishes the historic-split consolidation tooling and
fixes the residue a merge leaves in the project view.

### Fixed
- **Merge tombstones showed as "Cancelled" ghost rows.** The
  split-collapse migrations keep each folded child line as `CANCELLED`,
  qty 0, `assetId` null so `LineItemMergeMap` history survives. But
  `getProject` didn't filter them, so a fold turned N duplicate
  equipment rows into N cancelled rows instead of removing them.
  `getProject` now filters `status != CANCELLED` on all three line-item
  includes (grouped, ungrouped-category, top-level), and the equipment
  tab re-applies the same predicate (`isHiddenFromList`) as defence
  against a stale cache or optimistic update. Normal line-item removal
  hard-deletes, so a `CANCELLED` line item is only ever inert merge
  residue. PDFs, warehouse, and list views already excluded it.

### Added
- **Explicit merge mode for `collapse:historic-splits`.** Older
  production data has a priced free-text parent (`modelId` null) whose
  physical rows were created later by scanning — parent and children
  share no FK and no `modelId`, only a description string, so no
  heuristic can safely cluster them. The script now takes
  `--merge-into <canonicalId> --children <id1,id2,...>`, validates both
  ends (same project/org, not kit children, have an asset, not already
  cancelled, canonical ∉ children), folds each child's asset onto a new
  unit on the canonical, repoints `CheckRecord` / `DamageEvent` /
  `ProjectService`, and writes the `LineItemMergeMap` audit row. When
  nothing clusters heuristically the script dumps the singletons (id,
  qty, price, status, model/description) so the operator can read off
  the exact ids. modelId-null rows are keyed per-row so a priced parent
  can never be falsely clustered.
- **Migration workflow drives the explicit merge.** `migrate.yml` gains
  optional `canonical_id` + `children_ids` inputs (shell-quoted, applied
  only for `collapse:historic-splits`) so the consolidation runs from
  the GitHub Actions UI — the prod SSH session freezes on long scripts.
  Dry-run by default; `apply` stays a separate human-gated checkbox.

## [0.7.0.1] - 2026-05-27

Patch release on top of the v0.7.0.0 fulfillment-model cutover.

### Fixed
- **T&T preflight missed unit-borne assets.** The checkout T&T
  compliance gate scanned `line.assetId` / `line.bulkAssetId` only.
  After the cutover those columns are null for most deployed lines —
  the assignment lives on the unit row — so a prepped asset with a
  FAILED or OVERDUE T&T record slipped past the gate. Preflight now
  unions three sources: legacy line columns, `ProjectLineItemUnit`
  rows on the same lines, and inbound `item.assetId` scans.
- **Delivery docket / packing list / return sheet showed `-` for
  multi-unit lines.** The PDF builder included `line.asset` but not
  `line.units`, so a `10x` deployed line rendered no asset tags. The
  builder now pulls units (filtered to non-CANCELLED) and the
  `getAssetTag` helper renders up to two tags, then `+N` for extras,
  falling back to legacy fields for single-asset and kit-child rows.

## [0.7.0.0] - 2026-05-27

Line-item fulfillment model — a foundational data-model rework that
fixes the long-standing warehouse checkout / docket duplication bug.

The order line (`ProjectLineItem`) now carries the commercial intent
and never splits: a `10x Powerplay P2` line stays one row with a
`quantity: 10`. Every assigned physical thing — a serialised asset, a
bulk slice — gets its own `ProjectLineItemUnit` row carrying its own
state (assigned / packed / checked-out / damaged / returned). Rollup
counters on the order line are recomputed from units in the same
transaction as every write, so order-line state never drifts from
unit truth.

### Added
- **`ProjectLineItemUnit` table** — one row per physical fulfilment.
  Phase 1 schema landed in 0.6.x; Phase 2a backfilled units for every
  existing line item with an asset assigned.
- **Unit-aware readers** — `reservation-conflicts.ts`,
  `utilization.ts`, `availability.getAssetBookings`, and the
  `addLineItem` double-booked guard all union the legacy
  `line.assetId` source with the unit table. Detection of
  unit-deployed assets is now correct; swap-candidate exclusion and
  the swap-asset TOCTOU re-check handle both shapes.
- **Split-sibling collapse migration** (`npm run collapse:split-siblings`,
  dry-run by default) — collapses historic per-asset siblings back
  onto one canonical order line under a strict full-equivalence key
  (every order-level field identical or flagged-not-merged). Moves
  units, repoints `CheckRecord` / `DamageEvent` / `ProjectService`,
  writes a permanent `LineItemMergeMap` audit row, and deactivates
  the sibling without deleting it. Operator-gated apply on prod.

### Changed
- **Checkout / check-in / prep / scan-lookup** rewritten to write and
  resolve units. `splitLineItem` (the per-asset line-fragmenting
  function that caused the docket duplication) is retired — zero
  callers remain.
- Check-in carries an `assetId` through the warehouse UI so a partial
  return of a multi-unit line returns the right physical unit.
- Kit check-in uses a no-unit fallback path for kit children (which
  carry `line.assetId` directly, no unit row) — both shapes are
  handled uniformly.

### Notes
- Test coverage: 45 new unit tests + 37 new integration tests across
  checkout, check-in, prep, reservation-conflicts, and the collapse
  migration. Full suite green on merge.
- Phase 4 (drop the now-redundant `ProjectLineItem.assetId` /
  `bulkAssetId` columns) intentionally deferred until all readers are
  observed clean in production.

## [0.6.0.1] - 2026-05-21

Hotfix for a production crash introduced in 0.6.0.0.

### Fixed
- **`ReferenceError: ReorderCandidate is not defined` taking down SSR.**
  Four Wave 3 server-action files (`reorder`, `utilization`,
  `reservation-conflicts`, `project-costs`) re-exported a type through the
  `"use server"` boundary via `export type { X }`. Next.js's server-action
  transform caught those re-exported type names in the module's export
  list and emitted runtime references to identifiers that, being types,
  have no value — so the SSR chunk threw on module evaluation and crashed
  affected routes. Types now live only in their `src/lib/*` modules;
  `"use server"` files neither re-export them nor serve them to consumers,
  matching the convention used everywhere else.

## [0.6.0.0] - 2026-05-21

Wave 3 — the AV-rental wedge. Eight new operational features plus an
app-wide error-UX overhaul. GearFlow now tracks the full asset lifecycle:
damage at checkin, the repair queue, ROI per asset, periodic inventory
counts, and reordering — and lets each operator extend the data model
to fit their shop.

### Added
- **Damage capture at checkin** — report damage on a returning item
  straight from the warehouse return flow. Camera-first capture: severity
  (minor / major / total), notes, photos shot on the rear camera, optional
  charge-back to the client. Major and total damage auto-creates a linked
  workshop ticket and holds the asset. Browse every event at `/damage`.
- **Workshop kanban** — `/workshop` shows the repair queue as a board:
  Scheduled → Awaiting Parts → In Progress → QA, with a Completed lane.
  Click a card forward or back a stage; QA cards get Pass / Fail buttons.
  Pass releases the asset, Fail keeps it held. Two new maintenance
  statuses (Awaiting Parts, QA) extend the hold/release state machine.
- **Asset utilization dashboard** — `/utilization` answers "is this gear
  paying for itself?" Per asset: booking rate, revenue, maintenance cost,
  damage cost, net contribution. Period selector (30 / 90 / 365 days /
  all time) and an idle / lossy filter to surface dead stock.
- **Stocktake / inventory verification** — `/warehouse/stocktake` runs a
  scan-driven count session. Pick a location, scan everything, and the
  system flags every discrepancy — missing, unexpected, wrong location,
  quantity mismatch. Resolve each one (mark lost, adjust quantity, update
  location) and the inventory updates on completion.
- **Reorder dashboard** — `/warehouse/reorder` lists every bulk item at or
  below its reorder threshold, grouped by preferred supplier. Tick items
  and generate a draft supplier order per supplier in one click. Bulk
  assets gain a preferred-supplier field and a last-reordered timestamp.
- **Maintenance photos** — attach before/after photos to any maintenance
  ticket via a reusable photo-grid input. Workshop cards show thumbnails.
- **Reservation conflict resolution** — when an asset is double-booked
  across overlapping projects, the project page shows an amber banner and
  lets you swap the conflicting line item onto a free asset of the same
  model in one click.
- **Custom fields** — define operator-specific asset attributes (rig
  number, firmware version, road-case colour, anything) at
  `/settings/custom-fields`. They render on the asset create/edit form and
  detail page. Text, number, date, dropdown, and yes/no field types.
- **Operational P&L panel** — the project detail page gains a right-rail
  costs panel: equipment revenue minus service, labour, sub-hire,
  maintenance, and damage costs, with charge-back awareness and a net
  margin bar.

### Changed
- **Error messages now show context, not raw exceptions.** A new
  `UserFacingError` type plus a Prisma-error translator turn "Unique
  constraint failed on the fields: (`assetTag`)" into "Duplicate asset
  tag — that asset tag is already used. Pick a different value." Asset,
  project, and line-item actions surface structured title + message +
  hint. The warehouse return page's error toasts use the same helper.
- **QR / barcode scanner hardened for iPhone** — per-instance camera
  viewport, `playsInline` so iOS Safari streams inline instead of going
  fullscreen, a remembered camera choice, a zoom slider, torch, and Micro
  QR support. The check-items and warehouse-lookup pages now scan with the
  camera too.

### Fixed
- Custom items inside a project group no longer vanish from the project
  total — they count as extras on top of the group's bundle price.
- The reservation swap re-check and reassignment now run in one
  transaction, closing a race where two operators could swap onto the
  same asset and silently re-create a double-booking.
- Stocktake discrepancy resolution wraps each inventory mutation in a
  transaction and floors bulk quantities at zero, so a counted shortfall
  can't drive stock negative.
- Maintenance-record deletion releases held assets and deletes the record
  atomically.

## [0.5.1] - 2026-05-14

### Fixed
- **Sub-hire dialog supplier picker (and sibling queries) showed "No suppliers found" for up to 5 minutes after login.** Better Auth's session cookie cache (5-minute TTL) can briefly return `activeOrganizationId: null` even after a successful login. The supplier picker, project sub-hires list, and sub-hire detail queries were gated on `enabled: !!orgId` — when client-side `orgId` was null, the queries never ran and rendered empty state. Server actions already resolve org server-side via `getTheOrg()` (single-org pattern), so the client-side gate was unnecessary. Removed the gate from all three queries in `sub-hire-order-dialog.tsx`. Matches the existing pattern in `asset-form.tsx`. (`src/components/projects/sub-hire-order-dialog.tsx`)

### Chore
- Sync `VERSION` file to match `package.json` (0.4.5 → 0.5.1). The 0.5.0 release bumped `package.json` but left `VERSION` at 0.4.5.

## [0.5.0] - 2026-05-14

App-wide cleanup, unification, and feature-completeness pass. Wave 1 fixed
four operational bugs that could leave inventory or revenue in a wrong state.
Wave 2 closed the highest-pain audit gaps (errors, custom-items pricing,
project totals, notifications, scheduled reports, settings IA, design drift).
Per P10, the multi-tenancy harness is retained but soft-warn linted —
single-tenant is the operational reality.

### Added
- **Boot-time env validation** — `src/env.ts` fails fast on missing or
  malformed environment variables. Replaces scattered `process.env.X!` reads.
- **Sentry** — `@sentry/nextjs` wired with safe defaults for client/server/edge.
- **DamageEvent model + MaintenanceRecord.projectId** — operational P&L can
  now attribute repair cost and damage to a specific project.
- **Notification email delivery** — cron endpoint that fans out batched
  notifications to opted-in recipients via Resend, with a `NotificationEmailLog`
  dedupe table to prevent the same notification firing twice in a window.
- **Notification preference table** — settings page lets users opt in/out of
  each notification type.
- **Persistent notification dismissal** — `Notification.dismissedAt` replaces
  per-device localStorage so a dismissal on phone clears desktop too.
- **Scheduled reports** — saved reports can now run on a `DAILY` /
  `WEEKLY` / `MONTHLY` cadence and email a CSV to a list of recipients.
- **Test & Tag checkout gate** — assets with a current `FAILED` or `OVERDUE`
  T&T record cannot be checked out. `SCAN_VERIFY` denial event is logged.
- **Shared inventory mutation helper** — `src/lib/inventory-mutations.ts`
  provides `adjustBulkAvailability` (guarded `updateMany`) and an
  `InventoryError` class with `NOT_FOUND` / `CROSS_ORG` / `INSUFFICIENT_STOCK`
  codes. Used by all bulk-asset write paths.
- **Audit-trail timeline UI** — every entity detail page now shows the last
  5 events with a "View all" link to `/activity` scoped by entityType +
  entityId.
- **TOTAL column on /projects** — the project list now shows the canonical
  rolled-up job total (services + line items + sub-hires).
- **Custom-line-item pricing fields** — the Add Custom Item dialog now
  exposes `isOptional` and discount, matching the rest of the line-items UI.
- **DeleteDialog / BulkDeleteDialog / ConfirmActionMenuItem** primitives —
  one consistent confirm pattern across the app, replacing every remaining
  `window.confirm`.
- **`subHire` + `groupTemplate`** in global search; **crew, check items,
  group templates** in org export/import.

### Changed
- **Settings nav** grouped into 4 IA sections with overline labels
  (Organization, Operations, Documents, Integrations).
- **Activity Timeline** is collapsed by default (5 events) on every
  entity detail page, with a deep-link to `/activity`.
- **General settings** page flattened — one `Card` per section was
  visual noise. Replaced with section headers + dividers.
- **`staff` role consolidated into `member`** — `staff` was identical
  to `member` in permissions. One migration row update, no UX change.
- **`ProjectLineItem.isSubhire` dropped** — sub-hire detection is now
  `subHireId != null` (single source of truth). Migration includes a
  prod-check note: confirm zero legacy-only rows before deploy.
- **Custom items in groups** now contribute to project total via
  `customExtras` on top of `bundlePrice * quantity`. The "suggested
  price" remains equipment-only — custom items are always extras.

### Fixed
- **Kit checkout/checkin** now correctly updates bulk-asset availability
  for nested KitBulkItems. Previously a kit holding bulk items would
  check out the parent but leave bulk availability stale.
- **Maintenance state machine** — atomic transaction wraps create / update;
  asset status only transitions `AVAILABLE → IN_MAINTENANCE` on hold and
  `IN_MAINTENANCE → AVAILABLE` on release (and only when no other
  IN_PROGRESS record holds the asset).
- **BulkAsset availability** — one-shot reconcile script repairs any
  rows where `availableQuantity` drifted from `totalQuantity − checkedOut`.
- **LOW_STOCK email regression** — `getNotifications` now live-computes
  `availableQuantity <= reorderThreshold AND reorderThreshold > 0` instead
  of trusting the cached `status` enum. Previously a refilled bulk asset
  could keep sending low-stock alerts.
- **Custom-items-in-groups double-count (pre-landing review)** —
  `calculateSuggestedPrice` is now equipment-only. Accepting the
  suggestion no longer billed every custom item twice.
- **Scheduled-report duplicate-send (adversarial review)** —
  per-recipient try/catch in the cron runner. A transient sendEmail
  failure on one recipient no longer prevents the `scheduleLastRunAt`
  stamp and trigger a re-fire to everyone on the next tick.
- **`requirePermission` enforced on reads** in `group-templates`, `crew`,
  `check-items`, and `sub-hires` server actions.
- **DESIGN.md typography drift** swept across components.

### Engineering
- **50 new integration tests** across 5 files: `warehouse-tt-block`,
  `maintenance-state`, `group-revenue-custom-items`,
  `notifications`, `scheduled-reports`. Integration harness runs against
  a real Postgres instance (`gearflow_test`).
- **Wave 2 Track E** ships a soft-warn lint that flags `requirePermission`
  / `logActivity` gaps on server actions. Single-tenant per P10 — failures
  in audit do not block builds, but the report runs in CI.

## [0.4.5] - 2026-04-20

### Fixed
- Subhired items no longer prompt for an asset tag during warehouse prep. Since subhires are third-party equipment you don't own, they are now prepped directly without requiring an asset assignment.

## [0.4.4] - 2026-04-19

### Added
- **Custom line items**: Add free-text items to any project without needing inventory records. Use the new "Custom Item" button in the Equipment tab to add borrowed gear, client-supplied items, or one-off rentals that aren't in your asset library.
- Custom items show a muted "Custom" badge in the equipment list and all three warehouse tabs (Pick/Prep, Deploy, Return).
- Custom items appear on all project documents — quotes, invoices, packing lists, delivery dockets, and return sheets — using their entered name as the display label.
- Custom items flow through the full warehouse pick/prep → deploy → return cycle via the existing button/checkbox mechanism (no barcode scan required).
- `addCustomLineItem()` server action with validated input (`customLineItemSchema`) — requires a name, optional quantity, price, pricing type, duration, and notes.

## [0.4.3] - 2026-04-16

### Added
- Duplicate model detection in add equipment dialog. When adding a model that already exists on the project, users can choose to combine (merge quantity) or add as a separate line item.
- Sub-hire items always create separate line items and never merge with own-stock items of the same model.
- `forceSeparate` parameter on `addLineItem` server action to bypass auto-merge.
- Line item notes now display in the equipment list view (truncated with full text on hover) for both regular items and kit children.

### Fixed
- Combine/separate choice no longer resets when adjusting quantity. Previously, changing the quantity spinner silently reverted the selection back to "combine".

## [0.4.2] - 2026-04-16

### Fixed
- Editing a line item no longer wipes its model association. The `updateLineItem` server action was unconditionally setting `modelId` to null when the edit dialog didn't send it, which removed the item from all overbook calculations and made the badge disappear after any edit.
- Edit dialog now correctly warns when a line item is overbooked due to in-maintenance, lost, or retired assets. Previously, the edit dialog compared against raw stock (including unavailable assets), so overbooked items appeared editable without warnings.
- Adding a second line item for the same model on a project now shows accurate availability. The add dialog previously displayed stale stock counts because cache wasn't refreshed after edits, removes, or moves.
- Server-side availability enforcement in both add and update paths now uses effective stock (excluding unavailable assets), matching the overbook badge logic.

### Added
- Edit dialog now shows full availability info (available count, usable stock, unavailable asset breakdown, conflicting projects), matching the add dialog experience.
- `computeStockBreakdown` helper centralizes stock calculations across all availability checks, preventing client/server divergence.

## [0.4.1] - 2026-04-15

### Added
- Group template picker in the project equipment tab's Add Group dialog. Selecting a template auto-fills the group title and flips the create action to apply the template's items; leaving it blank creates an empty group as before.
- "Save as Template" action on each project group dropdown, with a dialog pre-filled from the group title. Captures the group's model- and kit-backed line items via `saveGroupAsTemplate` and invalidates the templates query so newly saved templates appear immediately in the picker.
- Group Templates management page at `/settings/group-templates` (nav entry gated by `project:manage_line_items`). Lists all templates sorted by name with expandable item previews (kit vs. model icons, quantity badges), rename/description edit dialog, and a delete dialog that clarifies existing projects keep their line items.

### Fixed
- `updateGroupTemplate` item-replace path no longer drops `kitId` and `sortOrder` when rebuilding template items.

## [0.4.0] - 2026-04-15

### Added
- Kit delete flow: the kit detail page now exposes a `DeleteKitDialog` with two tiers. Archive (soft delete) is always available while the kit is AVAILABLE + active, and is the default; hard delete is an opt-in second option that is blocked whenever any `ProjectLineItem` references the kit, so historical project data is preserved. The dialog surfaces a human-readable reason when hard delete is unavailable. New server actions `canDeleteKit(id)` and `deleteKit(id)` back the UI, gated by the existing `kit:delete` permission.
- Group templates now support kit items in addition to model items. `GroupTemplateItem` got a nullable `kitId` column and a Zod XOR refine so each row references exactly one of `modelId`/`kitId`. A template can mix both: "FOH Package" = 2x SM57 (model) + 1x rack kit (rigid). `saveGroupAsTemplate` captures both kinds from the source group; `applyGroupTemplate` creates the model lines inside the same transaction as the new group, then delegates kit items to `addKitLineItem` per unit of quantity (so "2x rack kit" becomes two independent parent rows with their full child expansions). Kit expansion failures (conflicts, availability) are collected as warnings rather than aborting the apply, matching warehouse-staff expectations.

### Removed
- The unused `KitPreset` / `KitPresetItem` tables (introduced in an earlier WIP migration) have been dropped in favor of extending the existing `GroupTemplate` system. The `group_template_supports_kits` migration atomically drops the orphan tables and adds `kitId` + `sortOrder` to `group_template_item`.

## [0.3.5] - 2026-04-15

### Added
- Keyboard shortcuts in the warehouse item check form: `P`/`F` to pass/fail the focused PASS_FAIL row with auto-advance, `A` to pass all remaining, `↑`/`↓` to move the focused-row cursor (skips non-PASS_FAIL rows), `Enter` to submit. Shortcuts are suppressed while typing in a text input, while submitting, or with a modifier key held. Desktop-only hint bar in the sheet footer shows the available keys.
- Deprep check gate: deprepping a returned item whose model has check items now runs a second RETURN-context check at deprep time (the inventory↔staging boundary), in addition to the existing return-scan check. Matches the mental model where Deploy is a staging ground on both sides of the truck. Damaged/flagged items bypass the second check. Kits respect `KitCheckMode` (KIT_LEVEL runs one kit-level check, PER_ITEM runs a queue entry per child).
- New `completeCheckAndDeprep` server action that writes RETURN-context check records and resets `prepStatus=PENDING` in one transaction.
- React component test infrastructure (`@testing-library/react` + jsdom) with 11 keyboard-handler tests for `ItemCheckForm`. Existing 1656 node-env validation tests are unaffected.

### Fixed
- Scan input auto-refocus after check completion: `finishCheckQueue` now returns focus to the correct scan input via `requestAnimationFrame` (PREP → main scan input, RETURN → return-tab scan input, deprep → deploy-tab scan input), letting barcode scanners flow scan-to-scan without a mouse click between checks.
- Timer leak in `ItemCheckForm` pass-all undo window — the 3-second setTimeout is now cleared on form close and component unmount.
- `completeCheckAndDeprep` pre-condition guard now strictly enforces `status=RETURNED` and `prepStatus=PACKED`, rejecting CONFIRMED/PREPPING items that could previously have been written against by a race or UI bug.

## [0.3.4] - 2026-04-15

### Fixed
- Edit line item dialog (equipment tab) now shows overbooking warnings and requires confirmation to save an overbooked quantity — previously the warning only existed when adding items
- Overbooked badge in the equipment table now wraps onto a second line on narrow viewports instead of overflowing outside the table column, so the badge is visible on mobile
- Sub-hire line items no longer consume our own stock in availability/overbooking calculations — they represent third-party rental so they should be invisible to our inventory math (fixed in `addLineItem`, `updateLineItem`, `checkAvailability`, and `computeOverbookedStatus`)
- `updateLineItem` now enforces availability server-side when quantity increases, matching `addLineItem` — previously the `allowOverbook` parameter was accepted but never checked, letting the client bypass overbook confirmation
- Project status changes (cancelled, completed, returned, invoiced) now invalidate overbook/availability caches across all open projects, so stock freed up by the transition is visible immediately instead of after a 30s stale window
- Edit dialog overbook warning now surfaces a "no dates set — checking stock only" notice when the project has no rental dates, matching the add dialog

### Removed
- Dead code: `line-items-panel.tsx` and `edit-line-item-dialog.tsx` were imported but never rendered (replaced by `equipment-tab.tsx`). Deleting them prevents future audits from getting misled by stale overbooking logic in an unreachable component.

## [0.3.3] - 2026-04-14

### Fixed
- Overbooking badges and availability conflict detection now work when adding equipment to projects (dates were not being passed through to the availability checker)
- Overbooking badges now refresh immediately after adding, editing, or removing line items instead of staying stale for up to 30 seconds
- Kit additions and line item deletions via the line items panel now also refresh overbooking status

## [0.3.2] - 2026-04-01

### Added
- Timeline PDF multi-page pagination: services that overflow one page now automatically split across multiple pages with continuation headers
- Timeline PDF column settings: configurable columns (crew, location, notes, charge, cost, status) via query params with sensible defaults

### Fixed
- Crew members with multiple roles on the same project no longer appear as duplicate rows on call sheets, roles are merged into a single entry
- Day-header separators between dates on multi-day call sheets now have stronger visual separation with background fill and thicker borders
- Unicode bullet character in day-header replaced with ASCII pipe for Helvetica font compatibility
- Timeline route no longer loads unnecessary crew assignment data from the database
- Crew role deduplication now uses exact match instead of substring match, preventing silent role drops

## [0.3.1] - 2026-04-01

### Added
- Multi-day call sheets: generate one PDF with separate pages per day, each with day header showing date, phase badges, and crew count
- Per-person call sheets: filter to a single crew member's schedule across all days
- Crew role filtering: filter call sheet output to a specific crew role
- Call sheet info section: dense 2-column block showing PM contact, client, venue, schedule times, and equipment summary on call sheets
- Call sheet generation dialog: date picker with crew count badges, role filter, and individual crew member selector
- PM contact extraction from ProjectManager join table for call sheet info
- Equipment summary computation for call sheet context
- Day header pdfme plugin with accent bar, bold date label, and phase badges
- Call sheet info pdfme plugin with configurable visibility toggles
- 17 new tests covering section expansion logic, height estimation, and Zod validation

### Fixed
- Cap dates query parameter at 31 before parsing to prevent unbounded allocation

## [0.3.0] - 2026-04-01

### Added
- Sub-hire order system: first-class entities for tracking gear rented from third-party suppliers
- Dual cost/charge pricing with gross margin analysis on every sub-hire order
- Sub-hire groups: organize items into logical sections with group-level pricing overrides
- Two pricing modes: itemized (per-item costs) or order total (single lump sum)
- Supplier rate memory: last-used rates saved per model+supplier pair, auto-filled on next order
- Cost comparison panel: see rates from all suppliers when adding items to a sub-hire
- Sub-hire lifecycle: Draft → Confirmed → On Hire → Returned, with automatic line item generation on confirm
- Per-item placement targeting: assign sub-hire items to specific project categories/groups
- Per-item document visibility: control which items appear on quotes, invoices, and packing lists
- Sub-hire items integrate into project financial totals (subtotal, tax, total)
- Dashboard metrics: active sub-hires count, monthly sub-hire cost, overdue returns
- Shortage-triggered sub-hire: when adding equipment exceeds stock, prompt to sub-hire the shortfall
- Quick duplicate: clone a sub-hire order to a new draft with same items
- "via Supplier" display on sub-hire items across warehouse tabs and pull sheets
- Subhire badge on pull sheet (HTML and PDF) for internal warehouse documents
- Supplier name rendering on PDF packing lists and delivery dockets
- Payment status tracking and file attachments on sub-hire orders
- 94 new validation schema tests for sub-hire system

### Changed
- Legacy free-text "Add Subhire" dialog removed in favor of structured sub-hire orders
- Sub-hire status actions moved to header dropdown menu on project detail
- Equipment tab shows sub-hire items as kit-style groups with children
- Financial summary now includes sub-hire charges in project totals

### Fixed
- Duplicate line item generation when re-confirming sub-hire orders
- Sub-hire items appearing as regular flat line items instead of grouped display
- Sub-hire costs not flowing through to project financial calculations
- Cross-tenant write vulnerability in sub-hire item reorder (org scoping added)
- Missing org scoping on sub-hire status return path and line item sync queries

## [0.2.6] - 2026-03-28

### Added
- Project finance rewrite: billing weeks/days pricing model with per-group overrides
- Equipment tab category/group/line-item hierarchy with drag-and-drop reordering
- Line item edit dialog, move between groups, and uncategorized items section
- Category rename/delete UI with inline editing
- Group edit dialog with price field and suggested price hint
- Project manager picker and rental defaults on project form
- Merge notification toast when equipment items combine
- Template picker, pricing progress bar, and audit trail on project detail
- Default tax rate in org settings
- Financial summary sidebar with margin tracking
- 42 new validation and formatter tests for finance schemas

### Changed
- Equipment tab rewritten as proper flat table layout with table-layout fixed
- Group rows match line item style with edit button and dropdown menu
- Removed legacy groupName field from add dialogs, replaced with "Adding to" label
- Removed pricing approval UI (accept suggested price buttons)
- Project form UX overhaul: billing time under rental dates, match button

### Fixed
- Drag-and-drop: replaced nested DndContexts with single flat context using prefixed IDs
- Table column reflow on group expand/collapse (table-layout: fixed + colgroup)
- Broken callbacks and missing query invalidations in equipment tab
- Move dialog now defaults to item's current group instead of uncategorized

## [0.2.5] - 2026-03-25

### Added
- Warehouse check item system: org-scoped check item library with PASS_FAIL, NOTES, MEASUREMENT, and DROPDOWN types
- Model and kit check item assignments with drag-to-reorder and library picker
- Three-phase warehouse prep flow: Pick → Prep (with checks) → Deploy, replacing the old single-step checkout
- Check form sheet (full-screen mobile, slide-over desktop) with "Pass All" shortcut and photo upload on failures
- Multi-item check queue for serial/bulk prep and return flows
- Container grouping system: prepContainer field with auto-add container assets, container picker with category search
- Kit check modes: KIT_LEVEL (check the kit itself) and CHILD_ITEMS (check each child individually)
- PrepStatus and ReturnStatus enums for independent warehouse lifecycle tracking
- Warehouse close-out: per-project close with summary stats, batch close from dashboard
- Check history tab on asset detail pages with context filtering
- Model failure analytics widget showing per-check-item failure rates
- Ad-hoc check route at `/check/[assetTag]` for standalone inspections
- Predictive maintenance: auto-creates maintenance records when 2+ consecutive failures detected
- Flagged asset notifications for project managers
- Check items integrated into global search and page commands
- `splitLineItem` helper for DRY multi-quantity line item splitting (extracted from 5 duplicated sites)
- Bulk assign check items to multiple models from the model table (row selection + multi-select dialog)
- 61 new validation tests for check item schemas
- Container grouping in pull sheet PDFs with asset tag display

### Changed
- Warehouse page split into tab components (deploy-tab, return-tab, pick-prep-tab, close-out-tab) from monolithic 2700-line page
- Prep flow uses split-based pattern: multi-qty items split off qty=1 items during prep
- Removed old prep-kit system in favor of prepContainer string field
- Asset availability query rewritten as single atomic Prisma filter using `none` relation

### Fixed
- Asset availability filtering: assets already assigned to other projects no longer appear in picker
- Bulk items with checks now prep all units in one check dialog
- Items of same model in different containers grouped separately
- Quick-add scan now routes through check queue when model has check items (was skipping checks entirely)
- WarehouseClose uses unique constraint to prevent duplicate close-outs (race condition fix)
- deleteCheckItem blocks deletion when check item is used by kits (not just models)
- Design system compliance: notices use left-edge accent bar, metrics use inline strip, teal palette for selection badges

## [0.2.3] - 2026-03-20

### Added
- Section-based PDF template builder with block editor UI (3-pane layout: block tree, PDF preview, settings panel)
- Drag-and-drop block tree with row/column layout system and cross-column content moves
- Section settings panel with per-section-type controls (table columns, styling, conditional visibility, custom fields)
- Column width picker with preset layouts and custom percentage inputs
- Brand template system for reusable header/footer/accent color configurations
- Section presets — save and load custom section groups across templates
- Section renderer with multi-page pagination engine supporting table splitting, group headers, and continuation pages
- Condition evaluator for dynamic section visibility based on document data
- Token resolver whitelist for safe template variable substitution
- `gearflow-rect` plugin for section background/border styling
- Document-level settings types and save pipeline for footer configuration (page numbers, text, format)
- 124 new tests covering block utilities, section renderer, token resolver, condition evaluator, and validation schemas

### Fixed
- PDF table pagination: fixed N×N page multiplication caused by separate pdfme inputs per page
- PDF table pagination: fixed item duplication when items span page breaks (startIndex/endIndex/isContinuation)
- PDF table pagination: aligned section-renderer filtering/grouping with plugin to fix 64-page PDF bug
- PDF table pagination: fixed phantom table padding and group header re-draw height estimation
- Crew table overflow clipping to page bounds
- Null guards in page header plugin and crew table to prevent 500 errors on preview
- TOCTOU race condition in template save optimistic locking (moved to transaction)
- Added size validation guard on template thumbnail uploads

### Changed
- Template preview now uses native browser PDF viewer instead of custom renderer
- Document template schema extended with section-based fields, brand template reference, and thumbnail storage

## [0.2.2] - 2026-03-19

### Added
- Full UX/UI structural redesign eliminating "AI slop" patterns across the entire app
- New design system (`DESIGN.md`) with deep teal primary palette, DM Sans typography, and motion guidelines
- Framer Motion utility components: `FadeIn`, `StaggerList`, `StaggerItem`, `AnimatedNumber`, `SurfaceLift`, `TabFade`
- Pure SVG data visualization: `Sparkline`, `UtilizationBar`, `DateRangeBar` (no charting library)
- 10 domain-specific spot illustrations for empty states (road case, stage plot, headset, etc.)
- Centralized `StatusIndicator` component with `status-colors.ts` replacing 20+ scattered inline color maps
- Keyboard shortcuts system (`Cmd+K` search, `Cmd+N` create, navigation shortcuts)
- Reusable `PageHeader`, `ListPageLayout`, `SectionHeader` layout components
- Shimmer skeleton loading states replacing static placeholders
- 61 new tests covering status colors, sparkline math, empty state resolution, dashboard utilities

### Changed
- **Dashboard**: Replaced 7 identical stat cards with inline metrics strip, dynamic time-of-day greeting, alert badges (overdue/maintenance), and DateRangeBar-enriched project list
- **All detail pages** (10 pages): Converted from full-width tab layout to asymmetric 2-column layout with sticky sidebar containing key info, eliminating need to tab through to find status/dates/financials
- **Sidebar navigation**: Reorganized into 5 logical sections (Core, Assets, Operations, People, Admin) with Quick Create dropdown
- **Warehouse**: Projects grouped by urgency (overdue → today → upcoming) with color-coded left borders
- **Login page**: Split-panel layout with brand panel and dot grid background
- **Tables**: Removed uniform surface wrappers, added contextual data (DateRangeBar in projects, utilization in assets, cert count in crew)
- **Forms**: Replaced Card wrappers with `SectionHeader` chip labels and increased spacing
- **Empty states**: Added spot illustrations and preset system for 20 domain contexts
- **Settings/Account**: Section-based layout with `SectionHeader` labels replacing monolithic cards
- **Availability calendar**: Borderless grid with contextual month header

### Removed
- Legacy Card component wrappers on forms, settings, and detail pages
- Old color tokens (`bg-muted`, `text-foreground`, `text-muted-foreground`) — replaced with semantic tokens
- Stat card grid pattern on dashboard
- Uniform surface-ring wrapping on all tables

## [0.2.1] - 2026-03-19

### Fixed
- Resolved all 145 ESLint errors to pass CI lint checks
- Excluded third-party gstack skill files from project ESLint scope
- Fixed misplaced `eslint-disable` comments that weren't suppressing errors
- Fixed `prefer-const` violations across PDF and server modules
- Fixed `react/no-children-prop` error by renaming `children` prop on KitChildRows
- Fixed `useMemo` dependency array using method calls instead of simple expressions
- Removed stale `eslint-disable` directive on interface with no violation

## [0.2.0] - 2026-03-19

### Added
- Test infrastructure: Vitest for unit tests, Playwright scaffold for E2E
- 1,084 unit tests covering all 20 Zod validation schemas + utility functions
- VERSION file for semantic versioning
- CHANGELOG.md following Keep a Changelog format
- TODOS.md for tracking deferred work
- CI pipeline now runs tests before deploy
- npm scripts: `test`, `test:watch`, `test:coverage`, `test:e2e`

## [0.1.0] - 2026-03-10

Initial release of GearFlow — asset and rental management platform for AV/theatre production companies.

### Added

#### Core Platform
- Next.js 16 App Router with Turbopack, TypeScript strict mode
- PostgreSQL database with Prisma v6 ORM (56 models)
- Better Auth with organization plugin, 2FA, passkeys, SSO (SAML/OIDC)
- Two-tier role system: site admin + org roles (owner, admin, manager, member, viewer)
- Custom per-org roles with granular permission matrix
- Tailwind CSS v4 + shadcn/ui v4 dark theme

#### Asset Management
- Serialized and bulk asset CRUD with auto-incrementing asset tags
- Asset models with categories, specifications, and custom fields
- Kit system — physical containers with fixed sets of assets
- QR code generation and barcode scanning
- Media uploads to S3 with org-prefixed paths
- CSV import/export for assets and models

#### Project & Rental Lifecycle
- Full project lifecycle: enquiry → quoting → confirmed → deployed → returned → invoiced
- Line items with per-day/week/hour/flat pricing and group support
- Subhire line items for third-party equipment
- Project templates and duplication
- Availability engine with overbooking detection
- Booking calendar views for models, assets, and kits

#### Warehouse Operations
- Barcode-driven checkout/checkin scanning
- Kit atomic checkout/checkin (scans kit, deploys all contents)
- Pull sheet generation for project preparation
- Warehouse display dashboard (live, token-based)
- Conflict detection for double-bookings

#### Documents & PDFs
- Quote, invoice, packing list, return sheet, delivery docket, call sheet PDFs
- Custom document template designer (pdfme)
- Kit group rendering in documents

#### Crew Management
- Crew members with roles, skills, and certifications
- Project assignments with phases and rate overrides
- Shift scheduling and timesheet tracking
- Crew availability calendar
- iCal feed export

#### Compliance & Maintenance
- AS/NZS 3760 Test & Tag module with full electrical test records
- Maintenance records (multi-asset, scheduled/ad-hoc)
- Compliance reporting (PDF/CSV)

#### Clients & Suppliers
- Client directory with company/individual types
- Supplier management with purchase orders
- Address autocomplete via Google Maps

#### Reporting & Search
- Report engine with ~30 pre-built reports and custom report builder
- Global search with fuzzy matching and keyboard navigation
- Activity log audit trail

#### Settings & Admin
- Organisation settings: branding, asset tag config, timezone
- Site admin panel for user/org management
- Team member invitations via Resend email
- WooCommerce integration (webhook-driven order import)

#### Mobile & PWA
- Progressive Web App with offline support
- Mobile-responsive layout with safe areas
- Continuous barcode scanning on mobile

### Infrastructure
- Self-hosted deployment via GitHub Actions + PM2
- Google Maps integration (address autocomplete, location mapping)
