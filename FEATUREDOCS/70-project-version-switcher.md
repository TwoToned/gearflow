# Project Version Switcher (Phase 3 projection + Phase 4 promote/list + Phase 5 header actions + Phase 6 equipment parity)

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-03 (review quarterly — POLICY.md R-5.5)_

Phase 3 of #1080 (issue #1093) — the read path that lets a project's Equipment,
Labour & logistics and Finance tabs render a **past version's** captured state
behind a read-only bar, switched via a header dropdown and a `?v=` URL param.
Phase 4 (issue #1097) landed on top of it: "Make vN live" is now a real,
user-facing action — the promote dialog wired into both the read-only bar and
the Finance tab's version rail — and the version rail itself (`ProjectQuoteRail`)
is now the project's ONE version list, with the old `⋯ Versions` panel retired.
Phase 5 ("fine-tune versioning") turned the header switcher itself into a full
version menu — see §"Phase 5" below. Phase 6 ("look exactly the same as the
live version") closed the Equipment tab's biggest visual gap — sub-hires and
`categorySlots` ordering are now captured and rendered — see §"Phase 6" below.

**Depends on:** Phase 1 (#1085, merged) — `projects.liveRevision`, `saveVersionNative`,
the `VERSION_SAVED`/`PRE_PROMOTE` snapshot reasons. Phase 2 (#1089, merged) —
`promoteRevisionNative`, `scope: "PROMOTE"`.
**Still out of scope:** Recall-to-edit (#1100, Phase 5) — a promoted SENT
revision can be made live, but editing it afterwards is still refused by the
existing quote-derived lock until that phase lands.

## The model (unchanged from Phase 1, restated for this phase)

```
projects.revision      : number   ← the ALLOCATOR. Highest version number ever handed out.
projects.liveRevision  : number   ← the version projected onto the live tables. Absent ⇒ revision.
```

Which version you're **viewing** is a per-user URL param (`?v=2`), never a database
field — two people can view different versions of the same project at once and
neither affects the other or the live data. Absent or equal to `liveRevision` ⇒
ordinary live rendering, no bar, no read-only treatment.

## The projection seam

One pure mapper, `src/lib/project-version-projection.ts`'s `projectSnapshotEntries()`,
turns a `SnapshotEntryLike[]` — the shape BOTH `projectLocksRead.snapshotEntries`
(a frozen version) and `projectLocksRead.currentEntries` (the live state) return —
into `ProjectedView`: categories/groups/line items, services, crew, the project's
own financial + identity fields, and its own `crewNotes`/`internalNotes`/`clientNotes`.
Framework-free and pure, so the SAME function runs in a React render, inside a
Convex query handler, and in a plain unit test — one mapper serving both the
snapshot path and the live path (POLICY.md R-3.1), never a parallel hand-written
shape per source. This is the property `convex/projectVersionsRead.test.ts`'s
"projection parity" test asserts directly: map a snapshot's entries and map
`currentEntries` for the identical live fixture the snapshot was captured from,
and the two `ProjectedView`s must be equal.

**No new entry-level read was added.** `projectLocksRead.snapshotEntries`/
`currentEntries` (#990) were already org-checked (parent-row check before trusting
`by_snapshotId`, R-8.4.3) and already used by `RepriceFromRevisionDialog`. This
phase adds exactly ONE new query, `projectVersionsRead.listVersions` — the
switcher's per-revision list (state, date, total), org-checked the same way.

### What the mapper cannot produce

Live availability and live warehouse status are never in `SnapshotEntityType`
(`convex/lib/projectSnapshots.ts`) — these are genuinely point-in-time facts a
frozen version can never recompute, not a bug in this phase. Sub-hire lines and
category-slot ordering used to be on this list too; Phase 6 (below) closed that
gap by widening capture. Real money already invoiced/received
(`invoicedTotal`/`depositPaid`) is deliberately passed as `null` into the
projected Finance view for a related but distinct reason — it's not versioned
at all (design doc decision 3, invoices are lineage-labelled on ONE
project-level ledger, never rolled back), not merely uncapturable.

## ⚠️ Deliberate scope decision: a separate read-only render surface, not an `aria-disabled` sweep of the live tabs

The design doc's UI description (§4.2) describes every control on the LIVE
Equipment/Labour/Finance components rendering `aria-disabled` while a version is
viewed. This phase does not do that. Instead, `EquipmentTabSlot`/`LabourTabSlot`/
`FinanceTabSlot` (`src/app/(app)/projects/[id]/page.tsx`, bottom of file) swap the
live component for a dedicated read-only component
(`version-projected-equipment.tsx`/`version-projected-labour.tsx`/
`version-projected-finance.tsx`) fed by the same mapper.

Why: `EquipmentTab` (2500+ lines: drag-and-drop reordering, kit/sub-hire dialogs,
bulk actions, inline editors) and `ServicesPanel` (2200+ lines) are large enough
that auditing and gating every mutating control inside them is a substantially
larger, higher-regression-risk undertaking than this phase's read path — and most
of their affordances (reorder, add kit member, bulk check-out) have no meaning at
all against a read-only historical snapshot. A dedicated read-only surface with NO
mutating controls is structurally safer than a sweep that has to find and disable
every one of them (a missed one is a live-editing bug reachable while "viewing
history"). `GatedButton`/`LockedField` (the `aria-disabled` + `TooltipProvider`
primitives from #990) remain the right tool for the LIFECYCLE lock, which continues
to gate the live tabs unchanged.

Phase 6 (below) took the "if product feedback wants the exact live layout" follow-up
this section used to flag — but landed it as a THIRD option, not the
`aria-disabled`-sweep this section rejected: genuinely static markup that reuses
the live tab's DATA shapes and ordering algorithm, not its interactive row
components. The reasoning above (auditing 2500+ lines of mutating controls is a
bigger, riskier undertaking than a dedicated read-only surface) still holds —
Phase 6 didn't revisit it, it found a way to get closer to the same visual result
without doing that audit.

## Routing and state

`ProjectVersionProvider` (`src/components/projects/project-version-context.tsx`)
wraps the whole project-detail body (header through tabs) in `page.tsx`. It:

1. Fetches `projectVersionsRead.listVersions` (skipped until `orgId` resolves).
2. Parses `?v=` (digits only; anything else is treated as absent).
3. Resolves `liveRevision` from the list's `isLive` flag — never re-derived
   client-side from `project.revision`/`liveRevision` (one coalesce, server-side,
   same reasoning as `convex/lib/quoteState.ts`'s `projectLiveRevision`).
4. `isViewingVersion` is true only once the list has loaded AND the requested
   revision is a real, non-live one — never a flash of read-only chrome while
   `versions` is still loading.
5. When viewing a version with a snapshot, fetches `snapshotEntries` and maps it.
6. `setViewingRevision(n | null)` updates `?v=` via `router.push`, preserving
   `?tab=` and any other existing search params.

`useProjectVersion()` throws outside the provider — every consumer (the switcher,
the read-only bar, the tab slots, the "not versioned" notes) is meant to be
mounted under it; a missing provider is a wiring bug, not a state to degrade
gracefully from.

## Tabs that don't project

- **Tasks** (`projectTasks`) and **Files** (`projectMedia`) — never in the
  snapshot, stay live, render `<VersionNotTrackedNote>` while viewing a version.
- **Notes** — the tab itself IS versioned (`crewNotes`/`internalNotes`/
  `clientNotes` are project-row fields, captured because the whole project row is
  snapshotted). While viewing a version, `NotesTabSlot` renders the captured text
  read-only instead of the live `<NotesEditor>` — don't confuse this with the
  Tasks/Files "not versioned" case; the collaboration comment-thread UI (a
  separate header button, `ProjectCommentsButton`, not this tab) is the thing
  that's genuinely never captured.
- **Invoices** (inside the Finance tab) stay live always, per design decision 3 —
  `ProjectFinancePanel` renders unconditionally regardless of the viewed version.
  `invoices.sourceRevision` display (lineage labelling per version) is Phase 4
  scope (#1097), not this phase.

## Phase 4 — promote UI, version list, invoice lineage, labels (#1097)

**Two entry points, one dialog.** `PromoteVersionDialog`
(`src/components/projects/finance/promote-version-dialog.tsx`) is mounted from
both `VersionReadOnlyBar` ("Make vN live…", shown while actively viewing that
version) and each row in `ProjectQuoteRail` (a "Make live" button next to any
non-live revision that has captured state) — R-3.1, one confirm surface, not
two hand-built ones. It states what changes BEFORE it runs: counts of the
target's line items/groups/services, the rental-window move (if any), and a
CLIENT-SIDE PREDICTED conflict list computed from the same
`snapshotEntries`/`currentEntries` pair `RepriceFromRevisionDialog` already
uses (no new read path) — the prediction mirrors `isWarehouseBacked`
(`convex/lib/projectSnapshots.ts`) but the mutation's own returned `conflicts`
array is the authoritative one, rendered after the fact in
`PromoteConflictsPanel` (a PERSISTENT panel, not a toast — mounted at both
promote entry points, dismissed explicitly).

**The version rail is the Finance tab's ONE version list.** `ProjectQuoteRail`
(`src/components/projects/project-quote-rail.tsx`) already existed pre-Phase-4
as the quote-verb workflow; it queries `quotes` (not `projectSnapshots`), so it
was already "revisions only" without further filtering. Phase 4 added: a
"Live" pill and the version's `label` on the row (`RevisionMeta`); a "Rename
version" action (`setQuoteLabelNative`) reachable on any revision; a "Make
live" button on any non-live revision with a snapshot; and a per-row invoice
lineage line (`InvoiceLineageNote`) filtering the `invoices` array — passed
down from `ProjectFinancePanel`'s existing `invoices.listForProject` query,
not a second fetch — by `sourceRevision === quote.version`.

**Deletion — three cases** (`convex/quotesWrites.ts`): `deleteDraftNative`
(the LIVE draft, unchanged from #1028 except it now rolls `liveRevision` back
alongside `revision`) vs. the NEW `deleteVersionNative` (a non-live,
never-sent saved version — deletes the quote row and its
`projectSnapshots`/`projectSnapshotEntries` rows, touches neither counter) vs.
the unchanged recall-then-delete flow (anything ever sent, #1029). The rail's
`DeleteDraftDialog` picks between the first two based on
`target.version === liveRevision`; guard order for the new mutation is live →
ever-sent → protected (`assertVersionDeletable`), mirroring
`assertRecalledDeletable`'s precedent.

**`sendNative` now targets the LIVE revision, not the allocator.** A latent
gap from Phase 1/2: `prepareSend` used to key off `projects.revision` (the
high-water mark), which was harmless before Phase 2 shipped (the two numbers
were always equal) but wrong the moment a promote can point `liveRevision` at
an older number — sending would misidentify which row to freeze. Fixed to key
off `projectLiveRevision(project)`, matching `newVersionNative`/
`repriceFromRevisionNative`'s existing pattern.

**Labels on the document.** `sendNative` gained `labelOnDocument` (only
stamped `true` when the revision already carries a `label` — nothing to print
otherwise). `generateQuoteArtifact` (`src/server/finance-documents.ts`) builds
a `versionSuffix` (`v2` or `v2 · Budget option`) passed through
`generatePdf`/`buildDocumentData` into `project_number` — an existing string
field, not a `DocumentLineItem` shape change or a new `LayoutBlock` kind, so
it doesn't trigger the PDF pipeline's three-consumer audit (CLAUDE.md). The
composed line gets the SAME measured shrink-to-fit `docTitle` already has
(`truncateText`, `src/lib/pdfme/plugins/helpers.ts`) — user-entered text,
Helvetica-only, single line, no other cap existed on that draw call.

**`invoices.sourceRevision`** (`convex/schema.ts`) is stamped once by
`invoicesWrites.createNative`/`createCreditNative` at CREATE time (the
project's THEN-live revision) and never updated — a void doesn't touch it, and
a CREDIT invoice gets its OWN stamp, not a copy of the invoice it credits.
Backfilled best-effort (`convex/backfillInvoiceSourceRevision.ts`, driver
`scripts/convex-backfill-invoice-source-revision.ts`) from the project's
CURRENT `revision` — pre-#1097 rows have no true historical record, so an
un-attributable invoice legitimately keeps `sourceRevision` absent rather than
guessing.

**The old `⋯ Versions` panel is retired** — `project-versions-panel.tsx`,
its mount, and its menu entry are deleted (`src/app/(app)/projects/[id]/page.tsx`).
`captureProjectSnapshot` keeps firing for `CONFIRMED`/`COMPLETED`/`UNLOCK` —
`UNLOCK` is load-bearing for unlock-session discard — those rows just never
appeared in this panel's list to begin with (it queries `quotes`, not
`projectSnapshots`).

## Phase 5 — the header switcher becomes the version menu ("fine-tune versioning")

The complaint this phase fixes: **you couldn't make v2 without sending v1's
quote.** That was never a deliberate rule — it was that the only *wired*
version-creating mutation was `newVersionNative` (`project-quote-rail.tsx`'s
"Create quote v{N+1}"), which exists specifically as the sanctioned exit from
a quote-sent lock and therefore requires the current live revision to already
be SENT. `saveVersionNative` (Phase 1, #1085) — reachable from ANY live
state, including a never-sent DRAFT — had existed the whole time with no UI
caller. This phase wires it up and, while doing so, turns
`ProjectVersionSwitcher` (`src/components/projects/version-switcher.tsx`) from
a read-only list+switch into the project's one version-management surface:

- **Add version** (footer item) → `useProjectVersionWrites().saveVersion()` →
  `saveVersionNative`. One click, no prompt — rename afterwards via the
  existing "Rename version" row action if wanted. `newVersionNative` is
  UNCHANGED and still the right tool for its own job (unlocking editing after
  a sent quote); the two are not merged (R-3.1 — distinct jobs, distinct
  mutations, not one bent to cover both).
- **Make live…** on any non-live row with captured state → the same
  `PromoteVersionDialog` `VersionReadOnlyBar` and `ProjectQuoteRail` already
  open — a third entry point into one dialog, not a fourth hand-built confirm.
- **Send quote…** on the live row, only while its status is DRAFT → the same
  `SendQuoteDialog` the rail uses. Never offered on a non-live row:
  `sendNative` always freezes whichever revision is `liveRevision`, so
  "make a quote for a past version" isn't a real operation — promote it live
  first.
- **Download** on any row with a stored artifact (`pdfFileId`) → the same
  `/api/finance/quote/{id}/pdf` link `QuoteDocumentAction` uses.
- **Delete** on any never-sent DRAFT row → `DeleteVersionDialog`
  (`src/components/projects/finance/delete-version-dialog.tsx`), extracted
  from the rail's former locally-defined `DeleteDraftDialog` so both surfaces
  share the one live-vs-non-live branch (R-3.1) instead of two copies of the
  same `deleteDraftNative`-vs-`deleteVersionNative` decision.

**The empty-state gap.** Before this phase, `listVersions` (and therefore the
whole switcher) rendered nothing at all until a project's first quote row
existed — a brand-new project has `projects.revision`/`liveRevision` seeded to
1 at `createNative` but no `quotes` row until something sends or saves a
version, so the header button simply didn't appear yet. `listVersions`
(`convex/projectVersionsRead.ts`) now synthesizes ONE virtual live entry
(`quoteId: ""`, `status: "DRAFT"`, `hasSnapshot: false`) when a non-template
project has zero quote rows, so the button — and its Add version/Send quote
actions — is always there. Both underlying mutations already tolerated this:
`saveVersionNative`'s `outgoing` lookup is optional, and `sendNative`'s own
docstring states it creates the DRAFT row itself when the revision has none
yet. The synthetic entry is never persisted and never appears in
`quotes.listForProject` (the Finance tab rail's own query) — it exists only in
this one read, purely so the switcher has something to render.

Action visibility is gated by `useCanDo("invoice", "publish")` (matching
`CanDo resource="invoice" action="publish"` everywhere else a quote verb is
offered) — a caller without it sees the plain list with no action icons.

## Phase 6 — Equipment tab parity with the live table ("look exactly the same as the live version")

The complaint this phase fixes: viewing a captured version's Equipment tab
looked visibly different from the live tab — a caveat banner
("Sub-hires and custom item ordering aren't captured in this version") instead
of the real table, sub-hire groups invisible, and groups/standalone items
rendered as two separate sequential lists instead of their actual
`categorySlots`-interleaved order. The only difference the request accepted:
live availability/overbooking calculations, which are genuinely
un-recomputable for a past version.

**Capture widened, additively.** `SnapshotEntityType`
(`convex/lib/projectSnapshots.ts`) gained four members: `subHire`,
`subHireItem`, `subHireGroup`, `categorySlot` — kept in lockstep across every
place this union is redeclared (R-3.1): `convex/schema.ts`'s
`projectSnapshotEntries.entityType` validator itself, `convex/projectLocksRead.ts`'s
`ENTRY_RETURNS`, `src/lib/project-version-projection.ts`'s and
`src/lib/project-snapshot-diff.ts`'s local types — five places total now
(check all of them the next time this union changes). `subHireItems`/
`subHireGroups`/`categorySlots` carry no `organizationId` — `captureProjectSnapshot`/
`collectCurrentEntries` share one new helper, `collectSubHireRelatedEntities`,
that org-scopes them transitively (through `subHires`/`projectCategories`,
which do have it), mirroring the exact referenced-only join pattern
`convex/equipmentTab.ts`'s `readEquipmentTab` already uses for the live tab.
Additive and backward-compatible: an OLDER snapshot simply has none of these
four entity types, which every consumer below degrades from gracefully
(empty arrays, "groups then items" ordering, no sub-hire block) — never an
error, never a plausible-looking wrong number.

**`restoreProjectSnapshot` is UNCHANGED — deliberately.** Promoting an older
version still only restores the original six entity types onto the live
tables. This means: after this phase, VIEWING an old version shows its true
historical sub-hire orders and combined ordering, but PROMOTING that version
live does NOT bring historical sub-hire state back — the project's CURRENT
sub-hire orders/`categorySlots` stay exactly as they were before the promote.
This is a real, disclosed gap, not an oversight — restoring sub-hire orders
touches a second live-editable subsystem's data (`subHires`/`subHireItems`/
`subHireGroups` are edited independently of the project via the Sub-hires UI)
with its own conflict semantics `restoreProjectSnapshot`'s existing
`isWarehouseBacked`/conflict-surfacing model doesn't cover — a legitimate
follow-up, not scoped into this phase.

**The reuse split: data + ordering algorithm, not the interactive components.**
The live Equipment tab already separates "assemble a bundle of raw docs"
(`convex/equipmentTab.ts`'s `readEquipmentTab`) from "turn that bundle into
`CategoryData[]`/`GroupData[]`/etc., interleaved by `categorySlots`"
(`src/lib/equipment-tab-reconstruct.ts`'s `reconstructProjectCategories` and
friends — client-side, framework-free, ~130 lines of interleaving logic) from
"render it" (`equipment-rows.tsx`'s `GroupRow`/`SubHireGroupRow`/`LineItemRow`/
`CategoryRow`). The new Convex query, `convex/projectVersionsEquipment.ts`'s
`bundle`, mirrors ONLY the first step — given `{projectId, orgId, snapshotId}`
it loads the snapshot's captured entries, splits them into the same
doc-shaped arrays `readEquipmentTab` produces, and resolves referenced
`models`/`assets`/`bulkAssets`/`suppliers`/`kits`/`categories` from CURRENT
tables by id (the same referenced-only point-read pattern) — display names
for reference data, not "live availability" (if a model was renamed after
this version was captured, the version shows the new name, matching how the
live tab always shows current names — a disclosed trade-off, not full
denormalized historical capture). `units` (per-serial fulfillment,
`projectLineItemUnits`) is always `[]` here — which physical asset is
deployed/returned on a line is warehouse/fulfillment state, the identical
reasoning `restoreProjectSnapshot`'s `LINE_ITEM_WAREHOUSE_FIELDS` exclusion
already uses; `LineItemData.units` is optional, so this renders correctly
without it.

This query does NOT call `reconstructProjectCategories` itself — **the Convex
bundler cannot resolve `@/` path aliases** (the same constraint that already
forced `entryDataEqual`/`snapshotEntriesEqual` to exist as a pinned duplicate
in `convex/lib/projectSnapshots.ts` instead of importing
`src/lib/project-snapshot-diff.ts`), and `equipment-tab-reconstruct.ts`
imports `@/components/projects/equipment-rows`. Duplicating its interleaving
algorithm into `convex/` would violate R-3.1 the moment the two drift. So the
split stays exactly where the live tab already put it: the CLIENT
(`ProjectVersionContext`) fetches the new query's bundle and calls
`reconstructProjectCategories`/`reconstructUncategorizedLineItems`/
`reconstructUncategorizedSubHireGroups`/`reconstructUncategorizedProjectGroups`
— the SAME functions, unmodified — exactly as `use-native-equipment-tab.ts`
already does for the live bundle. Zero duplicated logic anywhere.

**`version-projected-equipment.tsx` is genuinely static markup, not
`GroupRow`/`LineItemRow` reused read-only.** Those components turned out NOT
to have a built-in read-only mode on closer inspection: `onDelete`/`onEdit`/
`onToggle`/`onAddEquipment`/`onAddKit`/`onMoveToCategory`/`onMoveToGroup`/
`onRemove` are required props (not optional), and `LineItemRow` unconditionally
calls `useCollaborationWrites()` and subscribes to
`api.collaboration.listThreadCommentCounts` keyed by the CURRENT item id —
showing a live comment count on a row from three versions ago would be
actively wrong, not merely unstyled. Rather than passing no-op callbacks (real
buttons that silently do nothing) or refactoring a 2500-line live-editing file
to grow a true read-only mode (exactly the audit the original Phase 3 scope
decision above rejected), the rebuilt component renders the SAME
`CategoryData`/`GroupData`/`SubHireGroupData`/`LineItemData` shapes and the
SAME `mixedGroups` order through independent, non-interactive markup — reusing
`@/components/ui/table` primitives and `formatCurrency` for visual/numeric
consistency, with zero editing affordances. Visually matches the live table's
columns, grouping and totals; is not literally the same React component
instances.

**Structural revision, same day:** the first cut above rendered each category
as its own bordered card with its own `<table>`, and groups/sub-hire groups
always expanded — functionally complete (sub-hires, custom items and
`categorySlots` ordering all showed) but visibly a different layout from the
live tab side-by-side, which is exactly what was reported back. The live
Equipment tab (`equipment-tab.tsx`) renders every category inside ONE
continuous `<table>` — category names are in-table header rows
(`CategoryRow`'s `bg-paper-2/50`/`t-overline text-muted` styling), not card
headings — and groups/sub-hire groups are collapsed by default
(`expandedGroups`, an empty `Set` on mount), expanding only on click.
`version-projected-equipment.tsx` was rewritten to match structurally, not
just visually: one `<table>` with the same `colgroup`/column widths wrapping
every category plus "Uncategorized", `CategoryHeaderRow` as an in-table row
using the identical classes, and a local `useExpanded()` hook (a plain
`useState<Set<string>>`, empty by default) gating group/sub-hire-group child
rows behind a chevron toggle — the read-only equivalent of the live tab's own
collapse state. Toggling it only touches local view state, never data, so
it's safe even though nothing else in this view is editable. The chevron
toggle is the one interactive element this view has; every other affordance
(edit, delete, drag, add) is still absent.

## Out of scope (later phases)

- Recall-to-edit (#1100, Phase 5) — editing a promoted SENT revision is still
  refused by the existing quote-derived lock until that phase lands.
- Promoting an older version does not restore its historical sub-hire orders
  or `categorySlots` ordering (Phase 6) — a real follow-up candidate, not filed
  as a phase yet.
- Org-level version reporting — not planned.

## Testing

- `convex/projectVersionsRead.test.ts` — `listVersions` correctness (state/date/
  total per revision), cross-org IDOR on `listVersions` AND on the two entry
  reads it's built beside (`snapshotEntries`/`currentEntries` — neither had a
  dedicated test file before this phase), and the projection-parity property.
- `src/lib/__tests__/project-version-projection.test.ts` — the pure mapper,
  including malformed-data degradation (never throws) and the uncaptured-facets list.
- `src/components/projects/__tests__/project-version-switcher.smoke.test.tsx` —
  the switcher actually OPENS (a Radix dropdown, keyboard-driven per the
  `saved-views-menu.smoke.test.tsx` precedent — a closed-trigger render proves
  nothing) and lists every version; the read-only bar announces via `role="status"`
  and its "no captured state" fallback.
- `src/components/projects/__tests__/version-projected-views.smoke.test.tsx` —
  each projected surface renders from a fixture, including the "not versioned" note.
- `convex/quotesWrites.test.ts` (Phase 4) — `deleteVersionNative`'s guard order
  (live → ever-sent → protected) and that it touches neither counter;
  `setQuoteLabelNative`; `sendNative` targeting `liveRevision` when it's
  behind the allocator (the promote-created-drift regression) and its
  `labelOnDocument` stamping rule.
- `convex/invoicesWrites.test.ts` (Phase 4) — `sourceRevision` stamped once at
  CREATE, surviving a void, and a CREDIT invoice getting its own stamp rather
  than copying the credited invoice's.
- `convex/backfillInvoiceSourceRevision.test.ts` — the best-effort backfill,
  mirroring `backfillProjectLiveRevision.test.ts`'s shape.
- `src/components/projects/finance/__tests__/promote-version-dialog.smoke.test.tsx` —
  opens the dialog, renders the predicted-conflict list, and confirms.
- `src/components/projects/finance/__tests__/promote-conflicts-panel.test.tsx` —
  the persistent post-promote panel.
- `src/components/projects/__tests__/project-version-switcher.smoke.test.tsx`
  (Phase 5) — the switcher renders on a never-quoted project (the synthetic
  entry), Add version fires `saveVersionNative`, and the row action icons
  (download/send/make-live/delete) appear only when their eligibility check
  passes.
- `convex/projectVersionsRead.test.ts` (Phase 5) — the zero-quote-rows
  synthetic entry, and that `pdfFileId` round-trips onto each version item.
- `convex/projectVersionsEquipment.test.ts` (Phase 6) — a full-fidelity
  capture (project group + sub-hire group/item + `categorySlots` ordering)
  round-trips through `bundle`, including the referenced-only supplier
  resolve; an older snapshot with none of the four new entity types degrades
  to empty arrays; cross-org IDOR on the snapshot row.
- `src/components/projects/__tests__/version-projected-views.smoke.test.tsx`
  (Phase 6) — an integration-style test (not a plugin-layer unit test, per
  CLAUDE.md's PDF-pipeline testing rule applied here too) that runs a real
  bundle fixture through the ACTUAL `reconstructProjectCategories` and
  renders it: asserts the category header, group and sub-hire group titles
  appear in `categorySlots` order (project group → sub-hire group →
  standalone item — proving real interleaving, not "groups first"), that
  group/sub-hire-group child rows are absent until their chevron toggle is
  clicked (the one interactive element this view has, matching the live
  tab's own collapsed-by-default state), and that the old "not captured"
  caveat banner is gone.
