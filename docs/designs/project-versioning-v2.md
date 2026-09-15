# Project versioning v2 — versions as switchable workspaces

> _Owner: Jayden Nawotka · Created: 2026-09-15 · Status: **DRAFT — awaiting answers to §9**_

**Driver:** Jayden — _"The version control stuff we have implemented feels very half baked and
messy. The original goal was to be able to have complete snapshots of projects, with one being
live at any one time. The snapshots, even if not live, should look and feel in the UX as if they
are. The not-live bit is purely to fit into our data structure. Managing snapshots/versions, and
changing between them etc is super hard and messy. Let's do a full refactor of versioning, as well
as the locking mechanism and how versions relate to quotes/invoices."_

**Supersedes (once accepted):**
[`finance-first-class-version-control.md`](./finance-first-class-version-control.md) §3–§5 (the
revision model and quote-derived lock),
[`quote-version-management-extensions.md`](./quote-version-management-extensions.md),
[`project-version-switching.md`](./project-version-switching.md), and the versioning halves of
[FEATUREDOCS/62](../../FEATUREDOCS/62-project-lifecycle-locks.md),
[FEATUREDOCS/66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md) and
[FEATUREDOCS/70](../../FEATUREDOCS/70-project-version-switcher.md). Immutable finance
artifacts (#987) and the Finance tab's send/issue dialogs (#989) are **kept** unchanged.

**Mockups:** the proposed UX is drawn as a design canvas — **https://claude.ai/artifact/EgwLTWJLKyyTeymqhjtNes** — seven
artboards: header + version menu, the one strip (five states), the Equipment tab on a non-live
version, the Finance tab, the Versions panel, the Make-live dialog, and Compare.

---

## 0. In one paragraph

Today a "version" is not a thing — it is a `quotes` row, plus (sometimes) a `projectSnapshots`
row of frozen entry blobs, plus two counters on the project. Non-live versions are rendered by a
**separate read-only reconstruction** of each tab, and "make live" is a **restore-with-conflicts**
that overwrites the live tables after auto-saving a copy. The proposal is to make a version a
real, first-class row set: every versioned entity (line items, groups, categories, services…)
carries a `versionId`; the project holds a `liveVersionId` pointer; **every tab renders any
version through the same components and the same mutations**, so a non-live version is a fully
editable workspace, not a relic. "Make live" becomes a pointer flip plus warehouse
reconciliation — nothing is overwritten, so nothing needs auto-saving. Quotes become immutable
**documents issued from a version** (any version, not only the live one), invoices are issued
from the live version and record which one. Locking collapses to one explicit matrix: a version
is **open** or **frozen** (a quote went out), and the **live** version additionally carries the
project's lifecycle lock. Unlock sessions, their private snapshots, `PRE_PROMOTE` auto-saves,
the `protected` flag, three overlapping "create a version" mutations and ~1,000 lines of
projected read-only UI all go away.

---

## 1. What is in the repo today (verified 2026-09-15)

### 1.1 Four programs, one accretion

| Program | Issue(s) | What it added | What it left behind |
|---|---|---|---|
| Lifecycle locks + snapshots | #957 (#791/#792/#793), 2026-07 | `projectSnapshots`/`projectSnapshotEntries` captured at CONFIRMED/COMPLETED/UNLOCK; unlock sessions; `assertLifecycleGuard` tier table | A snapshot store designed for *audit and discard*, not for versions |
| Quote revisions + Finance tab + lock UX | #985 (#986–#990, #992), 2026-07 | `projects.revision`, one `quotes` row per revision, the five verbs, quote-derived lock input, immutable PDFs, lock strip/chip/LockedField | The `quotes` row became the identity of a version |
| Delete / protect / correct | #1026 (#1027–#1032), 2026-07 | `deleteDraftNative`, `deleteRecalledNative`, `protected`, `correctQuoteNative`, recall clears `pdfFileId` | Five more mutations on the same row, two permission bars |
| Version switching | #1080 (#1085, #1089, #1093, #1097, #1100, #1101), 2026-08 | `projects.liveRevision`, `saveVersionNative`, `promoteRevisionNative` (`scope: "PROMOTE"`), `?v=` projection, header switcher, projected read-only tabs, recall-to-edit | A viewing path that is a second render of every tab, and a promote that is a restore |

Each program was locally reasonable. Together they produce the mess the driver describes.

### 1.2 The model as it stands

```
projects.revision      ← allocator (highest number handed out)
projects.liveRevision  ← pointer (absent ⇒ revision)
quotes (one row per revision)  ← the version's IDENTITY + its quote document + label + protect + …
  └ quotes.snapshotId → projectSnapshots (reason: QUOTE_SENT | VERSION_SAVED | PRE_PROMOTE)
                          └ projectSnapshotEntries (10 entity types, data: v.any())
projectSnapshots (reason: CONFIRMED | COMPLETED | UNLOCK)  ← a DIFFERENT use of the same tables
projectUnlockSessions → its own UNLOCK snapshot, restored on discard
live tables (projectLineItems, projectGroups, …)  ← the live version, un-tagged
```

Viewing v2 = `?v=2` → `projectLocksRead.snapshotEntries` + `projectVersionsEquipment.bundle` →
`src/lib/project-version-projection.ts` → `version-projected-{equipment,labour,finance}.tsx`.
Making v2 live = `promoteRevisionNative` → auto-capture live (`PRE_PROMOTE`) →
`restoreProjectSnapshot({scope:"PROMOTE"})` → patch/insert/delete live rows → conflicts.

---

## 2. The issues, with sources

Grouped by root cause. **I-n** numbers are referenced from §4 and §7.

### 2.1 Model — the version has no identity of its own

| # | Issue | Evidence | Consequence |
|---|---|---|---|
| **I-1** | **A version *is* a quote row.** Version label, protect flag, snapshot pointer, "is this sent", and the client document all live on `quotes` (`convex/schema.ts:2490-2570`). A never-sent saved version is stored as a `DRAFT` quote. | `FEATUREDOCS/66` "One counter, three tables"; `project-version-switching.md` §3.2 "One version number = one `quotes` row + at most one `projectSnapshots` row" | Every version operation is a quote operation. `listVersions` has to **synthesise a fake quote row** (`quoteId: ""`) so a brand-new project shows a version at all (`convex/projectVersionsRead.ts:150-163`). The Finance rail, the header switcher and the versions list are all the same `quotes` query wearing different clothes. |
| **I-2** | **Version content lives in `data: v.any()` blobs**, one row per entity, in a table that also stores CONFIRMED/COMPLETED/UNLOCK audit captures. | `convex/schema.ts:3283-3350`; six `reason` arms | Two unrelated things share a store; a `SnapshotEntityType` union is **redeclared in five places** and hand-kept in lockstep (`FEATUREDOCS/70` Phase 6; `convex/lib/projectSnapshots.ts:33`, `schema.ts:3331`, `projectLocksRead.ts:11`, `src/lib/project-snapshot-diff.ts:13`, `project-version-projection.ts`) — an R-3.1 defect acknowledged in comments. |
| **I-3** | **Two counters with two meanings** (`revision` allocator vs `liveRevision` pointer), coalesced by two helpers. | `convex/lib/quoteState.ts:77,91`; `schema.ts:1350-1362` | Already produced real bugs: `sendNative` keyed off the allocator (`FEATUREDOCS/70` "sendNative now targets the LIVE revision"), the quote-sent lock keyed off the allocator (`FEATUREDOCS/62` "#1080/#1100 Phase 5 fix"), and `backfillInvoiceSourceRevision.ts:54` stamps the allocator while `invoicesWrites.ts:201` stamps the pointer — wrong by construction on any promoted project. |
| **I-4** | **Three mutations create a version**, with different preconditions: `newVersionNative` (live must be SENT), `saveVersionNative` (any state), `repriceFromRevisionNative` (new version + money restore). | `convex/quotesWrites.ts:502,990`; `convex/projectVersionsWrites.ts:86` | The UI exposes two of them side by side ("Add version" in the header, "Create quote v(N+1)" in the rail) with no explanation of the difference (`FEATUREDOCS/70` Phase 5). Six mutations set `bypassQuoteLock` although `projectLocks.ts:241-245` says only two may. |
| **I-5** | **A version without a snapshot cannot be viewed or promoted.** `newVersionNative` only started capturing at #1085; pre-#1085 revisions render "no captured state (pre-versioning)". | `version-readonly-bar.tsx` `NoCapturedStateBar`; `project-version-switching.md` §6 "No retro-snapshotting" | The version list contains entries that are not versions. |

### 2.2 Viewing and switching — a second render and a destructive promote

| # | Issue | Evidence | Consequence |
|---|---|---|---|
| **I-6** | **Non-live versions are rendered by a parallel read-only UI**, not the real tabs: `version-projected-equipment.tsx` (325 lines of hand-built table markup), `-labour.tsx`, `-finance.tsx`, `VersionNotTrackedNote`, plus `projectVersionsEquipment.bundle` and `project-version-projection.ts` (324 lines) to feed them. | `FEATUREDOCS/70` "Deliberate scope decision: a separate read-only render surface"; Phase 6's "structural revision, same day" rewrite to make it *look* like the live tab | This is the "does not look and feel live" complaint, structurally: every visual change to the Equipment tab must be made twice; the projected view has no inline editing, no add menu, no drag, no comments; it is a permanent parity chase. |
| **I-7** | **You cannot edit a non-live version.** The design ruled it out (`project-version-switching.md` §2 decision 20: "variant quotes stay out of scope") and the projected surfaces have no mutations. | ibid.; `version-projected-*.tsx` | The only way to change an older version is to make it live first — which, on a confirmed job, means overwriting the live tables. "Try an option for the client" is not possible without disturbing the real booking. |
| **I-8** | **Promote is a restore that overwrites the live tables**, so it needs an **auto-capture** first (`PRE_PROMOTE`, allocating a new number labelled "Auto-saved before switching to vN"), a byte-equality short-circuit, and a conflict list for anything warehouse-backed. | `convex/projectVersionsWrites.ts:267,365`; `convex/lib/projectSnapshots.ts:408-590` | The version list grows "Auto-saved" entries nobody asked for; promote is `danger: "high"`; promote is **blocked while any non-VOID invoice exists** (`PROMOTE_BLOCKED_INVOICED`), which on a job with a deposit invoice means versioning stops working exactly when variations start. |
| **I-9** | **Promote does not restore what viewing shows.** Sub-hires, sub-hire groups and `categorySlots` ordering are captured for *viewing* but skipped by `restoreProjectSnapshot`; crew adds/removes are *never* applied, only reported. | `convex/lib/projectSnapshots.ts:21-32, 584, 590`; `FEATUREDOCS/70` "restoreProjectSnapshot is UNCHANGED — deliberately" | After "Make v2 live" the live Equipment tab is **not** the v2 you were looking at. |
| **I-10** | **Version management is spread over three surfaces** with overlapping actions: the header dropdown (switch/add/send/download/make live/delete), the Finance rail (`project-quote-rail.tsx`, 1,084 lines: send/recall/accept/decline/unaccept/protect/correct/rename/make live/delete/reprice/view), and the read-only bar (make live/back). `PromoteVersionDialog` has three entry points. | `FEATUREDOCS/70` Phases 4–5; `project-lock-strip.tsx` adds a fourth ("Recall vN to edit", "Create v(N+1)") | The same verb appears in up to four places; the list you manage versions from depends on which tab you are on. |

### 2.3 Locking — three mechanisms where one belongs

| # | Issue | Evidence | Consequence |
|---|---|---|---|
| **I-11** | **The lock is derived from quote status of the live revision** (`resolveLockTier({status, quoteState})`) — `SENT/ACCEPTED/DECLINED/SUPERSEDED/EXPIRED` all escalate to `FINANCE_LOCKED`. | `convex/lib/projectLocks.ts:98-130`; `FEATUREDOCS/62` "The quote-send lock is a second INPUT" | A *declined* or *superseded* quote locks pricing on an open enquiry; the only exits are "Create v(N+1)" or "Recall to edit" (`RecallToEditDialog`, #1100), each with its own dialog. Competitors model locking as an explicit status attribute, never as "a quote was sent" (§3). |
| **I-12** | **Unlock sessions are a second versioning system**: open → capture an `UNLOCK` snapshot → edit → "Save & relock" (diff first) or "Discard" (restore from the snapshot, with conflicts). | `convex/projectUnlockSessionsWrites.ts`; `FEATUREDOCS/62` "Unlock sessions" | Two restore callers, two diff renderers, two justification surfaces, and a session that `autoCommitOpenSession`s on status change. All of it is "edit a copy, then decide" — which is what a version is. |
| **I-13** | **`protected`, `correctQuoteNative`, `unacceptNative`, `deleteRecalledNative`, recall-to-edit** each add a bar or a branch on top of the five verbs. Two permission audiences (`invoice:publish` vs `isHardLockOverrideAllowed` vs owner-only) across thirteen mutations in `quotesWrites.ts` (1,507 lines). | `convex/quotesWrites.ts` exports at `:283-1364`; `quote-version-management-extensions.md` | The state × role × action matrix is documented in `finance-workflow-ux.md` §3.6 because nobody can hold it in their head. |
| **I-14** | **Justify tier is half-wired**: only remove/bulk-delete paths prompt; the server-error fallback in `useJustifiedMutation` never fires because `mapNativeWriteError` rewraps the error first. | `FEATUREDOCS/62` "Justify tier — partially wired" | ON_SITE structural edits through add/update paths fail with a raw toast. |
| **I-15** | **`CANCELLED` is ungated** and status transitions are excluded from the structural gate. | `convex/lib/projectLocks.ts:23`; `FEATUREDOCS/62` open questions | Inherited from #957, still open. |

### 2.4 Code health and docs

| # | Issue | Evidence |
|---|---|---|
| **I-16** | Stale docs: `FEATUREDOCS/62:366-370`, `FEATUREDOCS/66:756`, `finance-first-class-version-control.md:390` still document `project-versions-panel.tsx`, deleted in #1097. | grep |
| **I-17** | Stale in-code phase comments: `convex/projectVersionsWrites.ts:37,349` say "No UI in this phase" for a mutation with three UI entry points. | file |
| **I-18** | `findSnapshotForRevision` and `listSnapshots` `.collect()` every snapshot of a project and filter in memory — no `by_projectId_revision` index. | `convex/lib/projectSnapshots.ts:247` |
| **I-19** | The list/board lock glyph cannot show the `QUOTE_SENT` case (documented gap) because it would need a per-row quote lookup. | `src/components/projects/project-lock-glyph.tsx:20-26` |
| **I-20** | No e2e coverage of versions/promote/locks; the unit surface is large (≈30 files) and mostly tests the machinery this doc removes. | `convex/*.test.ts`, `src/**/__tests__` |

---

## 3. Research

### 3.1 Rental competitors (full report in the session; URLs inline)

| Product | What a "version" is | Switch live? | Locking |
|---|---|---|---|
| Rentman | Quote **document** versions (overwrite / new version / new number) + whole-job alternatives as **subprojects** ("Version 1/2") with Planner/Financial tick-boxes to keep options out of availability | No — tick boxes | Status-driven (Pending on send, Confirmed on e-sign) |
| Current RMS | None — one mutable opportunity; "Recent documents" keeps every PDF; alternatives = **clone** (drafts reserve no stock) | No | Separate **Lock Pricing** toggle; new lines auto zero-priced |
| Flex | None — **Copy Quote**; per-status attribute matrix (Creates Conflicts / Locked / Closed / Locks Availability) | No | Explicit matrix |
| HireHop | Manual **archive** of the supplying list; restore/copy back | Overwrite | — |
| Booqable / Goodshuffle / PoR | Live document that auto-updates; Goodshuffle tracks post-signature edits as an **unsigned delta** (red status, "unsigned removals", fulfilment doesn't see unsigned adds) | No | Signature invalidation |

**No competitor has a whole-job version with a switchable live pointer.** That is the
differentiator this program builds — and the reason none of their UI can be copied wholesale.

### 3.2 Patterns from best-in-class version history (Figma, Google Docs, Notion, Webflow, Framer, PandaDoc, Superset)

1. **Restore never rewinds.** Figma writes two checkpoints, Docs keeps the current version as
   "an earlier version now", Webflow stashes before restoring, Framer *deploys a pointer* at an
   immutable version. Our pointer-flip model (§4.8) gets this for free — no auto-save needed.
2. **Viewing an old version is a mode, not a page**: a persistent bar naming the version, controls
   read-only (Carbon: keep text legible, change field chrome; never `disabled`), one-click back.
3. **Split at acceptance**: live-edit before, hard freeze + clone/void after (Qwilr, Better
   Proposals, Jobber's "signature removed, signed PDF kept as a note").
4. **Locking is an explicit attribute matrix** (Flex) or a separate toggle (Current RMS) — never
   inferred from "a quote was sent".
5. **Options must not consume availability until chosen** (Rentman untick Planner, Current RMS
   clone-as-draft). Bake it in rather than making the user remember a checkbox.
6. **Name + short description on versions**, cheap and optional (Figma ≈25-char title).
7. **Right-rail actions + a status strip** is the industry-standard placement; the *switcher*
   belongs at the top next to status (Drupal's "View published | View draft").

Deliberate divergence, carried over from #985: **no "Restore" verb**. A sent document is the
record; the forward path is a new version. Under the new model "Make vN live" is a pointer
flip, so it is not a restore and never falsifies a document.

---

## 4. Target model — versions are workspaces

### 4.1 Concepts

| Concept | Is | Is not |
|---|---|---|
| **Project** | The job: identity, number, client, lifecycle status, `liveVersionId`, plus everything that is *not* versioned (§4.6) | A container of line items |
| **Version** | A complete, independently editable copy of the job's commercial content, numbered `v1…vN` in creation order, optionally labelled | A quote, a snapshot blob, a lifecycle event |
| **Live** | The one version the warehouse, availability, bookings and invoices follow. A pointer. | "Latest" — v2 can be live while v5 exists |
| **Quote** | An immutable **document** issued from a version: PDF bytes + money snapshot + dates + recipient + outcome (sent → accepted / declined / recalled / superseded / expired) | The version's identity |
| **Invoice** | Issued from the **live** version only; records `versionId` for lineage; project-level ledger | Versioned |
| **Frozen** | A version with a quote that has gone out and not been recalled. Its content is immutable; a client holds it. | A lifecycle lock |
| **Lifecycle lock** | The project-status lock (CONFIRMED+ pricing, ON_SITE justify, COMPLETED hard) — applies to the **live** version only, because only the live version has operational consequences | Applied to non-live versions |

### 4.2 Data model

```ts
// NEW
projectVersions: {
  id, organizationId, projectId,
  number: number,                       // v1..vN, allocated by the project, never reused
  label?: string,                       // ≤60, internal unless printed (existing labelOnDocument rule)
  basedOnVersionId?: string,            // lineage of the copy
  createdAt, createdById,
  frozenAt?, frozenById?,               // set by quote send; cleared by recall
  // versioned PROJECT-LEVEL fields move here (see 4.6): rental/project window, billing overrides,
  // taxRate, discountPercent/Amount, clientContactId, locationId, siteContact*, notes*, type, description
}
  .index("by_projectId_number")

// projects — identity + lifecycle + pointer. The versioned fields above become a DERIVED
// projection of the live version (written only by the make-live step, like recalc-owned totals).
projects.liveVersionId: string

// EVERY versioned child table gains two fields + one index:
versionId: string                       // which version this row belongs to
lineageId: string                       // stable across copies: = own id on first creation, copied on duplicate
  .index("by_versionId", ["versionId"])   // REPLACES by_projectId on these tables (see 4.9 sweep)
// tables: projectCategories, categorySlots, projectGroups, projectLineItems, projectServices,
//         (+ subHireGroups/subHireItems if sub-hire LINES are versioned — Q2)

// quotes — the document only
quotes.versionId: string                // replaces `version` as the join; `version` (number) stays for display/PDF
// REMOVED from quotes: label, labelOnDocument (→ projectVersions), snapshotId, protected*, recalledPdfFileIds→priorPdfFileIds (kept)

// invoices
invoices.versionId: string              // replaces sourceRevision (number)

// REMOVED: projects.revision, projects.liveRevision, projectSnapshots.revision,
//          reasons QUOTE_SENT | VERSION_SAVED | PRE_PROMOTE, projectUnlockSessions (§4.9)
```

**`lineageId` is the key idea for warehouse state.** `projectLineItemUnits`, `checkRecords`,
`maintenanceRecords.lineItemId`, collaboration threads and anything else that hangs off a line
item refers to the **live** line's id. When a version is duplicated, every copied row keeps the
original's `lineageId`. When a version is made live, warehouse rows are re-pointed from the
outgoing line to the incoming line with the same `lineageId` (§4.8). A line with warehouse state
and no counterpart in the incoming version is a *conflict* — the same concept
`isWarehouseBacked` reports today, but now nothing is deleted or recreated to get there.

### 4.3 Invariants (server-enforced, each tested)

1. Every non-template project has ≥1 version and `liveVersionId` points at one of its own.
2. `number` is unique per project and never reused (deleting a never-sent version leaves a gap — a
   gap is honest; today's counter rollback is dropped).
3. At most one quote row per version. At most one *current* (SENT/ACCEPTED) quote per project.
4. A frozen version's rows are immutable: every versioned-table mutation calls
   `assertVersionWritable(ctx, version)` — one guard, the successor of `assertLifecycleGuard`'s
   quote arm.
5. Rows of a non-live version are invisible to availability, overbooking, warehouse, dispatch,
   readiness, revenue allocation, Xero push and the dashboard. **Enforced by construction**
   (§4.9) and by an exhaustive test in the `xtenantExhaustive` style.

### 4.4 Operations (one verb, one mutation, one dialog)

| Verb | Where | Server | Notes |
|---|---|---|---|
| **New version** | header menu, Versions panel | `versions.createNative({ fromVersionId? , label? })` | Copies the source version's rows (default: the version you are looking at). Replaces `newVersionNative`, `saveVersionNative`, `repriceFromRevisionNative`. |
| **Open** | header menu, panel | `?v=N` | Renders the version in every tab, editable if open. |
| **Edit** | every tab | the existing `*Native` mutations, now taking `versionId` | Guard: `assertVersionWritable` + lifecycle lock *only if live*. |
| **Rename** | panel | `versions.setLabelNative` | |
| **Send quote** | strip, panel, Finance | `quotesWrites.sendNative({ versionId })` | **Any** version, not only live. Freezes it. Supersedes the previous current quote. |
| **Recall** | Finance | `recallNative` (unchanged semantics) | Unfreezes. Kept as the pre-client typo fix. |
| **Accept / Decline** | Finance | unchanged | Accepting a **non-live** version offers "Make vN live" in the success step. |
| **Make live** | strip, panel, compare | `versions.makeLiveNative({ versionId })` | §4.8. Not blocked by issued invoices (Q6). |
| **Compare** | header menu, panel, strip | existing `diffSnapshotEntries` over two versions' rows | The row shapes *are* the entry shapes, so the diff engine is reused, not rewritten. |
| **Delete** | panel | `versions.deleteNative` | Non-live, never-sent: manager. Ever-sent: the existing owner-only, typed-confirm, audit-surviving path. Live: never. |

Removed verbs: Save version, Reprice from revision, Recall-to-edit, Protect/Unprotect, Unlock
session (open/commit/discard), Correction stays (a metadata fix on the document, not the version).

### 4.5 The locking matrix — explicit, one table, shown in the UI

Lock state is a pure function `resolveLocks(project, version)` returning per-field-group
permissions. The strip and every `LockedField`/`GatedButton` read the same result.

| Situation | Money fields | Structure (add/remove/qty) | Dates/client/notes | Warehouse actions | Exit |
|---|---|---|---|---|---|
| Non-live, open | ✅ | ✅ | ✅ | — (not live) | — |
| Non-live, frozen (sent) | 🔒 | 🔒 | 🔒 | — | New version from it · Recall |
| Live, OPEN status, open | ✅ | ✅ | ✅ | ✅ | — |
| Live, OPEN status, frozen | 🔒 | ✅ at $0 (Unpriced) | ✅ (drift flagged) | ✅ | New version · Recall |
| Live, CONFIRMED / PREPPING / CHECKED_OUT | 🔒 | ✅ at $0 | ✅ (drift flagged) | ✅ | New version → make live |
| Live, ON_SITE / RETURNED | 🔒 | ✅ with justification | ✅ with justification | ✅ | New version → make live |
| Live, COMPLETED / INVOICED | 🔒 | 🔒 | 🔒 | 🔒 | New version → make live (admin/PM + justification) |
| Any, CANCELLED | 🔒 | 🔒 | 🔒 | — | Re-open status (Q5) |

Two rules replace today's three mechanisms:
- **Frozen ⇒ money locked everywhere; structure locked unless live** (the live version must be
  able to take on-site reality; that reality is flagged as drift against the client's document).
- **Lifecycle ⇒ applies to the live version only.** "Unlock" is gone: you change a locked live
  job by making a new version and making it live. Making live on a locked project is the gated,
  audited act (`invoice:publish` up to RETURNED; `isHardLockOverrideAllowed` + justification at
  COMPLETED/INVOICED), which is exactly where the existing override audience and justification
  bounds are reused (R-3.1).

### 4.6 What is versioned

| Versioned (copied into every version) | Live-only (belongs to the job) |
|---|---|
| Categories, category slots, groups, line items (incl. kit children, accessories, custom, sale, sub-hire *lines* — Q2) | Fulfilment units, check records, prep state, returns, incidents, maintenance links |
| Services (labour lines the client pays for) | Crew *assignments* and their offer/confirm workflow (Q2 — recommended live-only) |
| Project-level commercial fields: rental/project window, billing overrides, tax rate, discount, client contact, venue, site contact, notes, type, description | Identity, number, client, lifecycle status, PMs, tags |
| The quote document(s) issued from it | Invoices (lineage-labelled), Xero state |
| | Tasks, files, comments/threads (keyed by `lineageId` so they follow a line across versions) |

### 4.7 Availability and the warehouse

Only the live version's rows exist to the availability engine. A non-live version shows
**"as-if" availability**: the same engine run with `{ versionId }` — demand from that version's
lines, the project's own live lines excluded — rendered with the same chips but labelled "if vN
were live" (mockup 3). No warehouse verbs (prep, check-out, dispatch) are offered on a non-live
version; the tab is otherwise identical.

### 4.8 Make live

```
makeLiveNative({ versionId: K })            // K ≠ liveVersionId, K exists, not template
 1. permission + lifecycle gate (4.5)        // the ONE place the lock bites for versions
 2. outgoing = liveVersionId; incoming = K
 3. re-point warehouse rows by lineageId     // units, checkRecords, maintenance, threads
      – outgoing line has state, incoming has same lineage → move
      – outgoing line has state, no lineage match → CONFLICT (row stays attached to the job, flagged)
 4. projects.liveVersionId = K; project the version's commercial fields onto projects.*
 5. recalcProjectTotals; re-derive availability for the window; overbooking conflicts
 6. activity log PROJECT_VERSION_LIVE {from, to, conflicts}
 7. return { conflicts }                     // persistent panel, as today
```

No auto-capture, no restore, no `PRE_PROMOTE`, no byte-equality check: the outgoing version is
untouched and stays exactly where it was. Switching back is the same call in reverse.

### 4.9 What goes away, and the sweep it costs

**Removed:** `projects.revision`/`liveRevision`; `projectSnapshots` as a version store (the
CONFIRMED/COMPLETED audit captures may stay or be dropped — Q10); `projectUnlockSessions` and its
dialog/banner; `saveVersionNative`, `newVersionNative`, `repriceFromRevisionNative`,
`promoteRevisionNative`, `deleteDraftNative`, `deleteVersionNative`, `setQuoteProtectedNative`;
`RecallToEditDialog`, `RepriceFromRevisionDialog`, `PromoteVersionDialog` (replaced), the three
`version-projected-*.tsx`, `project-version-projection.ts`, `projectVersionsEquipment.ts`,
`VersionReadOnlyBar`, `QuoteDriftIndicator`, `UnlockSessionBanner/Dialog`; `bypassQuoteLock`.

**The sweep — the honest cost of "same components for every version":** every read of a
versioned table by project has to become a read by version. Counted today:

| Table | `db.query(...)` sites | Files |
|---|---|---|
| `projectLineItems` | 114 | 43 |
| `crewAssignments` | 49 | — |
| `projectServices` | 28 | — |
| `projectGroups` | 27 | — |
| `projectCategories` | 16 | — |
| `categorySlots` | 9 | — |
| `subHires`/`subHireItems`/`subHireGroups` | 18 / 22 / 21 | — |

Plus the cross-project indexes (`by_modelId`, `by_assetId`, `by_kitId`) in `availabilityCore.ts`,
`overbooking.ts`, `reservationConflicts.ts` etc., which must filter to the owning project's live
version. This is made **safe by construction**, not by diligence:

1. **Rename the index.** `by_projectId` is deleted on versioned tables and `by_versionId` added.
   Every one of the 114 sites fails to typecheck until it is changed — the compiler is the
   checklist. Sites that mean "the live job" call one helper, `liveRows(ctx, project, table)`.
2. **Ratchet.** A `scripts/version-scope-ratchet.mjs` (same shape as
   `xtenant-bycuid-ratchet.mjs`) fails CI on any `by_modelId`/`by_assetId`/`by_kitId` read of a
   versioned table that lacks a `versionId`/live filter.
3. **Exhaustive test.** Seed a non-live version with a line for a model/asset/kit and drive the
   registry (`registry.generated.ts`): every availability, overbooking, warehouse, dispatch,
   readiness and finance read must not see it. Registry-driven, so new reads join automatically.

---

## 5. UX

The canvas (https://claude.ai/artifact/EgwLTWJLKyyTeymqhjtNes) is authoritative for layout and copy. Principles:

1. **One control to switch, one place to manage.** The header pill (`v4 · Live ▾`) opens a menu
   for switching + New version + Compare + Manage. The **Versions panel** (right sheet, `V`) is
   the only place versions are created, renamed, compared, made live or deleted. The Finance tab
   lists *documents* per version and no longer manages versions (mockups 1, 4, 5).
2. **One strip.** `ProjectLockStrip`, `UnlockSessionBanner`, `VersionReadOnlyBar` and
   `QuoteDriftIndicator` collapse into one `VersionStrip` fed by one query, with five states
   (mockup 2). Absent when there is nothing to say (live, open, nothing sent).
3. **A non-live version is the real page.** Same tabs, same rows, same inline editing, same add
   menu; only warehouse verbs are absent and availability is labelled "if vN were live"
   (mockup 3). Tasks/Files/Comments stay live with the existing inline note.
4. **Frozen reads as read-only, not disabled** (Carbon): text stays legible, field chrome
   changes, a tooltip names the exit. `LockedField`/`GatedButton` are kept and now read the
   matrix in §4.5.
5. **Make live states what changes before it runs** (mockup 6): changes, what stays, warehouse
   conflicts, and the paperwork consequence ("Quote v3 hasn't been sent").
6. **Compare is always available** between any version and live or its predecessor (mockup 7),
   with the existing change stepper and always-on highlighting.
7. **Words.** "Version", "Live", "Frozen", "New version from vN", "Make vN live". Never
   "snapshot", "revision", "promote", "restore", "unlock session".

---

## 6. Migration

Volumes to confirm first (Q9). Planned as a forward migration with a rehearsal against a prod
export:

1. For every non-template project: create `projectVersions` row for `liveRevision` (label from the
   quote), set `liveVersionId`, stamp `versionId` + `lineageId = id` on every live child row.
2. For every non-live revision **with** a snapshot: create its version row and **materialise**
   rows from `projectSnapshotEntries` (the `data` blobs are the row shapes minus ids), with
   `lineageId = original entityId` — which equals the live row's id where the line still exists,
   so lineage matching works retroactively.
3. For non-live revisions **without** a snapshot: create the version row with `content: "missing"`
   so its quote document stays reachable; badge "no content captured (pre-versioning)".
4. `quotes.versionId`, `invoices.versionId` ← by number. Drop `PRE_PROMOTE` "Auto-saved" versions
   that are byte-identical to their neighbour (Q10).
5. Refuse to run while any unlock session is `OPEN`.
6. Every removed field stays declared `v.optional` for one release (the `depositPercent`
   precedent), then a cleanup backfill strips it.

---

## 7. Phases

| # | Phase | Scope | Effort | Depends |
|---|---|---|---|---|
| **0** | **Spike** | Rename `by_projectId` → `by_versionId` on `projectLineItems` in a scratch branch; count and classify the 114 sites (live-job vs version-specific vs cross-project); prototype `lineageId` re-pointing on units/check records | S | — |
| **1** | **Model + migration** | `projectVersions`, `versionId`/`lineageId`, `liveVersionId`, backfill (§6), `assertVersionWritable`, `resolveLocks` matrix, invariants + tests | L | 0 |
| **2** | **Reads and writes by version** | The sweep (§4.9): every tab's data hook and every `*Native` mutation take `versionId`; `liveRows` helper; ratchet; exhaustive live-only test; as-if availability parameter | L | 1 |
| **3** | **Make live + version verbs** | `makeLiveNative` with lineage re-pointing + conflicts; `createNative`/`setLabelNative`/`deleteNative`; delete the promote/restore/auto-capture machinery | M | 1 |
| **4** | **Lock simplification** | Retire unlock sessions + `bypassQuoteLock` + `protected`; lifecycle lock applies to live only; justification threaded through add/update (closes I-14); CANCELLED decision (I-15) | M | 1 |
| **5** | **UI** | Version menu, Versions panel, `VersionStrip`, Make-live dialog, Compare, Finance tab documents rail, delete the projected read-only surfaces | L | 2, 3, 4 |
| **6** | **Quotes from any version** | `sendNative({versionId})`, accept → offer make-live, frozen non-live rendering, drift against the current document | M | 3, 5 |
| **7** | **Cleanup + docs** | Remove dead tables/fields after one release; FEATUREDOCS 62/66/70 rewritten as one doc; `docs/glossary.md`; CLAUDE.md conventions | S | 6 |

Phases 1–4 are server-only and independently shippable behind the existing UI. Phase 5 is the
big visible change. Total ≈ XL at human-team scale.

---

## 8. Test plan (summary)

- **Invariants** (§4.3) as `convex-test` cases, including make-live in both directions,
  lineage re-pointing with and without matches, and the frozen guard on every versioned mutation.
- **Live-only exhaustive sweep** — registry-driven (§4.9 item 3). This is the test that makes
  the model safe; it ships with Phase 2, not after.
- **Cross-tenant** — every new read/mutation IDOR-tested (R-8.4.3); `by_versionId` is global.
- **Locking matrix** — the full §4.5 table as a truth-table test, like `projectLocks.test.ts` today.
- **Migration rehearsal** — against a prod export; materialised rows equal the projected view
  the old code produced for the same snapshot (parity), then the old code is deleted.
- **jsdom smoke** — the version menu *opens*, the panel opens, the strip renders each state,
  the Make-live dialog renders conflicts; the Equipment tab renders identically for a live and a
  non-live version from the same fixture (the parity test that replaces Phase 6 of #1080).
- **PDF regression** — unchanged; sent artifacts remain byte-identical.

---

## 9. Clarifying questions

Each with a recommendation so a one-word answer is enough.

| # | Question | Recommendation |
|---|---|---|
| **Q1** | **Should non-live versions be directly editable** (a workspace), or stay read-only with "make live to edit"? This is the whole model: editable requires the §4.9 sweep; read-only keeps most of today's shape and only polishes it. | **Editable.** It is what "look and feel as if they are live" means, and it is what makes options possible without disturbing the live booking. |
| **Q2** | **What is in a version?** Specifically: (a) crew assignments — versioned or live-only? (b) sub-hire supplier orders — live-only, with sub-hire *lines* versioned? (c) anything else you consider commercial? | (a) live-only (people and their yes/no are scheduling reality; the *service* line they fill is versioned). (b) yes. (c) as per §4.6. |
| **Q3** | **Can a quote be sent from a non-live version?** (Enables "send the client v3 as an option" while v4 stays live.) | **Yes.** Accepting it then offers "Make v3 live". |
| **Q4** | **Retire unlock sessions** in favour of "new version → edit → make live"? Any case where a quick in-place override must survive? | **Retire.** The version path is two clicks and leaves a real record. Keep per-edit justification for ON_SITE structural edits on the live version. |
| **Q5** | **Lifecycle lock scope:** keep the four tiers as they are (applied to live only), or simplify further (e.g. drop the JUSTIFY tier, gate CANCELLED)? | Keep the tiers; gate CANCELLED from CONFIRMED+ with a justification (closes I-15). |
| **Q6** | **Make live while an issued invoice exists?** Today it is blocked. | **Allow**, with the invoiced total shown in the dialog. A variation after a deposit invoice is the normal case; the balance invoice is computed from whatever is live when it is issued. Block only at INVOICED status without admin override. |
| **Q7** | **Protect / correction / unaccept:** fold `protected` into "accepted ⇒ frozen, owner-only unaccept", keep `correctQuoteNative` (dates-only, no version bump)? | Yes to both. |
| **Q8** | **Versions panel as a right-side sheet** (mockup 5) plus the header pill, or dropdown-only? Also: should "Compare" be a full overlay (mockup 7) or a side-by-side page? | Sheet + pill; overlay. |
| **Q9** | **Production data:** how many projects have >1 version today, and are there open unlock sessions? Is a short write-freeze acceptable for the migration? | Needed to size §6; the migration is rehearsed either way. |
| **Q10** | **Old audit captures** (`CONFIRMED`/`COMPLETED` snapshots) and "Auto-saved before switching" versions: keep, or drop during migration? | Drop the auto-saved duplicates; keep audit captures in a renamed read-only table for one release, then decide. |
| **Q11** | **Optional line items / single-select sections on a quote** (client picks add-ons; every proposal tool has it, no rental tool does) — in scope as a later phase, or out? | Out of this program; note as a follow-up. Most "with LED wall" cases would be an optional section rather than a version. |
| **Q12** | **Numbering:** keep `v1…vN` in creation order with gaps allowed, labels optional, label printable per send? | Yes. |

---

## 10. POLICY.md notes (BUILD mode)

- **R-3.1** — one version identity (`projectVersions`), one live pointer, one lock resolver, one
  strip, one diff engine, one restore path (none: make-live is a pointer flip), one version list.
  The five-copy `SnapshotEntityType` union and the two counters are removed rather than
  documented as exceptions.
- **R-9.3** — `liveVersionId`, `versionId`, `lineageId`, `frozenAt` are server-owned and stripped
  from client patches; no money originates in the client; make-live accepts only a target id.
- **R-8.4.3** — `by_versionId` is a global index: every read re-checks `organizationId` on the
  version's parent; IDOR-tested per operation via the registry sweep.
- **R-8.2.3 / R-8.6.2** — new forms (new version, rename, make live) get Zod schemas derived from
  one base; `*Native` mutations mirror bounds via `fieldGuards.ts`.
- **agentOps** — `makeLiveNative` is `danger: "high"` (rewrites what the warehouse follows);
  `createNative`/`setLabelNative` low; `deleteNative` high.
- **R-5.2 / R-5.3 / R-5.8** — FEATUREDOCS 62/66/70 and this doc update in the same PRs.
- **R-14.4** — §1.3 of `project-version-switching.md` recorded a reversal of #985's no-restore
  decision; this doc reverses it back by removing the restore entirely, and records that here.
