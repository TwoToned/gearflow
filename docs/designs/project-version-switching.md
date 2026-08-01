# Project version switching — versions you can jump between and make live

> _Owner: Jayden Nawotka · Created: 2026-08-01_

**Driver:** Jayden — _"I want to expand the versions thing. Currently it is useless."_ The ask:
every version of a project carries its quote (and its invoices), only one version is live at a
time, you can jump between versions and the whole UI shows that version's captured data, and
making changes while on an older version promotes it to live and overwrites the live data with
it.

**Extends:** [`finance-first-class-version-control.md`](./finance-first-class-version-control.md)
(#985, phases A–F) and [`quote-version-management-extensions.md`](./quote-version-management-extensions.md)
(#1028–#1032). Those built the revision model, the five quote verbs, immutable artifacts and the
quote-derived lock. This doc turns the revision from a *quoting* artifact into a *project*
version you can navigate and restore.

**Owning docs to update:** [FEATUREDOCS/66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md),
[FEATUREDOCS/62](../../FEATUREDOCS/62-project-lifecycle-locks.md),
[FEATUREDOCS/10](../../FEATUREDOCS/10-projects.md), and a new FEATUREDOCS entry for the
version switcher.

---

## 1. What's actually in the repo today

Verified against the codebase on 2026-08-01.

### 1.1 There are still two version mechanisms, and the user-facing one is the wrong one

| Mechanism | What it is | Why it's "useless" |
|---|---|---|
| `ProjectVersionsPanel` (`src/components/projects/project-versions-panel.tsx`, 95 lines, mounted at `src/app/(app)/projects/[id]/page.tsx:952`) | A ⋯-menu dialog listing `projectSnapshots` rows with `reason` of `CONFIRMED`/`COMPLETED`/`UNLOCK` | Not user-driven (captures fire on lifecycle transitions), unnumbered, unnamed, and offers **no action at all** — it lists snapshots and diffs them. You cannot open one, cannot restore one, cannot quote from one. |
| The quote revision model (#986) | `projects.revision` (`convex/schema.ts:1225`) as one shared counter; one `quotes` row per revision; one `projectSnapshots` row per revision with `reason: "QUOTE_SENT"` | This is the real one — but it is presented entirely as a finance artifact inside the Finance tab. Nothing projects a revision onto the project UI. |

### 1.2 The restore primitive already exists and is unused for this

`restoreProjectSnapshot` (`convex/lib/projectSnapshots.ts:205`) already patches, recreates and
deletes project entities to reconcile them against a snapshot, and already refuses to touch
warehouse-backed rows (`isWarehouseBacked`, L177), surfacing them as `conflicts` instead. It is
currently reachable **only** from unlock-session discard.

So "make this version live" is not new machinery — it is a third caller of a tested function,
with a wider scope.

### 1.3 Restore-in-place was deliberately refused, and this doc reverses that

`RepriceFromRevisionDialog` (`src/components/projects/finance/reprice-from-revision-dialog.tsx:35-37`)
states the prior reasoning outright: it is _"the forward-only equivalent of 'Restore' every
version-history pattern studied offers and this program deliberately doesn't (rewriting a SENT
quote in place would falsify the record of what a client was given)."_

**This doc reverses that**, knowingly and with Jayden's explicit decisions (§2). Recording the
reversal rather than silently diverging (R-14.4). The safeguards that make it survivable are
§2.5 (auto-capture before overwrite), §2.7 (a sent revision cannot be edited without an audited
recall that unlinks its PDF) and §2.6 (promote is blocked outright while an invoice is issued).

### 1.4 Snapshots only exist at send

`sendNative` captures (`convex/quotesWrites.ts:310`). `newVersionNative` (L472) does **not** — it
increments the counter and inserts a DRAFT row, nothing more. So today an unsent revision has no
snapshot, which means there is nothing to project onto the UI and nothing to promote. Version
creation has to grow a capture step (§3.3).

---

## 2. Locked decisions (Jayden, 2026-08-01)

1. **A version keeps its own number when promoted.** `projects.liveRevision` is a pointer,
   separate from `projects.revision` (which becomes purely the allocator). Promoting v2 makes
   **v2** live and Latest even though v4 exists. No copy-forward, no `v5 — from v2`.
2. **The live state is auto-captured before it is overwritten.** Promote never destroys
   un-versioned work; the state being replaced is snapshotted first (§3.4).
3. **Invoices are lineage-labelled, not per-version ledgers.** One project-level invoice ledger
   as today; each invoice records `sourceRevision`, the version it was issued from, and appears
   on that version's row.
4. **Warehouse-backed gear is surfaced as a conflict, never forced.** Reuses
   `isWarehouseBacked`'s existing behaviour. Prices, quantities and non-warehouse structure
   restore cleanly; anything with an `assetId`/`bulkAssetId`/`kitId` that would have to be
   created or deleted is listed for a human.
5. **Editing a promoted SENT revision recalls it.** Its stored PDF is unlinked into
   `priorPdfFileIds` exactly as `recallNative` (`convex/quotesWrites.ts:388`) already does, the
   revision returns to `DRAFT`, and re-sending renders a fresh document. Refined in §2.7 — this
   takes one confirmation rather than firing implicitly, for reasons that are structural, not
   cosmetic.
6. **The whole project shows the version.** Equipment, Labour & logistics and Finance all render
   from the snapshot behind a persistent read-only bar. Not a Finance-tab-only feature.
7. **Versions are created three ways:** an explicit **Save version** button, on quote send (as
   today), and the auto-capture before a promote. **Lifecycle transitions are removed** from the
   version list.
8. **Promote is admin/owner/PM (`isHardLockOverrideAllowed`) and is blocked by the lifecycle
   lock** — a locked project needs an open unlock session, so promote goes through the existing
   audited flow rather than around it.
9. **Promote restores everything in the snapshot, dates included** — the rental window, client,
   venue and delivery details roll back with the gear and the prices. See §5.2 for the
   consequence this carries and how it is handled.
10. **Promote is blocked while a non-VOID issued invoice exists.** You must VOID or credit the
    invoice first. Version switching stays read-only in the meantime.
11. **An ACCEPTED (auto-protected) version is viewable and promotable, but editing it requires an
    owner to un-protect first.** The existing `quotes.protected` gate does this already.
12. **The old ⋯ Versions panel is retired; its captures are kept.** `CONFIRMED`/`COMPLETED`/
    `UNLOCK` snapshots keep being taken — `UNLOCK` is load-bearing for unlock-session discard and
    cannot be removed — but they stop being user-facing. One version concept, one UI.

### 2.7 Refinement to decision 5 — recall takes one confirmation, not zero

A bare "auto-recall on first edit" cannot be implemented as stated, because it contradicts
machinery that already exists: a `SENT` quote raises the project to **FINANCE_LOCKED**
(`resolveLockTier`, #988), so a price edit on a promoted sent revision is *already* refused
before any auto-recall could fire. The sanctioned exit today is "Create quote vN+1", which is
precisely what decision 1 says not to do.

So the lock learns a second exit. When the live revision is `SENT`/`ACCEPTED`, the lock strip's
primary unlock affordance becomes **"Recall v2 to edit"** alongside the existing "Create v3", and
attempting a gated edit surfaces it as a one-click confirm:

> **v2 was sent to the client on 19 Jul.** Editing it recalls the quote — the PDF they're holding
> will no longer match v2. The old document is kept in the audit trail.
> `[ Recall v2 and edit ]`  `[ Create v3 instead ]`  `[ Cancel ]`

This is decision 5's behaviour with one confirmation in front of it. Un-sending a document a
client already has is not something to do as a side effect of a keystroke, and every other
un-send path in this system (`recallNative`) already requires an explicit act with a reason. It
also gives decision 11 its natural home: on a protected/ACCEPTED revision this same dialog
reports that an owner must un-protect first, rather than a raw `QUOTE_PROTECTED` error.

---

## 3. Model

### 3.1 Two numbers, one meaning each

```
projects.revision      : number   ← the ALLOCATOR. Highest version number ever handed out.
                                    Monotonic (except the existing never-sent-draft rollback,
                                    convex/quotesWrites.ts:618). Never a statement about what's live.
projects.liveRevision  : number   ← NEW. The version currently projected onto the live tables.
                                    Absent ⇒ equals `revision` (every pre-existing project).
```

Today `projects.revision` does both jobs, which is exactly why "make an older version live" has
nowhere to go. Splitting them is the whole feature.

Both are **server-owned** — written only by the version mutations, and stripped from generic
client patches the same way `PROJECT_MONEY_ANCHORS` and `revision` already are
(`convex/projectWrites.ts`).

**Viewing is not stored.** Which version you're *looking at* is a per-user URL param (`?v=2`),
never a database field. Two people can view different versions of the same project at once, and
neither affects the other or the live data.

### 3.2 What a version is

One version number = one `quotes` row + at most one `projectSnapshots` row.

| | Live revision | Non-live revision |
|---|---|---|
| Where its data lives | The live tables (`projectLineItems`, `projectGroups`, …) | Its `projectSnapshots` + `projectSnapshotEntries` rows |
| Snapshot required? | No — it *is* the live state | **Yes.** A revision with no snapshot cannot be viewed or promoted |
| Editable? | Yes, subject to the lifecycle lock | No — read-only projection |

**Invariant change.** Today: _"at most one `DRAFT` quote per project, and it is always at
`projects.revision`."_ Now: _"at most one **live** `DRAFT` quote, and it is always at
`projects.liveRevision`."_ A non-live revision may legitimately sit in `DRAFT` — it is either a
saved-but-never-sent version or a recalled one. The UI distinguishes them by whether `sentAt` was
ever set, exactly as `deleteDraftNative`/`deleteRecalledNative` already do.

### 3.3 Save version — the new creation path

`projectVersionsWrites.saveVersionNative`:

1. Capture the live state as a snapshot attached to the **current live revision** (`reason:
   "VERSION_SAVED"`, carrying `revision`). If that revision already has a snapshot — it was sent
   — see §3.4's rule instead.
2. Allocate `next = projects.revision + 1`; set `revision = next` **and** `liveRevision = next`.
3. Insert a `DRAFT` quote at `next` with `snapshot: null` (a draft carries no money snapshot —
   its figures are the project's live totals until it is sent; unchanged from `newVersionNative`).
4. **The live tables are not touched.** Saving a version freezes a copy of where you are and
   carries on; it is not a checkpoint you have to restore from to keep working.

Optional `label: string` (≤ 60 chars) on the version — "with LED wall", "client's budget option".
Purely descriptive; it never affects behaviour or numbering.

`newVersionNative` (the post-send path) gains the same step 1 capture. Its existing
`QUOTE_DRAFT_OPEN` guard stays: after a send, "new version" is still the sanctioned unlock.

### 3.4 Promote — `projectVersionsWrites.promoteRevisionNative`

Preconditions, checked in this order so the first rejection is the real blocker (R-3.6, the
`assertRecalledDeletable` precedent):

| # | Check | Error code |
|---|---|---|
| 1 | Not a template | `TEMPLATE_NO_VERSIONS` |
| 2 | Target ≠ `liveRevision`, and the target revision has a snapshot | `VERSION_NOT_RESTORABLE` |
| 3 | Caller passes `isHardLockOverrideAllowed` (org admin/owner, or one of the project's PMs) | `FORBIDDEN` |
| 4 | `assertLifecycleGuard(ctx, project, { kind: "structural" })` — a locked project needs an open `FULL`-scope unlock session | `PROJECT_LOCKED` |
| 5 | **No non-VOID `ISSUED` invoice on the project** (decision 10) | `PROMOTE_BLOCKED_INVOICED` |

Then, in one transaction:

1. **Auto-capture** (decision 2):
   - If the live revision has **no** snapshot → capture the live state onto it. No new version
     number is allocated. This is the common case (you're on a working draft) and it produces no
     list noise.
   - If it **has** one (it was sent, and live may have drifted since) → its snapshot is frozen
     evidence of what was sent and must not be overwritten. Allocate `M = revision + 1`, capture
     the live state there with `reason: "PRE_PROMOTE"` and a `DRAFT` quote labelled
     _"Auto-saved before switching to v2"_.
   - Skipped only when the live revision already has a snapshot and `diffSnapshotEntries` finds
     the live state identical to it — there is nothing to preserve, and allocating a number for a
     byte-identical copy is dead-row noise. Flagged in §8 as the one place this deviates from a
     literal reading of "always capture first".
2. `restoreProjectSnapshot(ctx, { scope: "PROMOTE", snapshotId: target.snapshotId })` (§3.5).
3. `projects.liveRevision = K` (`revision` is untouched — it stays the high-water mark).
4. Recalculate project totals through the existing recalc path, and re-derive availability
   bookings if the rental window moved (§5.2).
5. `writeActivityLog` — `PROJECT_VERSION_PROMOTED`, recording the from/to revisions, the
   auto-capture destination, and every conflict returned.

Returns `{ conflicts: string[], autoSavedRevision?: number }`. Conflicts render in a persistent
post-promote panel, not a toast — they are a work list, and a toast that scrolls away is how
warehouse desync happens quietly.

### 3.5 `scope: "PROMOTE"` — a third restore scope

`restoreProjectSnapshot` today has `FINANCIAL` (money fields only) and `FULL` (structure too, but
project-level fields limited to `LOCKED_PROJECT_FIELDS` — just `taxRate` and `discountPercent`,
`convex/lib/projectLocks.ts:164`). Decision 9 needs more than `FULL` offers.

`PROMOTE` = `FULL`, plus the project row restores **every captured field except**:

| Excluded | Why |
|---|---|
| `id`, `organizationId`, `projectNumber`, `isTemplate`, `createdAt` | Identity. Never version-scoped. |
| `revision`, `liveRevision` | The counters themselves — restoring them would undo the promote. |
| `status` | Lifecycle position is where the job actually *is*, not what a version said. A COMPLETED job does not become an ENQUIRY because you promoted v1. |
| `invoicedTotal`, `depositPaid` | Reflect real issued invoices and real money received. Never rolled back. |
| `subtotal`, `total`, `taxAmount`, `margin`, `equipmentRevenue`, `saleRevenue`, `*CostTotal` | Derived. Recalc owns them (R-3.1); restoring then recalculating is two writers for one value. |

Everything else restores: `rentalStartDate`/`rentalEndDate`, `loadIn*`/`loadOut*`/`event*`,
`clientId`, `clientContactId`, `locationId`, `siteContact*`, `type`, `name`, `description`,
`projectManagerId`, `taxRate`, `discountPercent`/`discountAmount`, `billing*Override`,
`depositPercent`, `crewNotes`/`internalNotes`/`clientNotes`, `tags`.

Line items, groups, categories and services follow `FULL`'s existing rules unchanged, including
`LINE_ITEM_WAREHOUSE_FIELDS` (status, checked-out/returned quantities, prep state) never being
rewritten — physical reality is not versioned. Crew keeps `FULL`'s behaviour: rates and hours
restore, workflow status (`offeredAt`, `confirmedAt`, responses) never does, and crew added or
removed since the snapshot is surfaced as a conflict rather than silently reassigned.

### 3.6 Invoice lineage (decision 3)

```ts
// invoices
sourceRevision: v.optional(v.number()),   // the projects.liveRevision at CREATE time
```

Stamped once at creation, never updated — an invoice belongs to the version that produced its
figures. The Finance tab's invoice ledger stays project-level and unchanged; each version row
additionally lists the invoices whose `sourceRevision` matches, and versions with none read
_"no invoices issued from this version"_.

No index needed — invoices are already loaded per project by `by_organizationId_projectId` and
filtered in memory; the volume is a handful of rows per project.

---

## 4. UI

### 4.1 The switcher lives in the project header, not a tab

Decision 6 makes this project-wide, so a tab-scoped control would be wrong. The header, next to
the project number and status chip:

```
RVLT-2026-0087 · Warehouse Live 2026        [ CONFIRMED ]  [ 🔒 ]  [ v4 · Live ▾ ]
                                                                    ├─ v5  Auto-saved 1 Aug
                                                                    ├─ v4  Live · Sent 26 Jul
                                                                    ├─ v3  Saved 22 Jul
                                                                    ├─ v2  Sent 19 Jul  · Accepted
                                                                    ├─ v1  Sent 12 Jul
                                                                    └─ ─────────────
                                                                       Save version…
```

### 4.2 Viewing a non-live version

A full-width bar above the tabs, always mounted while `?v=` is set and ≠ `liveRevision`:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🕒 Viewing v2 · sent 19 Jul · accepted 21 Jul · read-only                  │
│    [ Back to live (v4) ]                              [ Make v2 live… ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

Every interactive control on every tab renders `aria-disabled` (**not** `disabled` — that kills
the tooltip) inside a `TooltipProvider`, reusing #990's action-level lock pattern verbatim. There
is no global `TooltipProvider`; each consumer wraps its own (CLAUDE.md).

**Tabs that cannot project.** Tasks, Notes and Files are not in the snapshot and never have been.
They stay live and say so — a small inline note, _"Tasks aren't versioned — showing current"_ —
rather than rendering blank or, worse, rendering live data with no indication that it isn't v2's.

### 4.3 The promote dialog

Radix `Dialog` (no `AlertDialog`, per CLAUDE.md). It states what changes before it runs, because
decision 9 makes this a wide-reaching write:

```
Make v2 live?

  Rolled back to v2
    • 14 line items, 3 groups, 2 services
    • all prices, discounts and tax
    • Rental window → 2–5 Aug  (currently 4–7 Aug)
    • Client contact, venue, delivery address

  Kept as-is
    • Project status (CONFIRMED), warehouse state, tasks, notes, files
    • Anything already invoiced

  ⚠ Needs your review after
    • 2 × MA3 Light — checked out, won't be removed automatically

  Your current state will be saved as v5 first.

                                        [ Cancel ]  [ Make v2 live ]
```

The diff is computed client-side from the two entry sets via the existing
`diffSnapshotEntries` (`src/lib/project-snapshot-diff.ts`) and
`api.projectLocksRead.currentEntries` — the same pair `RepriceFromRevisionDialog` already uses.
No new read path.

### 4.4 Retiring the old panel (decision 12)

Delete `src/components/projects/project-versions-panel.tsx`, its mount at
`src/app/(app)/projects/[id]/page.tsx:952`, the ⋯ menu entry, and the `ProjectVersionsPanel`
block in `src/components/projects/__tests__/lifecycle-lock.smoke.test.tsx:109`.
`captureProjectSnapshot` keeps firing for `CONFIRMED`/`COMPLETED`/`UNLOCK`; those rows are simply
filtered out of the version list, which shows only revisions (`QUOTE_SENT`, `VERSION_SAVED`,
`PRE_PROMOTE`).

---

## 5. The two things most likely to bite

### 5.1 Projecting a snapshot onto tabs built for live queries

This is the largest single risk in the build, and it is not the mutations — it is that Equipment
and Labour & logistics read through a dozen Convex queries that all assume "current".

**The rule: one mapper, two sources.** A `ProjectVersionContext` provider sits above the tabs.
Each tab's existing data hook reads from context when a version is being viewed and from Convex
otherwise. The snapshot path maps `SnapshotEntryLike[]` into the **same DTO shapes** the live
queries return, through the same mappers — never a parallel hand-written shape (R-3.1, and the
same reasoning that keeps `collectCurrentEntries` byte-compatible with `captureProjectSnapshot`
today).

Anything the mapper cannot produce (availability counts, live warehouse status, realtime presence)
renders as "not captured in this version" rather than as a plausible-looking zero. A wrong number
that looks right is worse than an absent one.

### 5.2 Rolling the rental window back (decision 9)

Restoring dates is the one part of `PROMOTE` that reaches outside the project. `rentalStartDate`/
`rentalEndDate` feed the double-booking overlap check (`convex/projectWrites.ts:540-545`), so a
promote that moves them silently changes what this project is holding and can create or clear
overbookings on *other* jobs.

Requirements, non-negotiable:

- Promote re-derives availability for the project after restoring, in the same transaction.
- The promote dialog shows the date change explicitly (§4.3) — it is the single most surprising
  thing this action does.
- The post-promote conflict panel includes any overbooking the date move created, using the
  existing overbooking derivation (`convex/lib/overbookingBoard.ts`) rather than a new check.
- Duration-derived pricing (`billingWeeksOverride`/`billingDaysOverride`, rental period maths) is
  restored from the snapshot rather than recomputed — v2's prices were agreed over v2's window,
  so recomputing them against the restored window is both redundant and a chance to disagree.

---

## 6. Data model changes

```ts
// projects
liveRevision: v.optional(v.number()),      // NEW. absent ⇒ revision. Server-owned.

// quotes
label: v.optional(v.string()),             // NEW. optional human name for the version, ≤60 chars
snapshotId: v.optional(v.string()),        // EXISTS — now written by saveVersion/newVersion too,
                                           //   not only by sendNative

// invoices
sourceRevision: v.optional(v.number()),    // NEW. the liveRevision at create time

// projectSnapshots
reason: … | v.literal("VERSION_SAVED") | v.literal("PRE_PROMOTE"),   // NEW arms
```

No new indexes. `quotes.by_projectId_version` remains the uniqueness guard; the version list is
already loaded per project by `listProjectQuotes`.

**Backfill** (`convex/backfill*.ts`, established pattern):

1. `projects.liveRevision` ← `projects.revision` for every non-template project. Read-time
   coalescing (`liveRevision ?? revision ?? 1`) means this is belt-and-braces, not a
   correctness dependency.
2. `invoices.sourceRevision` ← the project's `revision` at the time — best-effort. An invoice
   with no `sourceRevision` renders under the project ledger with no version chip, which is
   accurate: we genuinely don't know which version produced it.
3. **No retro-snapshotting.** A revision with no snapshot stays un-viewable and un-promotable,
   badged _"no captured state (pre-versioning)"_. Manufacturing a snapshot from today's live data
   and labelling it "v1" would fabricate a version that never existed — the same defect
   `finance-first-class-version-control.md` §8.5 refuses for artifacts.

Every new field is `v.optional` on arrival; nothing is removed from a validator while live
documents may carry it (the `depositPercent` prod incident, FEATUREDOCS/66). `convex/schema.ts`
is hand-maintained — never regenerate (CLAUDE.md).

---

## 7. Rollout

| # | Phase | Scope | Depends on |
|---|---|---|---|
| 1 | **Model** | `liveRevision`, `label`, new snapshot reasons, `saveVersionNative`, capture-on-`newVersionNative`, the invariant change, backfill, server tests | — |
| 2 | **Promote** | `scope: "PROMOTE"`, `promoteRevisionNative`, auto-capture rule, invoice block, permission + lock gates, conflict return, availability re-derive | 1 |
| 3 | **Projection** | `ProjectVersionContext`, snapshot→DTO mappers, `?v=` routing, header switcher, read-only bar, `aria-disabled` sweep across tabs | 1 |
| 4 | **Version list + lineage** | The version list as the Finance tab's primary rail, `invoices.sourceRevision` display, promote dialog, conflict panel, retire `ProjectVersionsPanel` | 2, 3 |
| 5 | **Recall-to-edit** | §2.7's lock-strip affordance and confirm dialog, protected/ACCEPTED path | 2 |

Phases 1–2 are shippable without any UI (the version list keeps working as it does today).
Phase 3 is the big one and is independently reviewable.

---

## 8. Test plan

- **Server (`convex-test`)** — `revision` stays monotonic across promote; `liveRevision` points
  only at revisions that exist and have a snapshot; the one-live-DRAFT invariant across
  save/send/promote/recall sequences; promote rejects on each of the five preconditions
  individually; the auto-capture rule in all three branches (no snapshot / has snapshot with
  drift / has snapshot without drift); `PROMOTE` restores exactly the field set in §3.5 and no
  more — asserted field by field, since an accidental `status` or `invoicedTotal` restore is the
  kind of bug that only shows up in production accounting.
- **Cross-tenant (R-8.4.3)** — every new mutation and the projection query IDOR-tested. `by_cuid`
  and `by_projectId` are global Convex indexes; the projection query is the highest-risk new read
  surface in this program because it returns a whole project's entity set by snapshot id.
- **Warehouse conflicts** — a promote whose target adds and removes asset-backed lines returns
  both conflicts and mutates neither.
- **Dates** — a promote that moves the rental window re-derives availability and reports the
  overbookings it created; duration-derived prices come from the snapshot, not from recompute.
- **jsdom smoke** — the switcher opens (it's a Radix dropdown — test by *opening* it, not by
  rendering the closed trigger); the read-only bar renders and every tab's primary action is
  `aria-disabled` with a tooltip that explains why; the promote dialog renders its diff.
- **Projection parity** — the property that matters most: for a snapshot captured from a known
  fixture, the projected DTOs equal the live DTOs the same fixture produces. This is the test
  that stops the two read paths drifting.
- **a11y** — the viewing-a-version state is announced, not colour-only (DESIGN.md).

---

## 9. Open questions

- **The dead-row skip (§3.4).** Skipping the auto-capture when live is byte-identical to the live
  revision's existing snapshot is a deviation from a literal "always capture first". It preserves
  nothing because there is nothing to preserve — but confirm you want it, or every promote from a
  sent-and-untouched revision allocates a number for an exact duplicate.
- **Does `deleteDraftNative`'s revision rollback need to move `liveRevision` too?** It rolls
  `projects.revision` back to the highest ever-sent revision (`convex/quotesWrites.ts:618`).
  Proposed: it may only delete the **live** draft, and rolls `liveRevision` with it — deleting a
  non-live saved version is a separate, later action with its own confirm.
- **Can a saved-but-never-sent version be deleted?** Proposed yes, with the ordinary draft-delete
  bar (never sent = nobody outside the company saw it). Its snapshot rows go with it.
- **Version labels on the PDF?** Proposed no. The quote header stays `RVLT-2026-0087 v2`; a label
  like "budget option" is an internal note and putting it on a client document invites questions
  about which other options exist.
- **Duplicated projects and templates.** Assumed: a duplicate starts at `revision: 1`,
  `liveRevision: 1`, with a fresh `DRAFT` v1 and no version history; a template carries no
  revisions at all (`newVersionNative` already throws `TEMPLATE_QUOTE`). Say so if that's wrong.
- **Multiple concurrently-editable versions** (comparing "with and without the LED wall" side by
  side) stays out of scope, as in both parent docs. One live equipment list, one counter. Save
  version + promote gets close enough to the workflow that it may be worth revisiting whether the
  variant feature is still wanted at all.

---

## 10. POLICY.md compliance notes (BUILD mode)

- **R-3.1 / single source of truth** — two numbers with one meaning each (`revision` allocates,
  `liveRevision` points); one restore function with three scopes rather than a second restore
  path; one set of DTO mappers serving both the live and snapshot read paths; derived money stays
  owned by recalc and is excluded from restore.
- **R-9.3 / server authority** — `liveRevision` and `revision` are server-owned and stripped from
  client patches; promote accepts only a target revision number; no monetary amount originates in
  the client.
- **R-8.4.3 / cross-tenant reads** — every snapshot, quote and invoice read re-checks
  `organizationId`; the projection query is IDOR-tested explicitly.
- **R-8.2.3 / R-8.6.2** — the save-version and promote forms get Zod schemas in
  `src/lib/validations/`, derived with `.omit()`/`.extend()` from one base.
- **Browser-direct write bar (FEATUREDOCS/54)** — every `*Native` mutation mirrors its Zod bounds
  server-side via `convex/lib/fieldGuards.ts` (the version `label` length in particular).
- **`agentOps` annotations** — `promoteRevisionNative` is `danger: "high"` (irreversible in
  effect, rewrites live project state), so the API dispatcher requires `confirm: true`.
  `saveVersionNative` is `danger: "low"`.
- **R-14.4** — §1.3 records the reversal of the earlier no-restore decision rather than
  silently diverging from it.
- **R-5.2 / R-5.3 / R-5.8** — FEATUREDOCS 66, 62, 10, the new version-switcher doc and this file
  update in the same PRs as the behaviour.
