# Project versioning v2 — versions as switchable workspaces

> _Owner: Jayden Nawotka · Created: 2026-09-15 · Status: **decisions recorded 2026-09-15 (§9) — ready for `/plan-eng-review`; **PLAN COMPLETE** — 36 decisions, engineering review (§9.2) and outside-voice review (§9.3) closed**_

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
from the live version and record which one. Locking collapses to **one boolean on the project**
(`pricingLocked`, set when a quote goes out or the job is confirmed, cleared by one click) that
applies to the live version only — non-live versions are never locked (D37–D41, §4.5). The four
lifecycle tiers, unlock sessions and their private snapshots, per-edit justification, the
hard-lock override audience, `PRE_PROMOTE` auto-saves, the `protected` flag, three overlapping
"create a version" mutations and ~1,900 lines of projected read-only UI and lock machinery all go
away.

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
| **Project** | The job: identity, number, client, lifecycle status, `liveVersionId`, everything that is not versioned (§4.6), **and the live version's plan fields and totals** (§4.2 swap model) | A container of line items |
| **Version** | A complete, independently editable copy of the job's **plan** (§4.6), numbered `v1…vN` in creation order, optionally labelled. Every project, templates included, has at least one. | A quote, a snapshot blob, a lifecycle event |
| **Live** | The one version the warehouse, availability, bookings and invoices follow. A pointer. | "Latest" — v2 can be live while v5 exists |
| **Quote** | An immutable **document** issued from a version: PDF bytes + money snapshot + dates + recipient + outcome (sent → accepted / declined / recalled / superseded / expired). The pre-send row (today's `DRAFT`) is the send dialog's working record and is deleted with its version. | The version's identity |
| **Invoice** | Issued from the **live** version only; records `versionId` for lineage; project-level ledger | Versioned |
| **`pricingLocked`** (D37, revised) | A plain boolean on the **project**, set when a quote is sent or the project reaches `CONFIRMED`, cleared by one click from the strip by anyone with `project:update`. While set, money fields on the **live** version are read-only and new adds default to $0 with the Unpriced badge. That is the entire lock system. | A flag on the version · derived from quote status · a tier · something only an admin can clear |
| **Lifecycle lock** | *Gone (D39).* The four-tier `OPEN`/`FINANCE_LOCKED`/`JUSTIFY`/`HARD_LOCKED` table, unlock sessions, per-edit justification and the hard-lock override audience are all removed — see §4.5 for why each is safe to drop. Status still drives *when* `pricingLocked` switches on; it no longer drives what is writable. | A permission model |

### 4.2 Data model

```ts
// NEW
projectVersions: {
  id, organizationId, projectId,
  number: number,                       // v1..vN, allocated by the project, never reused
  label?: string,                       // ≤60, internal unless printed (existing labelOnDocument rule)
  basedOnVersionId?: string,            // lineage of the copy
  createdAt, createdById,
  // NO pricingLocked (D37/D38 reverse D18): the lock is one boolean on `projects`, applies to
  // the LIVE version only, and non-live versions are never locked. A per-version flag is what
  // made the page re-shape on every switch — see §4.5.
  contentState: "ready" | "missing",    // "missing" = a pre-versioning revision with no captured content
  // PLAN FIELDS — present ONLY on non-live versions (swap model, below):
  rentalStartDate?, rentalEndDate?, projectStartDate?, projectStartTime?, projectEndDate?, projectEndTime?,
  billingWeeksOverride?, billingDaysOverride?, taxRate?, discountPercent?, discountAmount?,
  clientContactId?, locationId?, siteContactName?, siteContactPhone?, siteContactEmail?,
  type?, description?, crewNotes?, internalNotes?, clientNotes?,
  // NO totals fields (D33 reverses D21): a non-live version's totals are COMPUTED on read,
  // never stored. They depend partly on LIVE crew assignments and sub-hire costs matched by
  // lineage (recalc.ts:221-222), which change without anyone touching the version — a stored
  // copy would go stale with nothing to re-trigger it, the exact defect CLAUDE.md forbids for
  // discounts and rollups. `recalcProjectTotals` stays the ONE writer of stored totals and
  // writes only `projects.*`, for the live version, which is its existing job.
}
  .index("by_projectId_number", ["projectId", "number"])
  .index("by_organizationId", ["organizationId"])

// projects — identity + lifecycle + pointer + THE LIVE VERSION'S plan fields and totals.
// The swap model (D17): the live version's dates/discount/tax/billing/notes/totals stay exactly where
// every reader finds them today (projects.*). A NON-live version stores its own copy on
// projectVersions.*. Make-live swaps the two field sets in one transaction. ONE write helper,
// `patchPlanFields(ctx, version, patch)`, and ONE recalc, `recalcVersionTotals(ctx, version)`,
// each branch on "is this the live version" and write to the right home — zero reader changes
// anywhere in the app (R-3.1: one writer per field group). Recalc inputs for a NON-live version:
// its own rows, plus the live crew assignments and sub-hire orders whose lineage matches one of
// its services/lines (recalc.ts:221-222 sums these into labourCostTotal/subHireCostTotal/margin);
// unmatched commitments are excluded; the count the strip shows is DERIVED by its query, not stored. PROJECT_MONEY_ANCHORS stripping (projectWrites.ts) extends to projectVersions.* patches.
projects.liveVersionId: string          // v.optional on arrival
projects.pricingLocked?: boolean        // D37 — the whole lock system (absent = false)
projects.pricingLockedAt?: number
projects.pricingLockedById?: string
// (liveVersionId is v.optional on arrival, required after the backfill — §6)

// THE COMPOSED OBJECT (D32): the swap keeps `projects.*` correct for readers of the LIVE version
// only. ~16 non-test files in `src/` read `project.rentalStartDate`/`discountPercent`/etc. directly
// to render whatever version is on screen — including `getProjectWindow` (src/lib/project-window.ts),
// the billing derivation and the PDF builder. So the project-detail read for `?v=N` returns a
// COMPOSED project: `projects.*` overlaid with `projectVersions[N]`'s plan fields and its computed
// totals when N is not live. Every component keeps reading `project.rentalStartDate` unchanged.
// One function, `composeProjectForVersion(project, version)`, tested by the property "the composed
// object for vN equals what `projects.*` would hold if vN were made live". Server actions and API
// routes that take a bare project doc take the composed one on a version-scoped path.

// VERSIONED tables (D16): projectCategories, projectGroups, projectLineItems, projectServices, categorySlots.
// Each gains two fields; by_projectId AND every by_projectId_* composite is renamed (categorySlots
// has no by_projectId — it reaches versioned rows through by_projectCategoryId/by_projectGroupId,
// which the ratchet covers instead):
versionId: string                       // v.optional on arrival, required after the backfill
lineageId: string                       // stable across copies: = own id on first creation, copied on duplicate
  .index("by_versionId", ["versionId"])                       // replaces by_projectId
  .index("by_versionId_sortOrder"), by_versionId_status, …     // replaces each by_projectId_* composite

projectLineItems.unplanned?: boolean    // set by make-live when reality is carried onto a line the incoming version did not plan (§4.8)

// LIVE-ONLY tables keep by_projectId and gain a LINEAGE link to the plan row they concern:
crewAssignments.serviceLineageId        // replaces serviceId as the join (a service exists per version; the person is live)
subHireItems.lineLineageId / targetGroupLineageId / targetCategoryLineageId
// projectLineItemUnits / checkRecords / maintenanceRecords keep lineItemId (the LIVE line) and are re-pointed on make-live (§4.8)

// quotes — the document only
quotes.versionId: string                // the join; the `version` column is kept until Phase 7, but from Phase 2 every reader takes the number from projectVersions.number via versionId
// label, labelOnDocument move to projectVersions; pricingLocked becomes projects.pricingLocked
// (D37); snapshotId, protected* are removed;
// recalledPdfFileIds is KEPT under its current name (no rename)

// invoices
invoices.versionId: string              // replaces sourceRevision (number)

// REMOVED: projects.revision, projects.liveRevision, projectSnapshots.revision,
//          reasons QUOTE_SENT | VERSION_SAVED | PRE_PROMOTE, projectUnlockSessions (§4.9),
//          and the whole lifecycle-tier machinery: LockTier, LOCK_TIER_RANK, LockTierReason,
//          resolveLockTier, bypassQuoteLock, requireJustification, isHardLockOverrideAllowed (D39)
```

**Field arrival.** Every new field is `v.optional` while the backfill runs (the `depositPercent`
precedent), then the validator narrows once `backfillProjectVersions` reports zero unstamped
rows. Readers coalesce through one helper each (`liveVersionId(project)`, `versionOf(row)`)
until the narrowing lands, never inline.

**`lineageId` is the key idea for warehouse state.** Units, check records, maintenance links
and collaboration threads refer to the **live** line's id. When a version is copied, every row
keeps the original's `lineageId`. When a version is made live, those rows are re-pointed from
the outgoing line to the incoming line with the same lineage (§4.8). A line with reality and no
counterpart in the incoming version is carried across as an `unplanned` line, never orphaned.

### 4.3 Invariants (server-enforced, each tested)

1. Every project, **templates included**, has ≥1 version and `liveVersionId` points at one of
   its own. (Templates version too so that `saveAsTemplateNative` / create-from-template read
   through the same index; a template's project is never `pricingLocked`.)
2. `number` is unique per project and never reused; gaps are honest.
3. **Exactly one quote row per version** (created lazily by the first send). **Any number of
   `SENT` quotes across versions** (D19); **at most one `ACCEPTED` per project**; accepting one
   supersedes every other open quote. Re-sending a version **reuses its row**: status back to
   `SENT`, the previous PDF pushed onto `recalledPdfFileIds`, nothing superseded (today's
   recall→resend shape, #1027).
4. `assertPricingUnlocked(ctx, project, version)` is the one guard, called **only by money-field
   writes** (~8 sites, down from 44): it refuses with `PRICING_LOCKED` when
   `project.pricingLocked` and the version is the live one. Structural and plan-field writes call
   nothing. It replaces `assertLifecycleGuard` in full, along with `bypassQuoteLock`,
   `resolveLockTier` and the unlock-session lookup (D37–D39, §4.5).
5. Rows of a non-live version are invisible to availability, overbooking, warehouse, dispatch,
   readiness, revenue allocation, Xero push, the dashboard and every org-level list. **Enforced
   by construction** (§4.9) and by an exhaustive test in the `xtenantExhaustive` style.
6. Crew assignments and sub-hire items always resolve their lineage links against the **live**
   version; a link whose lineage has no row in the live version is a conflict (§4.8), never a
   dangling join.
7. `projects.*` plan fields and totals always describe the live version; `projectVersions.*`
   plan fields and totals are present exactly on non-live versions (the swap keeps this true).

### 4.4 Operations (one verb, one mutation, one dialog)

| Verb | Where | Server | Notes |
|---|---|---|---|
| **New version** | header menu, Versions panel | `versions.createNative({ fromVersionId?, label? })` | Copies the source version's plan (default: the version you are looking at) via `copyPlanGraph` (§4.8). Replaces `newVersionNative`, `saveVersionNative`, `repriceFromRevisionNative`. |
| **Open** | header menu, panel | `?v=N` | Renders the version in every tab, editable per §4.5. |
| **Edit** | every tab | the existing `*Native` mutations, now taking `versionId` (optional in the public API, default live) | Money-field writes call `assertPricingUnlocked`; everything else calls nothing (D37). |
| **Rename** | panel | `versions.setLabelNative` | |
| **Send quote** | strip, panel, Finance | `quotesWrites.sendNative({ versionId })` | **Any** version. Sets `projects.pricingLocked` (only meaningful once that version is live — D38), renders the PDF; a re-send reuses the version's row (invariant 3). Never supersedes another version's quote (D19). |
| **Recall** | Finance | `recallNative` | Clears `projects.pricingLocked`; PDF retained. Kept as the pre-client typo fix. |
| **Accept** | Finance, strip | `quotesWrites.acceptNative({ quoteId })` | **Accept = make live in the same transaction** (D20): the dialog embeds the make-live summary and conflicts; on confirm the version goes live, the quote is `ACCEPTED`, every other open quote is `SUPERSEDED`, `CONFIRMED` is offered. `CONFIRMED` always requires the **live** version's quote to be `ACCEPTED` or the existing admin override. |
| **Decline** | Finance | unchanged | |
| **Unaccept** | Finance (owner) | `unacceptNative` | `ACCEPTED → SENT` on the document only. It does **not** flip `liveVersionId` back and does **not** un-supersede the other quotes (they were superseded by a business decision, re-send them if needed). Refused once an invoice has been issued from the version or gear has been checked out (`UNACCEPT_TOO_LATE`). |
| **Make live** | strip, panel, compare | `versions.makeLiveNative({ versionId })` | §4.8. Not blocked by issued invoices (D6). |
| **Compare** | header menu, panel, strip | `diffSnapshotEntries` retargeted to row shapes | A **mode on the real page** (§5 item 6). The five-copy `SnapshotEntityType` union (I-2) collapses to ONE definition in `src/lib/project-snapshot-diff.ts`, typed from the row validators; the engine's inputs become `{ table, rows }` pairs for the two versions. |
| **Delete** | panel | `versions.deleteNative` | Live: never. Non-live and never sent: manager; deletes its rows and its pre-send quote row. Ever sent: the existing owner-only, typed-confirm, audit-surviving path, which erases the quote row and its PDF too (#1029's decision), so nothing dangles. **Refused** while an invoice carries its `versionId` (`VERSION_REFERENCED`). Crew and sub-hire lineage links are unaffected (they resolve against live). |
| **Duplicate project / Save as template / Create from template** | existing | `duplicateNative` (also the instantiate-a-template path, `projectWrites.ts:1201`), `saveAsTemplateNative` | Both go through `copyPlanGraph`; copy the **live** version by default, `fromVersionId?` optional; the result starts at v1. |

Removed verbs: Save version, Reprice from revision, Recall-to-edit, Protect/Unprotect, Unlock
session (open/commit/discard). Correction stays (a metadata fix on the document, not the version).

### 4.5 The lock — one project flag, one click to clear (D37)

**Revised 2026-09-15 (D37–D41).** The earlier draft of this section kept a nine-row matrix
keyed on `(live?, pricingLocked, status)` with four permission values. That is still a lock
system that changes shape as you switch versions, and it is still a lot of refusals. Both go.

> **The whole rule.** `projects.pricingLocked` is a plain boolean on the **project**. It applies
> to the **live** version only. It is set automatically when a quote is sent or the project
> reaches `CONFIRMED`, and cleared by one click from the strip by a manager/admin/owner or one
> of the job's own PMs (D42). Nothing else refuses a write.

```ts
projects.pricingLocked?: boolean       // v.optional on arrival; absent = false
projects.pricingLockedAt?: number
projects.pricingLockedById?: string
```

`resolveLocks(project, version) → { money: "allowed" | "locked"; warehouse: "allowed" | "greyed" }`

| Situation | Money fields | Structure | Plan fields | Warehouse verbs |
|---|---|---|---|---|
| Viewing a **non-live** version | allowed | allowed | allowed | greyed (D15 — not live) |
| Live, `pricingLocked` **off** | allowed | allowed | allowed | allowed |
| Live, `pricingLocked` **on** | locked (one click to clear, D42) | allowed, new adds default $0 + Unpriced badge | allowed | allowed |

#### Who can clear it (D42)

```ts
canUnlockPricing(ctx, orgId, projectId, userId) =
     hasPermission(role, "invoice", "publish")        // owner · admin · manager
  || isProjectManagerOf(projectId, userId)            // this job's own PM, whatever their role
```

`member` holds `project:update` but **not** `invoice:publish` (`permissionsCore.ts:140` —
`invoice: ["create","read"]`), so a member can price a project freely while it is open and cannot
re-open one whose quote has gone out. This is the same audience shape as today's
`isHardLockOverrideAllowed` (admin/owner ∨ `projectManagers`), so that helper is **kept and
renamed** rather than deleted — D39 said it went with the hard lock; D42 revises that. Its role
test swaps from a hardcoded `owner|admin` to the `invoice:publish` permission, which is the
existing definition of "may act on money that has left the building" (R-3.1).

Locking is never gated: anyone with `project:update` can re-lock.

Three columns collapsed to two values. There is no tier ordering, no reason union, no override
audience, no session, and no free-text justification anywhere.

#### Why each piece of the old system goes

| Removed | Why it is safe to remove |
|---|---|
| **`HARD_LOCKED` at COMPLETED/INVOICED** | It protects against a danger #987 already eliminated. A sent quote / issued invoice is **stored bytes** with no regeneration path anywhere (CLAUDE.md, `src/server/finance-documents.ts`), so editing the project afterwards cannot alter any document the client holds. The tier was defending a file that is already immutable — while blocking the one edit you actually want, which is fixing a number you discovered was wrong after the job. |
| **`JUSTIFY` tier + per-edit justification** (`requireJustification`, `JUSTIFICATION_BOUNDS`, `use-justified-mutation.ts`, 32 `kind: "structural"` gate sites) | The stated value was an audit trail of post-checkout changes. `logActivity` already records who changed what, when, and the before/after value on **every** write. The free text adds nothing a reviewer can query, and it is typed by a warehouse hand under time pressure on a loading dock. Replaced by a queryable field: every activity row written while `pricingLocked` carries `metadata.afterLock: true`. Better signal, zero typing. |
| **`projectUnlockSessions`** (table, `openNative`/`commitNative`/`discardNative`, its own `UNLOCK` snapshot + restore + diff + conflict list, banner, dialog, `autoCommitOpenSession`) | It is "edit a copy, then keep or discard" — which is exactly what a version is (I-12). With versions as real workspaces the session has no job left. The toggle is the unlock. |
| **`isHardLockOverrideAllowed` / `requireHardLockOverrideAllowed`** | A second, narrower permission audience (admin/owner/assigned-PM) existing only to gate hard-lock escapes. With no hard lock, `project:update` is the one audience. |
| **`resolveLockTier`, `LockTier`, `LOCK_TIER_RANK`, `LockTierReason`, `quoteStateKeepsOpen`, `currentRevisionQuoteStatus` as a lock input** | The quote-derived escalation (I-11) is the defect where a *declined* or *superseded* quote freezes pricing on an open enquiry. Sending sets the flag once; quote state never reads back into it again. |
| **`bypassQuoteLock`** | Existed only because the escalation was derived and created a chicken-and-egg deadlock for the two mutations that clear it (`projectLocks.ts:241-245`, with six mutations setting it against that comment). A stored flag has no such cycle. |
| **`protected` quotes, `correctQuoteNative`, `unacceptNative`, recall-to-edit** | Four bars and branches layered on the five verbs to work around the derived lock (I-13). Recall is the one that survives. |

#### Why it is decoupled from versions (D38)

The flag lives on `projects`, not `projectVersions`, and **non-live versions are never locked**.

This is the piece that serves "feel native hopping between versions". Under the old draft the
lock state changed as you switched — v2 (sent) read-only, v3 (draft) editable, v4 (sent, not
live) read-only — so every hop re-shaped the page and every component had to ask "which version
am I on, and what does that version allow". Now: hop to any non-live version and it is a plain
editable plan; hop to live and the strip shows the lock if it is on. One flag, read once, off the
project you already loaded — no per-version lock lookup, nothing that flickers on switch.

Locking a non-live version bought nothing anyway. Nothing operational follows a non-live
version: no stock is held, no warehouse verb runs, no invoice can be issued from it. It is a
draft. Drafts do not need locks.

The honesty cost is handled where it belongs: if the live version drifts from the document the
client is holding, the strip says so (the drift diff between the sent quote's money snapshot and
the live version's current rows, which `VersionStrip` already computes — §5). A drift **warning**
is the right instrument; a refusal was not.

#### What still genuinely refuses

Nothing new. The three existing hard invariants are unchanged and none of them is a "lock":

1. An issued finance document's bytes are never overwritten or deleted (`attach*Artifact`
   returns `attached: false` rather than replacing — CLAUDE.md).
2. `PROJECT_MONEY_ANCHORS` are recalc-owned and stripped from client patches.
3. Warehouse verbs run against the live version only (D15 — greyed, with a tooltip, not hidden).

#### Review of the lock model, 2026-09-15 (D54–D58)

An adversarial read of §4.5 after it was written. It found **four real gaps and one omission** —
recorded here rather than discovered during Phase 4.

**Gap 1 — nothing said what `makeLiveNative` does to the lock (D54).** Cut v3 off a locked live
v2, edit its prices freely (non-live ⇒ unlocked), make v3 live: is the project still locked?
**It is.** Making a version live never changes `pricingLocked` in either direction. The flag
means "this job has a quote with a client", which is still true, and the fact that the newly-live
version's prices were never quoted is exactly what the drift warning is for. Auto-clearing here
would silently unlock every job the moment someone switched options.

**Gap 2 — `sendNative` on a NON-live version must not set the lock (D55).** Phase 6 lets you
quote any version. If sending a speculative v3 option set `projects.pricingLocked`, quoting an
alternative would freeze pricing on the live v2 — a lock raised by an act that has nothing to do
with the locked version. The rule: **`sendNative` sets `pricingLocked` only when the version it
is sending IS the live version.** Sending a non-live version records the quote and leaves the
lock untouched; the lock arrives later, if and when that version is accepted and made live.

**Gap 3 — `recallNative` clears the lock only symmetrically (D56).** Same rule, mirrored:
recalling the **live** version's quote clears `pricingLocked`; recalling a non-live version's
quote does not, or recalling a dead option would unlock the job the client is actually holding a
quote for.

**Gap 4 — nothing said what a status revert does (D57).** `CONFIRMED → QUOTING` does **not**
clear the lock. Status raises the flag; only a person lowers it. An explicit attribute that
silently un-set itself on a status change would be derived again in all but name — which is the
I-11 defect this whole section exists to remove.

**Omission — the unlock mutation needs `danger: "high"` (D58).** CLAUDE.md's classification lists
**lock-softening** explicitly under `high`, so `unlockPricingNative` is `danger: "high"` and the
API dispatcher's confirmation gate requires `confirm: true` before the call reaches Convex. Two
things fall out for free: an API key cannot unlock a job in a single unconfirmed call, and Mira
can never unlock one herself — a `danger: "high"` tool always stops and asks a human to click
Confirm (`confirmMiraPendingAction`), and the model is never given a `confirm` parameter. The
`agentOps` annotation is required or `pnpm run api:registry` fails the build. Re-locking is
`danger: "low"`.

**Checked and found sound:** `defaultToZero` / `pricedUnderLock` become `project.pricingLocked &&
version is live`, so a non-live version's new adds get normal auto-pricing (better than today);
`LOCKED_SERVICE_FIELDS`'s `hasCrew` caveat survives untouched (a crew-attached service's
`costTotal` still auto-derives); the `discountMode`-clears-with-`discount` rule (CLAUDE.md) still
has its `defaultToZero` branch and needs a test, not a change; templates never reach a locked
state; and the flag being `v.optional` makes the change rollback-safe.

#### Cost of the change

| | Before | After |
|---|---|---|
| Lock tiers | 4 (`OPEN`/`FINANCE_LOCKED`/`JUSTIFY`/`HARD_LOCKED`) | 1 boolean |
| Lock inputs | status + live-revision quote state + open session + override audience | one stored field |
| Gate call sites | 44 non-test `assertLifecycleGuard` (32 structural, 8 financial, 4 mixed) | ~8 `assertPricingUnlocked`, money writes only |
| Mechanisms | 3 (lifecycle tiers, quote-derived escalation, unlock sessions) | 1 |
| Deleted modules | — | `projectUnlockSessionsWrites.ts` (280), unlock parts of `projectLocksRead.ts` (209), `unlock-session-dialog.tsx` (93), `unlock-session-banner.tsx` (140), `use-justified-mutation.ts` (113); `projectLocks.ts` 421 → ~90; `lock-copy.ts` 203 → ~60 |

`LOCKED_PROJECT_FIELDS` / `LOCKED_GROUP_FIELDS` / `LOCKED_LINE_ITEM_FIELDS` /
`LOCKED_SERVICE_FIELDS` / `LOCKED_CREW_FIELDS` are **kept** — they are the single definition of
"which fields are money" (R-3.1) and are still what `assertPricingUnlocked` and `LockedField`
read. `pricedUnderLock` is **kept**: it is a display badge on a $0 default, not a gate.

### 4.6 What is versioned — "the plan is versioned, commitments and reality stay live" (D16)

A version is a complete copy of the **plan the client is quoted on**: the equipment list and its
structure, the labour lines, and the project-level plan fields. Anything that is a commitment to
a third party (a crew member's assignment and reply, a supplier's purchase order) or a record of
what physically happened (fulfilment, check records, prep state) lives once, on the job, and
links to the plan row it concerns through `lineageId`. The schema already draws this line by
column: the 16 warehouse fields in `LINE_ITEM_WAREHOUSE_FIELDS` (`convex/lib/projectSnapshots.ts:337`)
sit inline on the line-item row, crew shifts and time entries hang off `assignmentId`, and a
sub-hire order carries a unique `orderNumber`, `supplierOrderId` and `paymentStatus`.

| Versioned (copied into every version) | Live-only (one row per job, lineage-linked where it concerns a plan row) |
|---|---|
| Categories, category slots, groups, line items (kit children, accessories, custom, sale, sub-hire lines) | The 16 warehouse columns on the line item: **blanked on copy, carried outgoing → incoming by lineage on make-live** |
| Services (labour lines, with their charge and cost) | Crew assignments, replies, shifts, time entries (`serviceLineageId`) |
| Project-level plan fields and recalc totals (swap model, §4.2) | Sub-hire orders, groups and items (POs are supplier contracts; their target rows link by lineage) |
| The quote document(s) issued from it | Fulfilment units, check records, returns, incidents, maintenance links |
| | Invoices (lineage-labelled), Xero state, identity, number, client, lifecycle status, PMs, tags |
| | Tasks, files, comments/threads (threads keyed by `lineageId`) |

A version can differ in gear, structure, services, prices, dates and notes. It cannot name a
different crew or a different supplier order; those follow whichever version is live, which is
also how today's restore behaves (`CREW_WORKFLOW_FIELDS` never rewritten).

### 4.7 Availability and the warehouse

Only the live version's rows book gear. On a non-live version the availability column has
the **same presentation and copy as the live tab** — same chips, no "if vN were live" caveat
(D13) — computed for the viewed version's lines, so the numbers can differ.
Internally this is a **new engine path, not a predicate**: `availabilityCore.ts` (L175) documents
that the dated `booked` sum deliberately *includes* the project's own live lines, so the
viewed-version computation must exclude the project's live lines and include the viewed
version's lines (`{ viewedVersionId }`). The `excludeProjectId` occurrences (25 across 6 non-test files outside `availabilityCore.ts`) are the
seam. **Dead options never reach the scan at all (D35):** the join filter also drops versions whose
only quote is `SUPERSEDED`/`DECLINED`/`EXPIRED` and which were never live, so the losing halves of a
two-option quote stop costing anything on every model scan the moment the client picks one. Their
rows are untouched — Compare, the version list and the audit trail still read them — they are simply
never candidates for a booking. This is what the scanned-rows budget (D22) escalates to if it fires;
having it from day one means the alert has a prescribed response instead of an open question.
The substitution is invisible in the UI. Warehouse and outbound verbs (prep, check-out,
dispatch, send crew offer, send supplier PO) stay **visible but greyed** on a non-live version
through the existing `GatedButton` pattern (`aria-disabled`, tooltip: "v3 isn't live. Make it
live to prep or check out."), so a PM sees at a glance which actions belong to the live version
(D15). The tab is otherwise identical.

### 4.8 Make live, and the copy primitive

```
makeLiveNative({ versionId: K })            // K ≠ liveVersionId, K.contentState === "ready", not a template-only op
 1. permission check (project:update)        // no lock gate at all (D37/D39): making a version
    //  live is a pointer flip, never a destructive restore, so there is nothing for a lock to
    //  protect. It is `danger: "high"` in the API registry and fully activity-logged.
 2. outgoing = liveVersionId; incoming = K
 3. carry reality by lineageId               // generalises convex/projectLineItems.ts ~L930-965 (units + checkRecords)
      – for each outgoing line with reality (units, check records, maintenance links, threads,
        the 16 warehouse columns): incoming line with the same lineage → move rows, copy columns,
        blank the outgoing line's columns
      – outgoing line has reality, no lineage match → the line is COPIED into K as an
        `unplanned: true`, $0 line carrying its reality, listed as a CONFLICT. Reality is never
        orphaned on a non-live version. (K may be pricingLocked: an unplanned $0 line is the one
        structural write the lock admits, the same rule as an on-site add.)
      – incoming quantity < carried fulfilment (2 checked out, plan says 1) → CONFLICT, not blocked
      – crew assignment whose serviceLineageId has no service in K → CONFLICT (assignment kept, flagged)
      – sub-hire item whose target lineage has no row in K → CONFLICT (order kept, flagged)
 4. swap plan fields AND totals: projectVersions[outgoing].* ← projects.*; projects.* ← projectVersions[K].*
 5. projects.liveVersionId = K
 6. recalcVersionTotals(K) (now live → writes projects.*); re-derive availability; overbooking
    conflicts AND crew date conflicts when the rental window moved (deriveDateMoveConflicts,
    projectVersionsWrites.ts:411, kept and moved into makeLiveNative)
 7. activity log PROJECT_VERSION_LIVE {from, to, conflicts}
 8. return { conflicts }                     // persistent panel, as today
```

**Atomicity and bounds.** Make-live is **one Convex transaction**; it never batches. It touches
every plan row of two versions plus their reality rows. Convex bounds a transaction at 8,192
written documents and 16 MiB; make-live pre-counts and refuses with `VERSION_TOO_LARGE` above a
registered budget (T-* in `docs/exceptions.md`, initial 4,000 rows) rather than partially
switching. Nothing in production is within an order of magnitude of that.

**Copy is `copyPlanGraph(ctx, { fromVersionId, toVersionId })`**, a helper extracted from the
category → group → line, parent-first id-remap that `duplicateNative`
(`convex/projectWrites.ts:1147`) already performs, and then used by `duplicateNative`,
`createNative`, `saveAsTemplateNative` and the migration (§6). What `duplicateNative` does
**not** do today and the helper must: copy `categorySlots` and `projectServices`; remap the full
intra-version FK set (`parentLineItemId`, `categoryId`, `groupId`, `subHire*`,
`projectServices.lineItemId`, `categorySlots.projectCategoryId/projectGroupId/lineItemId/subHireGroupId`);
stamp `lineageId`; blank the 16 warehouse columns; keep the same `projectId`; never touch
`status`. A copy above the transaction budget runs in scheduler batches with the target's
`contentState: "copying"` until complete; the header menu and Versions panel subscribe to the
version list reactively (Convex queries are live), so a copying version shows a spinner row and
becomes selectable when `ready` (Phase 5 dependency).
Round-trip test: copy then diff equals empty modulo ids.

### 4.9 What goes away, and the sweep it costs

**Removed:** `projects.revision`/`liveRevision`; `projectSnapshots` as a version store (the
CONFIRMED/COMPLETED audit captures stay in a read-only table for one release — D10);
`projectUnlockSessions` and its dialog/banner; `saveVersionNative`, `newVersionNative`,
`repriceFromRevisionNative`, `promoteRevisionNative`, `deleteDraftNative`, `deleteVersionNative`,
`setQuoteProtectedNative`; `RecallToEditDialog`, `RepriceFromRevisionDialog`,
`PromoteVersionDialog` (replaced), the three `version-projected-*.tsx`,
`project-version-projection.ts`, `projectVersionsEquipment.ts`, `VersionReadOnlyBar`,
`QuoteDriftIndicator` (state moves into `VersionStrip`), `UnlockSessionBanner/Dialog`;
the whole lifecycle-tier module surface — `LockTier`, `TIER_BY_STATUS`, `lockTierForStatus`,
`LOCK_TIER_RANK`, `LockTierReason`, `resolveLockTier`, `quoteStateKeepsOpen`,
`getOpenUnlockSession`, `requireJustification`, `JUSTIFICATION_BOUNDS`,
`isHardLockOverrideAllowed`, `requireHardLockOverrideAllowed`, `assertLifecycleGuard`,
`bypassQuoteLock`, `use-justified-mutation.ts` (D37–D41); `recallNative`'s un-supersede branch (`quotesWrites.ts:455-461`, meaningless once
send no longer supersedes across versions); `quotes.version` (number) in Phase 7, derived through
`versionId` → `projectVersions.number` until then (R-3.1).

**The sweep — the honest cost of "same components for every version":** every read of a
versioned table by project has to become a read by version. Counted on 2026-09-15 by grepping
`withIndex("by_projectId` on each table's queries in `convex/` (excluding tests):

| Table | `by_projectId` reads | `by_projectId_*` composite reads | Other index reads the ratchet must cover |
|---|---|---|---|
*(Counts below are the **measured** ones from D45 — a static classification of every
`query("<table>")` → next `withIndex(...)` across non-test `convex/` + `src/`. They replace the
earlier estimates, which were roughly half the real figure.)*

| `projectLineItems` | 42 | 7 (4 `_status`, 3 `_sortOrder`) | `by_modelId`, `by_assetId`, `by_kitId`, `by_bulkAssetId`, `by_categoryId`, `by_groupId`, `by_parentLineItemId`, `by_organizationId*` |
| `projectServices` | 16 | 0 | `by_lineItemId`, `by_crewRoleId`, `by_organizationId*` |
| `projectGroups` | 17 | 0 | `by_categoryId`, `by_organizationId` |
| `projectCategories` | 10 | 0 | `by_organizationId` |
| `categorySlots` | 0 (no such index) | — | `by_projectCategoryId`, `by_projectGroupId`, `by_lineItemId`, `by_subHireGroupId` |

The cross-project index reads in `availabilityCore.ts`, `overbooking.ts`,
`reservationConflicts.ts`, the warehouse/dashboard/finance org lists and the crew calendar feed
already load each row's project (for `isTemplate`/status), so the live filter there is one
predicate on `versionId`. This is made **safe by construction**, not by diligence:

1. **Rename the indexes.** `by_projectId` **and every `by_projectId_*` composite** are deleted
   on versioned tables and `by_versionId[_*]` added. Every site fails to typecheck until it is
   changed — the compiler is the checklist. Sites that mean "the live job" call one helper,
   `liveRows(ctx, project, "projectLineItems")` (typed by table name, returns the live version's
   rows through `by_versionId`).
2. **Ratchet.** `scripts/version-scope-ratchet.mjs` (same shape as
   `xtenant-bycuid-ratchet.mjs`) fails CI on any read of a versioned table through a
   non-`by_versionId` index (`by_modelId`, `by_assetId`, `by_kitId`, `by_bulkAssetId`,
   `by_categoryId`, `by_groupId`, `by_parentLineItemId`, `by_lineItemId`, `by_supplierId`,
   `by_organizationId*`, `by_projectCategoryId`, `by_projectGroupId`) that lacks a live filter
   marker in its body. Baseline 0.
3. **Exhaustive test.** Seed a non-live version with a line for a model/asset/kit and drive the
   registry (`registry.generated.ts`, via the existing `convex-schema-synthesis.ts`): every
   availability, overbooking, warehouse, dispatch, readiness, finance and org-list read must not
   see it. Registry-driven, so new reads join automatically.

**Public API impact.** Every `*Native` mutation and versioned read gains an **optional**
`versionId` (default: live), so the stable contract stays additive (gate 6 of
`generate-api-registry.mts` allows gained args). `makeLiveNative` is `danger: "high"`;
`createNative`/`setLabelNative` low; `deleteNative` high. Curated MCP tools keep operating on the
live version unless a version is named.

## 5. UX

The canvas (https://claude.ai/artifact/EgwLTWJLKyyTeymqhjtNes) is the reference for layout and copy; the model program (Phases 0–4) does not gate on UI polish. Principles:

1. **One control to switch, one place to manage.** The header pill (`v4 · Live ▾`) opens a menu
   for switching + New version + Compare + Manage. The **Versions panel** (right sheet, `V`) is
   the only place versions are created, renamed, compared, made live or deleted. The Finance tab
   lists *documents* per version and no longer manages versions (mockups 1, 4, 5).
2. **One strip.** `ProjectLockStrip`, `UnlockSessionBanner`, `VersionReadOnlyBar` and
   `QuoteDriftIndicator` collapse into one `VersionStrip` fed by one query (`resolveLocks` + the drift diff between the sent document's snapshot and the version's rows), with five states
   (mockup 2) — now three, since the justify and hard-lock states are gone (D39). Absent when
   there is nothing to say (live, unlocked). When locked it carries the **Unlock pricing** button:
   one click, no dialog, logged (D37).
3. **A non-live version is the real page.** Same tabs, same rows, same inline editing, same add
   menu, same availability column (mockup 3); only warehouse verbs are absent.
   Tasks/Files/Comments stay live with the existing inline note.
4. **Frozen reads as read-only, not disabled** (Carbon): text stays legible, field chrome
   changes, a tooltip names the exit. `LockedField`/`GatedButton` are kept and now read the
   matrix in §4.5.
5. **Make live states what changes before it runs** (mockup 6): changes, what stays, warehouse
   conflicts, and the paperwork consequence ("Quote v3 hasn't been sent").
6. **Compare is a mode on the real page** — fleshed out in §5.1 below (mockup 7).
7. **Words.** "Version", "Live", "New version from vN", "Make vN live". Never
   "snapshot", "revision", "promote", "restore", "unlock session".

### 5.1 Compare mode (D46–D52)

The first draft of this was "the same table with changed rows highlighted", which is correct but
is still, in the end, a list. The question a PM actually arrives with is not *which cells differ*
— it is **"why is this version $3,280 more, and can I defend that to the client?"** Compare mode
is built to answer that question first and show the rows second.

#### Research → the four rules it follows

| Finding | Source | What it decides here |
|---|---|---|
| Two independently scrolling panes are the wrong architecture for a diff: two scroll positions that must be kept in step, different content heights, and compared items landing in different places. Use **one scroll container, one grid, two cells per row** — the halves live in the same row element, so there is no state that can disagree. | [dev.to — *Two scrolling panes is the wrong way to build a side-by-side diff*](https://dev.to/hammad4june1999/two-scrolling-panes-is-the-wrong-way-to-build-a-side-by-side-diff-3ehn) | **D46.** No split panes ever. One table, one scroll container. |
| Comparison-table layouts are for *interpretation*; avoid them when the task is creation or editing. Inline editing in the original table keeps the most context. | [uxpatterns.dev — Comparison Table](https://uxpatterns.dev/patterns/data-display/comparison-table), [Pencil & Paper — enterprise data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) | **D47.** Compare is a **read mode**: inline editing is suspended while it is on, and the exit is one click. It reuses the real table so context is preserved, but it is not a place you type. |
| A waterfall / bridge chart decomposes a variance into its contributors, connecting two totals with the step-by-step changes between them rather than showing only the endpoints. | [ClosePack — The Variance Waterfall](https://www.closepack.io/blog/the-variance-waterfall-how-to-actually-explain-what-changed), [Domo — Waterfall charts](https://www.domo.com/learn/charts/waterfall-charts), [Inforiver](https://inforiver.com/insights/waterfall-charts-finance-professionals-best-friend/) | **D48.** The top of compare mode is a **money bridge**, not a count of changes. |
| Revision comparison in estimating tools is expected to report *what changed and what drove the total* — added scope, removed scope, repricing — as its primary output. | [BuildAI — Comparing Revisions](https://www.pelles.ai/university/articles/comparing-revisions-addendum-control) | **D49.** Changes are grouped by **kind** (added / removed / repriced / re-scoped), each with its own money contribution. |

#### D48 — the money bridge is the headline

A horizontal bridge across the top of the page, reading left to right:

```
v4 $18,120  ──┐
              ├─ + LED wall package      +$3,280   (added)
              ├─ − MA3 Light ×2          −$1,440   (removed)
              ├─ ± Source Four LED S2      +$120   (repriced)
              ├─ ± rental window 4→5 days  +$920   (plan field)
              └─ → v3 $21,000
```

Each segment is clickable and scrolls the table to the row(s) behind it. This is the artefact a PM
screenshots into an email. The change *count* becomes secondary text, not the headline.

Two rules keep it honest:
- **Every segment traces to rows.** The bridge is derived from the same diff that renders the
  table — one computation, two presentations (R-3.1). A segment with no rows behind it is a bug,
  and the test plan asserts `sum(segments) == v(b).total − v(a).total` exactly.
- **Plan-field changes are first-class segments.** A rental window going 4 → 5 days moves the
  total without any row changing. The first draft of compare had nowhere to put that; it was the
  biggest hole in it.

#### D50 — rows align by `lineageId`, so there is no pairing heuristic

Text diffs have to *guess* which line matches which, which is why they buffer consecutive changes
and pair edits off with `Math.max` logic. We don't: a line copied from v4 into v3 keeps its
`lineageId` (§4.2), so alignment is **exact and free**. Four row states follow directly:

| State | Test | Rendering |
|---|---|---|
| **Unchanged** | lineage in both, all compared fields equal | dimmed to ~55%, full row still readable |
| **Changed** | lineage in both, ≥1 field differs | normal weight; **only the differing cells** show `old → new`, everything else renders once |
| **Added** | lineage only in B | green tint, `Added in vN` pill |
| **Removed** | lineage only in A | red-tinted left edge, strikethrough name, quantities as `n → 0` |
| **Moved** | lineage in both, different `categoryId`/`groupId` | shown **in its new home** with a `Moved from Lighting` pill and a ghost placeholder in the old one |

"Moved" is new — the first draft rendered a category change as a remove + an add, which
double-counts it in the bridge and reads as scope churn that never happened.

#### D51 — cell-level, not row-level, highlighting

A changed row shows `$50.00 → $55.00` **in the unit-price cell only**. Every other cell renders
its single current value. Highlighting the whole row and making the reader hunt for the delta is
the failure mode of most diff tables; the row tint says *something here changed*, the cell says
*this did*.

#### D52 — three controls, no more

- **Filter:** `All rows · Only changes` (default **Only changes** when there are >40 rows,
  `All rows` otherwise — a 12-line quote reads better whole).
- **Stepper:** `‹ Change 2 of 5 ›`, bound to `n` / `p`, scrolling and focusing the row.
- **Direction:** the compare target is a small inline picker in the strip (`v4 · Live` /
  `v2 · previous`), because "compare with what" is the only genuinely variable input.

Everything else — per-tab change badges, the running subtotal/GST/total footer with old → new —
is derived, not configured.

#### What it composes with

- **Tabs still work.** Each tab carries its change count; Overview renders the **plan-field**
  changes (dates, client, venue, discount, notes) as the same old → new treatment. Compare is not
  a screen you navigate *to*, it is a lens you turn on.
- **Drift is the same lens.** "v4 has changed since quote v4 was sent" (strip state D) opens
  compare mode with A = the sent document's money snapshot and B = the live version's rows. One
  component answers both "how do two versions differ" and "how has this version drifted from what
  the client holds" — which is why §4.5 can afford to make drift a warning rather than a lock.
- **Make live lives here.** The make-live dialog (mockup 6) is compare mode's summary in a
  dialog; it reuses the same diff and the same bridge.

**Out of scope for the first release:** exporting a compare as a client-facing "variation" PDF.
It is the obvious next ask (an AV client asking "what changed since the last quote?" is a weekly
event) but it needs its own document type, and the §4.4 rule that finance documents are stored
bytes applies to it. Logged in `TODOS.md`, not built.

---

## 6. Migration

**Production volumes (read via the API on 2026-09-15):**

| Fact | Count |
|---|---|
| Projects | 54 |
| Projects carrying a `revision` at all | 8 (the other 46 read as v1 with no quote row) |
| Projects with more than one version | 4 (260801 ×7, 260802 ×2, 260719 ×2, 260402 ×2) |
| Version rows in total | 13 |
| Sent quote documents | 6 |
| "Auto-saved before switching" duplicates | 3 (all on 260801 / 260802) |
| Non-live versions without captured content | 0 — every one has a snapshot |

260801 (Roundhouse UNSW) is the real-world case this program is for: "High End PA Option" and
"Budget PA Option" saved as versions, switched between, then quoted twice. The migration is
therefore small (seconds), and the "write-freeze" in D9 means only that nobody edits a project
while it runs — a late-evening run, not downtime.

Planned as a forward migration with a rehearsal against a prod export:

1. For every project, **templates included**: create the `projectVersions` row for `liveRevision`
   (label from the quote), set `liveVersionId`, stamp `versionId` + `lineageId = id` on every
   live child row. **This step alone is Phase 1's release** (§7): the live tables are unchanged
   in meaning, so nothing can leak.
2. **Only after Phase 2's live filter is deployed** (materialised non-live rows would otherwise
   be read as live by every `by_projectId` consumer): for every non-live revision **with** a
   snapshot, create its version row and **materialise** rows from `projectSnapshotEntries`
   through `copyPlanGraph` (the `data` blobs are the row shapes minus ids), with `lineageId =
   original entityId` — which equals the live row's id where the line still exists, so lineage
   matching works retroactively. Warehouse columns are blanked; plan fields and totals from the
   snapshot's `project` entry land on `projectVersions.*`.
3. For non-live revisions **without** a snapshot (none in production today): version row with
   `contentState: "missing"` so its quote document stays reachable; badge "no content captured".
4. `quotes.versionId` ← by number. `invoices.versionId` ← `sourceRevision` only for rows created
   after #1097 (stamped from `liveRevision` at issue time, `invoicesWrites.ts:201`); earlier rows
   keep it absent rather than trusting the allocator-based backfill (I-3). Drop `PRE_PROMOTE`
   "Auto-saved" versions that are byte-identical to their neighbour (D10).
5. Refuse to run while any unlock session is `OPEN`; set `projects.pricingLocked` for every
   project whose live revision has a `SENT`/`ACCEPTED` quote or whose status is `CONFIRMED`+,
   so nothing that is locked today silently unlocks on deploy (D37).
6. Every removed field stays declared `v.optional` for one release (the `depositPercent`
   precedent), then a cleanup backfill strips it.

---

## 7. Phases

| # | Phase | Scope | Effort | Depends |
|---|---|---|---|---|
| **0** | **Spike** | Rename `by_projectId*` → `by_versionId*` on `projectLineItems` in a scratch branch; classify every site (live-job vs version-specific vs cross-project); prove `duplicateNative` scoped to a version and a `lineItemMergeMaps`-style re-point of units/check records on a fixture | S | — |
| **1** | **Model + live backfill** | `projectVersions`, optional `versionId`/`lineageId`/`liveVersionId`, `copyPlanGraph` extracted from `duplicateNative`, backfill of the LIVE version only (§6 step 1), coalescing helpers, invariants 1–2 + tests. Ships alone: live tables unchanged in meaning. | M | 0 |
| **2** | **Reads and writes by version** | The sweep (§4.9): index rename incl. composites (92 measured sites / 37 files, D45), every tab's data hook and every `*Native` mutation take `versionId`, `liveRows` helper, money-write guard threaded through, **the `recalc.ts` pure/persist split (D59) — the most correctness-sensitive item in the program**, the viewed-version availability path (§4.7), ratchet, exhaustive live-only test; then §6 step 2 materialisation, which is the first moment non-live rows exist. | L | 1 |
| **3** | **Make live + version verbs** | `makeLiveNative` with lineage re-pointing, plan-field/totals swap, conflicts and the size budget; `createNative`/`setLabelNative`/`deleteNative`; accept = make live (D20; exercised on the live version only until Phase 6 lets send target a non-live one); delete the promote/restore/auto-capture machinery | M | 2 |
| **4** | **Lock simplification** (D37–D41) | Add `projects.pricingLocked` + set/clear mutations + strip toggle; delete `projectUnlockSessions` (table, writes, read, banner, dialog), the four-tier machinery (`LockTier`, `LOCK_TIER_RANK`, `resolveLockTier`, `bypassQuoteLock`), all per-edit justification (`requireJustification`, `use-justified-mutation.ts`, 32 structural gate sites) and the hard-lock override audience; replace 44 `assertLifecycleGuard` calls with ~8 `assertPricingUnlocked`; stamp `metadata.afterLock` on activity rows; `protected`/`correctQuoteNative`/`unacceptNative`/recall-to-edit removed; CANCELLED needs no special case any more (closes I-11, I-12, I-13, I-14, I-15). **Net deletion** — smaller than the original Phase 4. | S–M | 2 |
| **5** | **UI** | Version menu, Versions panel, `VersionStrip`, Make-live dialog, Compare, Finance tab documents rail, composed-object wiring (D32), delete the projected read-only surfaces | L | 2, 3, 4 |
| **6** | **Quotes from any version** | `sendNative({versionId})`, multiple SENT with one ACCEPTED (D19), accept = make live from a non-live version (D20), locked non-live rendering, drift against the sent document | M | 3, 5 |
| **7** | **Cleanup + docs** | Remove dead tables/fields after one release; FEATUREDOCS 62/66/70 rewritten as one doc; `docs/glossary.md`; CLAUDE.md conventions | S | 6 |
| **8** | **Optional line items** (D11) | Client-facing optional lines / single-select sections on a quote: `optional` + `optionGroup` on line items, excluded from totals until chosen, chosen state recorded on accept. Touches the `DocumentLineItem` shape, so the CLAUDE.md two-consumer PDF audit applies. Own design doc before build. | M | 6 |

### Tracking issues

| Phase | Issue | Ships |
|---|---|---|
| — | **[#1221](https://github.com/TwoToned/gearflow/issues/1221)** — parent tracking issue | — |
| 0 | [#1224](https://github.com/TwoToned/gearflow/issues/1224) — spike | nothing (scratch branch) |
| 1 | [#1226](https://github.com/TwoToned/gearflow/issues/1226) — `projectVersions` + live backfill | alone, to `main` |
| 2 | [#1228](https://github.com/TwoToned/gearflow/issues/1228) — reads/writes by version + the recalc split | 2–6 as one release |
| 3 | [#1229](https://github.com/TwoToned/gearflow/issues/1229) — make live + the version verbs | ↑ |
| 4 | [#1230](https://github.com/TwoToned/gearflow/issues/1230) — lock simplification | ↑ |
| 5 | [#1231](https://github.com/TwoToned/gearflow/issues/1231) — UI | ↑ |
| 5b | [#1232](https://github.com/TwoToned/gearflow/issues/1232) — Compare mode | ↑ |
| 6 | [#1233](https://github.com/TwoToned/gearflow/issues/1233) — quotes from any version | ↑ |
| 7 | [#1234](https://github.com/TwoToned/gearflow/issues/1234) — cleanup + docs | separately |
| 8 | [#1235](https://github.com/TwoToned/gearflow/issues/1235) — optional line items | separately, own design doc first |

Each issue carries its own **Done when** checklist — the per-phase acceptance criteria this
section deliberately does not duplicate (R-3.1: one definition, and the issue is where work is
tracked). Compare (5b) is split out of Phase 5 because it depends on `computeTotals` from
Phase 2, not just on the page shell.

**Release grouping (D35, revised by D44).** Phase 0 is a scratch-branch spike, nothing ships.
**Phase 1 ships alone** — a live-only backfill that changes nothing visible or readable.
**Phases 2–6 ship as ONE release.**

2–5 cannot be split for a mechanical reason: Phase 2 deletes `by_projectId`, Phase 3 deletes the
promote/restore machinery and Phase 4 deletes unlock sessions, but today's header switcher,
`PromoteVersionDialog` and `UnlockSessionBanner` call exactly that machinery — shipping 2–4
without 5 leaves dead buttons on a tool the business runs on.

**6 joins them for a product reason (D44).** Without it, `sendNative` still targets the live
version only, so the workflow this whole program exists for — quote the client two options, let
them pick — cannot be run: you would have switchable versions you cannot separately quote from.
Shipping 2–5 alone delivers the refactor without the feature. Phase 6 is also where the locked
non-live rendering and drift-against-the-sent-document work lands, both of which the §4.5 lock
model assumes. Phases 7–8 are additive and ship separately afterwards. Phases 0–6 ≈ L–XL, the
whole program ≈ XL at human-team scale.

---

## 8. Test plan (summary)

- **Invariants** (§4.3) as `convex-test` cases, including make-live in both directions,
  lineage re-pointing with and without matches, and the frozen guard on every versioned mutation.
- **Live-only exhaustive sweep** — registry-driven (§4.9 item 3). This is the test that makes
  the model safe; it ships with Phase 2, not after.
- **Cross-tenant** — every new read/mutation IDOR-tested (R-8.4.3); `by_versionId` is global.
- **Totals** — the D59 differential test: for every fixture, `computeTotals` on the live version
  equals the stored `projects.*` that `recalcProjectTotals` wrote. This is what stops a non-live
  version's displayed total from differing from what you get when you make it live.
- **Lock** — D54–D57 as four explicit cases (make-live leaves the flag alone; send/recall on a
  non-live version leave it alone; a status revert leaves it set), plus the three-row §4.5 table
  as a truth-table test (the shrunken successor to today's
  `projectLocks.test.ts`), plus: a non-live version is writable in every field family regardless
  of `pricingLocked`; clearing the lock writes an activity row; a write while locked stamps
  `metadata.afterLock`.
- **Migration rehearsal** — against a prod export; materialised rows equal the projected view
  the old code produced for the same snapshot (parity), then the old code is deleted.
- **jsdom smoke** — the version menu *opens*, the panel opens, the strip renders each state,
  the Make-live dialog renders conflicts; the Equipment tab renders identically for a live and a
  non-live version from the same fixture (the parity test that replaces Phase 6 of #1080).
- **PDF regression** — unchanged; sent artifacts remain byte-identical.

---

## 9. Decisions (Jayden, 2026-09-15)

| # | Decision |
|---|---|
| **D1** | **Non-live versions are directly editable.** A version is a workspace. This commits to the §4.9 sweep. |
| **D2** | ~~A version is a full snapshot including crew assignments and sub-hires.~~ **Superseded by D16** after the cold read; the plan-only scope stands. |
| **D3** | **A quote can be sent from any version**, not only the live one. Accepting a non-live version's quote offers "Make vN live". |
| **D4** | **Unlock sessions are retired.** Changing a locked live job is: clear the lock (one click, logged) or cut a new version → edit → make live. *Per-edit justification also goes — superseded by D39.* |
| **D5** | ~~The four lifecycle tiers stay, applied to the live version only; CANCELLED from CONFIRMED+ gated with a justification.~~ **Superseded by D37/D39** — the tiers are deleted. CANCELLED needs no special case: it is a status like any other, and `pricingLocked` carries over whatever it was (closes I-15 by removing the question). |
| **D6** | **Make live is allowed while an issued invoice exists.** The dialog shows the invoiced total; the balance invoice is computed from whatever is live when issued. At INVOICED status it needs the admin/PM override like any other hard-locked change. |
| **D7** | **`protected` is folded into "accepted ⇒ frozen, owner-only unaccept".** `correctQuoteNative` (dates only, no version bump) is kept. |
| **D8** | **Versions panel is a right-side sheet plus the header pill.** |
| **D9** | **Migration** sized from production (§6): 54 projects, 4 with more than one version, 13 version rows, none without content. Run as a short evening migration; the only constraint is nobody editing a project while it runs. |
| **D10** | **Drop the "Auto-saved before switching" duplicates; keep the CONFIRMED/COMPLETED audit captures** in a read-only table for one release. |
| **D11** | **Optional line items are in scope** as their own later phase (Phase 8). |
| **D12** | **Numbering stays `v1…vN`** in creation order, gaps allowed, labels optional and printable per send. |
| **D13** | **No "as-if" availability.** The availability column on a non-live version looks exactly like the live tab (§4.7). |
| **D14** | **Comparisons between versions are wanted** and should feel like the normal project page, not a separate diff screen (§5 item 6, mockup 7). |
| **D16** | **Scope revised after the cold read: a version is the plan, not the commitments.** Categories, slots, groups, line items, services and the project's plan fields are versioned; crew assignments, sub-hire orders and warehouse reality stay live and link by lineage (§4.6). Supersedes the "full snapshot" wording of D2. |
| **D17** | **Approach: ideal architecture reusing existing primitives** (`duplicateNative` for copy, `lineItemMergeMaps` for re-point, the swap model for plan fields, index rename incl. composites, ratchet + exhaustive test), shipped as one program rather than two releases or an options-first cut. |
| **D18** | ~~`pricingLocked` is an explicit flag on the **version**; a locked non-live version is read-only.~~ **Superseded by D37/D38** — the flag moved to the project and non-live versions are never locked. The "explicit, not derived" half of D18 stands; the "on the version" half was what made the page re-shape on every switch. |
| **D19** | **Multiple SENT quotes may be out at once, one per version; at most one ACCEPTED per project;** accepting one supersedes the others; re-sending supersedes only that version's own earlier document. |
| **D20** | **Accept = make live in the same transaction.** CONFIRMED always requires the live version's quote to be ACCEPTED or the admin override. |
| **D21** | ~~Recalc is version-aware and totals are stored per version.~~ **Superseded by D33** after the outside-voice review: recalc stays version-aware, but non-live totals are computed on read, never stored. |
| **D15** | **Warehouse and outbound verbs are greyed out, not hidden, on a non-live version** (prep, check-out, dispatch, crew offers, supplier POs), with a tooltip naming the live version as the exit. |

### 9.1 Still to confirm

- **Compare as a mode on the real page** (mockup 7) is my reading of "comparisons should feel
  similar to editing a project". If you meant something else — e.g. two versions side by side —
  say so and mockup 7 changes.
---


### 9.2 Engineering review decisions (`/plan-eng-review`, 2026-09-15)

| # | Decision |
|---|---|
| **D22** | **Availability keeps the join filter** on `by_modelId`/`by_assetId`/`by_kitId` (drop non-live rows after loading the project row) with a registered scanned-rows budget per availability call in `docs/exceptions.md`; denormalised `isLive` + `_isLive` indexes is the documented escalation if the alert fires. |
| **D23** | **Warehouse mutations remap a stale line id to the live row of the same lineage** (`resolveLiveLine`, logged as an activity entry); refuse with `LINE_NOT_LIVE` when no live row shares the lineage. Office mutations refuse a non-live id outright (`VERSION_NOT_LIVE`). |
| **D24** | **Hard index cut** in the Phases 2–4 release; rollback runbook = redeploy the previous Convex functions and re-add `by_projectId*` (rows keep `projectId`). Runbook lives in §6. |
| **D25** | **One definition of the versioned tables** in `convex/lib/versionedTables.ts` (table list, FK-remap map for `copyPlanGraph`, row types inferred from the schema validators), imported by `src/`. Replaces the five-copy `SnapshotEntityType`. |
| **D26** | **One `planHome(ctx, version)` resolver** plus exported `PLAN_FIELDS`/`TOTAL_FIELDS`; `patchPlanFields`, `recalcVersionTotals`, make-live's swap and the client-patch stripping lists all consume them. |
| **D27** | **New error codes** (`PRICING_LOCKED`, `VERSION_NOT_LIVE`, `LINE_NOT_LIVE`, `VERSION_REFERENCED`, `VERSION_TOO_LARGE`) map through `resolveLockCopy` so toasts name the exit. `VERSION_LOCKED` and `UNACCEPT_TOO_LATE` are dropped with the mechanisms that raised them; I-14 closes by deleting `useJustifiedMutation` rather than fixing it (D39). |
| **D28** | **ASCII diagrams in code** as acceptance criteria of Phases 2–3: version × quote state machine in `convex/versions.ts` (replacing `quotesWrites.ts`'s old one), the make-live pipeline in `makeLiveNative`, the swap in `convex/lib/planHome.ts`, the three-row lock table in `convex/lib/projectLocks.ts`. |
| **D29** | **One Playwright journey spec** `e2e/harness-versions.spec.ts` (create → new version → edit → send → accept/make live → warehouse follows) on the existing harness, in CI's e2e job. |
| **D30** | **Order-independence tests** for scan-then-make-live and make-live-then-stale-scan (units end on the live lineage), plus the no-lineage-match `unplanned` carry. |
| **D31** | **`financeOrg` loads `projectVersions.by_organizationId` once per call** and groups several SENT quotes per project into one row; a read-count assertion in `financeOrg.test.ts`. |
| **D32** | Housekeeping folded into Phase 7: stale doc references (I-16) and stale phase comments (I-17). |

### 9.3 Outside-voice decisions (independent plan challenge, 2026-09-15)

An independent cold read of the reviewed plan found four load-bearing gaps that the review itself
missed. All four are recorded here; every one of its factual claims was verified against the code
before being accepted.

| # | Decision |
|---|---|
| **D33** | **The composed project object** (§4.2). "Zero reader changes" was only true for the live version; ~16 files read `project.*` directly to render whatever version is on screen. The `?v=N` read returns `projects.*` overlaid with that version's plan fields, so readers genuinely stay unchanged. |
| **D34** | **Non-live totals are computed on read, never stored** — reverses D21. Stored per-version totals would go stale whenever a live crew rate or sub-hire cost changed, with nothing to re-trigger them. `recalcProjectTotals` keeps writing only `projects.*`, for the live version. |
| **D35** | ~~Phases 2–5 ship as one release.~~ **Revised by D44** — the grouping is 2–6. The mechanical reason (dead buttons across the 2–4 → 5 gap) is unchanged and still applies. |
| **D36** | **Dead options drop out of the hot scans** (§4.7): versions whose only quote is superseded, declined or expired and which were never live are excluded from `by_modelId`/`by_assetId`/`by_kitId` reads. Rows are kept for Compare and history. Gives D22's budget alert a prescribed response instead of an open question. |
| **D37** | **The lock is one boolean on the project.** `projects.pricingLocked` — set when a quote is sent or the project reaches `CONFIRMED`, cleared by one click from the strip by anyone who passes `canUnlockPricing` (D42), both directions written to the activity log. It gates **money fields on the live version only**. No tiers, no reason union, no override audience, no session, no justification. (§4.5) |
| **D38** | **The lock is decoupled from versions.** It lives on `projects`, not `projectVersions`, and **non-live versions are never locked** — nothing operational follows a draft, so a draft needs no lock. This is what makes hopping between versions feel native: nothing about the page's writability changes on a switch. Drift from the sent document is surfaced by the strip as a **warning**, which is the honest instrument; a refusal was not. |
| **D39** | **`JUSTIFY` and `HARD_LOCKED` are deleted, not softened.** Per-edit justification (`requireJustification`, `JUSTIFICATION_BOUNDS`, `use-justified-mutation.ts`, 32 `kind: "structural"` gate sites) is replaced by `metadata.afterLock: true` on the activity rows written while locked — a queryable field instead of free text typed on a loading dock. `HARD_LOCKED` guarded against altering a client's document, which #987 already made impossible (issued PDFs are stored bytes with no regeneration path), while blocking the legitimate post-job correction. `isHardLockOverrideAllowed` / `requireHardLockOverrideAllowed` go with it. |
| **D40** | **Quote status never reads back into the lock.** `sendNative` sets the flag once; `recallNative` clears it. `SUPERSEDED` / `DECLINED` / `EXPIRED` do nothing — closing I-11, where a declined quote froze pricing on an open enquiry. `resolveLockTier`, `LockTier`, `LOCK_TIER_RANK`, `LockTierReason`, `quoteStateKeepsOpen` and `bypassQuoteLock` are all deleted; `bypassQuoteLock` existed only to break the cycle a derived lock created, and a stored flag has no cycle. |
| **D41** | **What is kept:** the `LOCKED_*_FIELDS` lists (the single definition of "which fields are money", R-3.1), `pricedUnderLock` (a display badge on a $0 default, not a gate), `LockedField` / `GatedButton` (now reading a two-value result), and the three real invariants — immutable issued documents, recalc-owned `PROJECT_MONEY_ANCHORS`, warehouse verbs on the live version only. |
| **D42** | **The unlock audience is `invoice:publish` ∨ the job's assigned PM(s).** `project:update` was too wide — it includes `member`, who would otherwise be able to re-open pricing on a completed, invoiced job. `isHardLockOverrideAllowed` is kept (renamed `canUnlockPricing`) with its role test swapped for the `invoice:publish` permission check; D39's "it goes with the hard lock" is revised. Re-locking is ungated. |
| **D43** | **Post-invoice divergence is reported, not prevented.** Verified 2026-09-15: `pushInvoiceToXero` (`src/server/xero.ts:329`) reads `invoiceLines` — the invoice's own snapshotted lines, with account/tax coding snapshotted at push time — never live project rows, and an issued invoice is immutable (VOID + reissue, or a credit note). So a post-invoice edit cannot corrupt the client's PDF **or** the accounting system; the only real effect is that the project's own totals move away from what was invoiced. The Finance tab carries a derived line — *"Project total has moved +$1,240 since INV-023 was issued"* — computed from the invoice's stored total against the live version's current total, with a link to the activity rows stamped `metadata.afterLock`. No new stored field. |
| **D44** | **The release is Phases 2–6, not 2–5.** Phase 6 is what makes `sendNative` target any version; without it the program ships switchable versions that cannot be separately quoted from — the refactor without the feature that motivated it. It also carries the locked non-live rendering and drift-against-the-sent-document work that §4.5's lock model assumes. |
| **D45** | **Phase 0's sweep surface is measured, not estimated** (2026-09-15, static classification of every `query("<table>")` → next `withIndex(...)` across non-test `convex/` + `src/`): **92 `by_projectId*` read sites across 37 files** break on the rename — `projectLineItems` 42 + 4 (`_status`) + 3 (`_sortOrder`), `projectServices` 16, `projectGroups` 17, `projectCategories` 10, `categorySlots` **0** (it has no `by_projectId` index; it reaches versioned rows via `by_projectCategoryId`/`by_projectGroupId`/`by_lineItemId`/`by_subHireGroupId`, which is why the ratchet covers it instead). A further 101 `by_cuid` sites do not break but carry the org-check + version-check discipline. Heaviest files: `lib/projectSnapshots.ts` (11, mostly deleted by Phase 3), `projectWrites.ts` (8), `warehouseOps.ts` (5), `projectServicesWrites.ts` (5), `categorySlotsWrites.ts` (5). The spike still runs — this is a static approximation, and its job is to confirm the classification and prove `copyPlanGraph` + lineage re-point on a fixture — but Phase 2's "L" is now an informed L. |
| **D46** | **Compare never uses split panes.** One scroll container, one grid, both halves of a row in the same row element — the two-scroll-position sync problem does not get to exist. |
| **D47** | **Compare is a read mode.** Inline editing is suspended while it is on (comparison layouts are for interpretation, not creation), and the exit is one click. It reuses the real table, so context is kept, but it is not a place you type. |
| **D48** | **The headline is a money bridge, not a change count.** A horizontal waterfall from v(a) total to v(b) total, one segment per contributor (added / removed / repriced / plan-field), each clickable to its rows. Derived from the same diff that renders the table; `sum(segments) == Δtotal` is a test-plan assertion. Plan-field changes (rental window, discount) are first-class segments — the first draft had nowhere to put a total that moved without a row changing. |
| **D49** | **Changes group by kind**, each with its own money contribution: added, removed, repriced, re-scoped. This is what revision comparison in estimating tools is expected to output. |
| **D50** | **Rows align by `lineageId`** — exact, with no pairing heuristic, because unlike a text diff we carry a stable identity. Adds a fifth row state the first draft lacked: **moved** (same lineage, different category/group) renders in its new home with a `Moved from X` pill and a ghost in the old one, instead of a remove + an add that double-counts in the bridge. |
| **D51** | **Highlighting is cell-level.** Only the differing cells show `old → new`; the row tint says *something changed here*, the cell says *this did*. |
| **D52** | **Three controls only:** filter (`All rows` / `Only changes`, defaulting to Only changes above 40 rows), the `‹ n of m ›` stepper bound to `n`/`p`, and the compare-target picker. Per-tab badges and the old → new totals footer are derived, not configured. |
| **D53** | **Drift uses the same lens.** Strip state D opens compare mode with A = the sent document's money snapshot, B = the live version's rows. One component answers both "how do these versions differ" and "how has this drifted from what the client holds" — which is what lets §4.5 make drift a warning rather than a lock. Exporting a compare as a client-facing variation PDF is the obvious next ask and is deliberately out of the first release (own document type, §4.4 stored-bytes rule applies) — logged in `TODOS.md`. |
| **D54** | **Making a version live never changes `pricingLocked`.** The flag means "this job has a quote with a client", which stays true across a switch. Auto-clearing on make-live would unlock every job the moment someone switched options; the newly-live version's unquoted prices are what the drift warning is for. |
| **D55** | **`sendNative` sets the lock only when the version it sends is the live one.** Quoting a speculative non-live option must not freeze pricing on the version the client is actually holding a quote for. The lock arrives later, if that option is accepted and made live. |
| **D56** | **`recallNative` clears the lock only when recalling the live version's quote.** The mirror of D55 — recalling a dead option would otherwise unlock the live job. |
| **D57** | **A status revert does not clear the lock.** `CONFIRMED → QUOTING` leaves it set; status raises the flag, only a person lowers it. A flag that silently un-set itself on a status change would be derived again in all but name — the I-11 defect §4.5 exists to remove. |
| **D58** | **`unlockPricingNative` is `danger: "high"`** — CLAUDE.md lists lock-softening explicitly under `high`, so the dispatcher's confirmation gate requires `confirm: true` and Mira must stop and ask a human to click Confirm (she is never given a `confirm` parameter). The `agentOps` annotation is required or `pnpm run api:registry` fails the build. Re-locking is `danger: "low"`. |
| **D59** | **`recalcProjectTotals` must be split into a pure half and a persist half before D34 is buildable** — flagged 2026-09-15 during a confidence pass, previously assumed rather than specified. Today it is a single 240-line `MutationCtx` function (`convex/lib/recalc.ts:206`, one of only two exports in the file) that reads, computes and `ctx.db.patch(project._id, …)` inline. D34 says a non-live version's totals are computed **on read**, which is a `QueryCtx` path that cannot call it. The split is `loadTotalsBundle(ctx, …)` (ctx-taking, `QueryCtx | MutationCtx`) + `computeTotals(bundle)` (pure) + `recalcProjectTotals` keeping the patch, exactly the shape `convex/lib/availabilityCore.ts` already proves with `loadModelAvailabilityBundle` + `computeModelAvailability`. **The arithmetic must have ONE definition** (R-3.1): a second copy for the read path would let a non-live version's displayed total differ from what you get the moment you make it live — the highest-consequence silent divergence in the program, since it is the number on the quote. `recalcVersionTotals` (D26) becomes a thin caller of the pure half, and compare's money bridge (D48) sums the same computation, which is what makes `sum(segments) == Δtotal` provable rather than coincidental. Sizing: this lands in Phase 2 (it is what "version-aware recalc" actually costs) and is the single most correctness-sensitive refactor in the program — group bundle pricing, category rollup, tax breakdown and crew/sub-hire cost folding all live inside it. Its test is a differential one: for every fixture, `computeTotals` on the live version equals the stored `projects.*` that `recalcProjectTotals` wrote. |

**Also accepted from that review, folded into §4 rather than listed as decisions:** the sub-hire
join runs from the versioned line (`projectLineItems.subHireId`) to the live order, not from
`subHireItems` (which has no `lineItemId`), so the make-live conflict rule is evaluated line-side;
a `by_versionId_lineageId` index is required for lineage resolution (scan remap, crew links,
unplanned carry) and an in-version duplicate or kit explode mints a FRESH `lineageId`; the index
rename is `by_projectId_versionId`, not `by_versionId` alone, so project-scoped cross-version reads
(delete cascade, compare, budget pre-count, migration) stay cheap and the IDOR check stays
`projectId`-anchored; `PLAN_FIELDS` includes `depositPercent`, the `loadIn*`/`event*`/`loadOut*`
dates and `clientId`; and the batched copy is **dropped entirely** — `copyPlanGraph` refuses above
budget with `VERSION_TOO_LARGE` on create as well, which deletes the `copying` state, its spinner
row and the Phase 5 reactive dependency (production is an order of magnitude under the bound).
Unaccept is refused at CONFIRMED+ rather than being allowed to leave a confirmed project whose live
quote is merely `SENT`, closing the D20 invariant hole.

**Rollback runbook (D24).** If the Phases 2–4 release misbehaves: (1) `pnpm exec convex deploy` the previous
tagged functions; (2) re-add `by_projectId` and its composites to the five versioned tables in
`convex/schema.ts` (rows never lost `projectId`, so the index rebuilds from data); (3) leave
`projectVersions` and the new columns in place (they are `v.optional` and unread by the old code);
(4) non-live rows materialised by §6 step 2 would be visible to old readers, so step 2 runs only
after the release has soaked for one working day.

---

## 10. What already exists, and what is NOT in scope

### 10.1 What already exists (reused, not rebuilt)

The program is smaller than its phase count suggests because most primitives are already in the
repo and already tested. Rebuilding any of these would be the defect, not the plan.

| Existing | Where | Reused as |
|---|---|---|
| Parent-first copy with category → group → line id remapping | `convex/projectWrites.ts:1147` (`duplicateNative`) | The core of `copyPlanGraph`; extended with `categorySlots`, services and the full FK set |
| Re-pointing units and check records from one line to another | `convex/projectLineItems.ts` ~L930-965 (the merge-map path) | The make-live lineage carry |
| Entity-set diffing | `src/lib/project-snapshot-diff.ts` (`diffSnapshotEntries`) | Compare mode, retargeted from snapshot entries to row shapes |
| Warehouse-vs-plan field split | `LINE_ITEM_WAREHOUSE_FIELDS`, `CREW_WORKFLOW_FIELDS` (`convex/lib/projectSnapshots.ts:337`) | The blank-on-copy / carry-on-make-live column list |
| Lock copy, chip, strip, `LockedField`, `GatedButton` | `src/lib/lock-copy.ts` + `src/components/` (#990) | The one strip and every greyed warehouse verb (D15) |
| Registry-driven exhaustive IDOR sweep | `convex/xtenantExhaustive.test.ts` | The shape of the live-only sweep |
| Static ratchet with a CI baseline | `scripts/xtenant-bycuid-ratchet.mjs` | The shape of `version-scope-ratchet.mjs` |
| Immutable stored finance artifacts | `convex/financeArtifacts.ts`, `src/server/finance-documents.ts` (#987) | Unchanged; the migration must keep sent PDFs byte-identical |
| Playwright harness with DB reset | `e2e/harness-*.spec.ts` | The journey spec (D29) |
| Org aggregation pattern for finance lists | `convex/financeOrg.ts` (#992) | The batched version read (D31) |

### 10.2 NOT in scope

Considered and deliberately excluded. Each would be a separate program.

| Excluded | Why |
|---|---|
| **Versioning crew assignments and sub-hire orders** (D16) | They are commitments to third parties, not plan. Copying them clones POs and crew offers, and their replies/shifts/timesheets would need lineage side-tables. They stay live and link by lineage. |
| **Optional line items / single-select sections on a quote** (D11) | Real and wanted, but it changes the `DocumentLineItem` shape and triggers the PDF consumer audit. Phase 8, its own design doc. |
| **Client-facing option picking** (the client choosing between two sent quotes in a portal) | No client portal exists; quotes are PDFs the operator sends. Would need an entire authenticated client surface. |
| **Per-version invoices** | Invoices stay one project-level ledger, lineage-labelled (D3 of the original program). Versioning them competes with VOID + reissue, which is the accounting-correct model. |
| **Retro-snapshotting pre-versioning revisions** | A revision with no captured content stays `contentState: "missing"`. Manufacturing content from today's rows would fabricate a version that never existed. |
| **Org-level version reporting** ("all options out across all jobs") | The org Finance section already answers the quote-level question. No demand for a version-level one. |
| **Merging two versions** | Nobody asked; the workflow is pick one and make it live. Would need three-way diff semantics on equipment. |
| **Real-time collaborative version editing** | Convex is already reactive, so two people editing one version works. Presence/conflict UI beyond that is not in demand. |
| **Retiring the CONFIRMED/COMPLETED audit snapshots** | Kept read-only for one release (D10), then decided separately. They serve audit, not versioning. |

---

## 11. POLICY.md notes (BUILD mode)

- **R-3.1** — one version identity (`projectVersions`), one live pointer, one lock resolver, one
  strip, one diff engine, one restore path (none: make-live is a pointer flip), one version list.
  The five-copy `SnapshotEntityType` union and the two counters are removed rather than
  documented as exceptions.
- **R-9.3** — `liveVersionId`, `versionId`, `lineageId`, `pricingLocked` are server-owned and stripped
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

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (scope set by the driver's own 21 decisions) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | codex CLI not installed in this environment |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 15 issues (3 architecture, 4 code quality, 2 test, 1 performance, 4 cross-model), 0 unresolved, 1 critical gap closed (migration PDF byte-identity) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | mockups reviewed inline with the driver (7 artboards, 2 revisions) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE VOICE:** 1 run (Claude subagent, codex unavailable). 11 findings; 4 became decisions D33–D36, 6 folded into §4 as corrections, 1 (strategic ROI) answered by the driver's own use case (Roundhouse UNSW, two PA options quoted in parallel).
- **SPEC REVIEW:** 3 adversarial rounds on the design doc, 5/10 → 7/10 → 8/10, 45 issues fixed, 0 open.
- **CROSS-MODEL:** the cold read and the outside voice independently identified the plan/commitment boundary (crew and sub-hires) as the scope error, and independently flagged `duplicateNative` and the merge-map re-point as existing primitives the plan was rebuilding. Both were accepted.
- **UNRESOLVED:** 0.
- **VERDICT:** ENG CLEARED — ready to implement. Start with Phase 0 (the spike).
