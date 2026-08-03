# Project Version Switcher (Phase 3 projection + Phase 4 promote/list + Phase 5 header actions)

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-03 (review quarterly — POLICY.md R-5.5)_

Phase 3 of #1080 (issue #1093) — the read path that lets a project's Equipment,
Labour & logistics and Finance tabs render a **past version's** captured state
behind a read-only bar, switched via a header dropdown and a `?v=` URL param.
Phase 4 (issue #1097) landed on top of it: "Make vN live" is now a real,
user-facing action — the promote dialog wired into both the read-only bar and
the Finance tab's version rail — and the version rail itself (`ProjectQuoteRail`)
is now the project's ONE version list, with the old `⋯ Versions` panel retired.
Phase 5 ("fine-tune versioning") turned the header switcher itself into a full
version menu — see §"Phase 5" below.

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

Sub-hire lines, category-slot ordering, live availability and live warehouse
status are never in `SnapshotEntityType` (`convex/lib/projectSnapshots.ts`) — no
snapshot has ever captured them, at any point in this program, not a bug in this
phase. The equipment projection renders an explicit caveat rather than silently
omitting them or showing a plausible-looking (and wrong) number (design doc §5.1).
Real money already invoiced/received (`invoicedTotal`/`depositPaid`) is deliberately
passed as `null` into the projected Finance view for the same reason — it's not
versioned (design doc decision 3, invoices are lineage-labelled on ONE
project-level ledger, never rolled back).

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

**Follow-up candidate, not filed as a phase:** if product feedback wants viewing an
old version to keep the exact live layout (familiar scroll position, same table
chrome) rather than a simplified read-only render, revisit the live-components-with-
aria-disabled approach then — the mapper output (`ProjectedView`) is already the
right shape to feed either rendering.

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

## Out of scope (later phases)

- Recall-to-edit (#1100, Phase 5) — editing a promoted SENT revision is still
  refused by the existing quote-derived lock until that phase lands.
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
