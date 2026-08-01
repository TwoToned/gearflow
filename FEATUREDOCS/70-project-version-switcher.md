# Project Version Switcher (Phase 3 projection)

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

Phase 3 of #1080 (issue #1093) — the read path that lets a project's Equipment,
Labour & logistics and Finance tabs render a **past version's** captured state
behind a read-only bar, switched via a header dropdown and a `?v=` URL param.

**Depends on:** Phase 1 (#1085, merged) — `projects.liveRevision`, `saveVersionNative`,
the `VERSION_SAVED`/`PRE_PROMOTE` snapshot reasons.
**Does NOT depend on / does not include:** Phase 2's `promoteRevisionNative` (#1089,
not yet shipped) — there is no "Make vN live" action anywhere in this phase. The
switcher and read-only bar are look-only.

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

## Out of scope (later phases)

- The promote action / "Make vN live" (#1089, Phase 2) and its dialog (#1097, Phase 4).
- The version list becoming the Finance tab's primary rail, deletion, labels,
  retiring the old `⋯ Versions` panel (#1097, Phase 4).
- Recall-to-edit (#1100, Phase 5).

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
