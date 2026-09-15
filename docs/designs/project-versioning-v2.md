# Project versioning v2 — versions as switchable workspaces

> _Owner: Jayden Nawotka · Created: 2026-09-15 · Status: **decisions recorded 2026-09-15 (§9) — ready for `/plan-eng-review`; engineering review complete (§9.2, D22–D32); one reading still to confirm (§9.1)**_

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
carries an explicit **`pricingLocked`** flag (set when a quote goes out), and the **live** version
additionally carries the project's lifecycle lock. Unlock sessions, their private snapshots, `PRE_PROMOTE` auto-saves,
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
| **Project** | The job: identity, number, client, lifecycle status, `liveVersionId`, everything that is not versioned (§4.6), **and the live version's plan fields and totals** (§4.2 swap model) | A container of line items |
| **Version** | A complete, independently editable copy of the job's **plan** (§4.6), numbered `v1…vN` in creation order, optionally labelled. Every project, templates included, has at least one. | A quote, a snapshot blob, a lifecycle event |
| **Live** | The one version the warehouse, availability, bookings and invoices follow. A pointer. | "Latest" — v2 can be live while v5 exists |
| **Quote** | An immutable **document** issued from a version: PDF bytes + money snapshot + dates + recipient + outcome (sent → accepted / declined / recalled / superseded / expired). The pre-send row (today's `DRAFT`) is the send dialog's working record and is deleted with its version. | The version's identity |
| **Invoice** | Issued from the **live** version only; records `versionId` for lineage; project-level ledger | Versioned |
| **`pricingLocked`** (D18) | An explicit flag on the version, set by send, cleared by recall, **kept** after superseded / declined / expired. While set, every field the quote priced is refused: prices, discounts, quantities of priced lines, rental window, tax, billing overrides. Structure (adding a line) stays allowed on the **live** version at $0 with the Unpriced badge; a non-live locked version is fully read-only because nothing operational happens to it. | Derived from quote status at read time (that is the I-11 defect) |
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
  pricingLocked: boolean,               // D18. set by sendNative, cleared by recallNative
  pricingLockedAt?, pricingLockedById?,
  contentState: "ready" | "copying" | "missing",  // "copying" while a batched copy is in flight; "missing" for a pre-versioning revision with no captured content
  // PLAN FIELDS — present ONLY on non-live versions (swap model, below):
  rentalStartDate?, rentalEndDate?, projectStartDate?, projectStartTime?, projectEndDate?, projectEndTime?,
  billingWeeksOverride?, billingDaysOverride?, taxRate?, discountPercent?, discountAmount?,
  clientContactId?, locationId?, siteContactName?, siteContactPhone?, siteContactEmail?,
  type?, description?, crewNotes?, internalNotes?, clientNotes?,
  // RECALC OUTPUTS — present ONLY on non-live versions (D21):
  subtotal?, taxAmount?, taxBreakdown?, taxStatus?, total?, margin?, equipmentRevenue?, saleRevenue?,
  serviceRevenue?, saleCostTotal?, serviceCostTotal?, labourCostTotal?, subHireCostTotal?,
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
projects.liveVersionId: string          // v.optional on arrival, required after the backfill (§6)

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
// pricingLocked, label, labelOnDocument move to projectVersions; snapshotId, protected* are removed;
// recalledPdfFileIds is KEPT under its current name (no rename)

// invoices
invoices.versionId: string              // replaces sourceRevision (number)

// REMOVED: projects.revision, projects.liveRevision, projectSnapshots.revision,
//          reasons QUOTE_SENT | VERSION_SAVED | PRE_PROMOTE, projectUnlockSessions (§4.9)
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
   through the same index; a template's single version is never `pricingLocked`.)
2. `number` is unique per project and never reused; gaps are honest.
3. **Exactly one quote row per version** (created lazily by the first send). **Any number of
   `SENT` quotes across versions** (D19); **at most one `ACCEPTED` per project**; accepting one
   supersedes every other open quote. Re-sending a version **reuses its row**: status back to
   `SENT`, the previous PDF pushed onto `recalledPdfFileIds`, nothing superseded (today's
   recall→resend shape, #1027).
4. `assertVersionWritable(ctx, version, { fields })` is the one guard every versioned-table
   mutation calls: a money field on a `pricingLocked` version is refused (`PRICING_LOCKED`); any
   structural write on a `pricingLocked` **non-live** version is refused (`VERSION_LOCKED`); the
   live version additionally passes through the lifecycle tier (§4.5). It replaces
   `assertLifecycleGuard`'s quote arm and `bypassQuoteLock`.
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
| **Edit** | every tab | the existing `*Native` mutations, now taking `versionId` (optional in the public API, default live) | Guard: `assertVersionWritable`. |
| **Rename** | panel | `versions.setLabelNative` | |
| **Send quote** | strip, panel, Finance | `quotesWrites.sendNative({ versionId })` | **Any** version. Sets `pricingLocked`, renders the PDF; a re-send reuses the version's row (invariant 3). Never supersedes another version's quote (D19). |
| **Recall** | Finance | `recallNative` | Clears `pricingLocked`; PDF retained. Kept as the pre-client typo fix. |
| **Accept** | Finance, strip | `quotesWrites.acceptNative({ quoteId })` | **Accept = make live in the same transaction** (D20): the dialog embeds the make-live summary and conflicts; on confirm the version goes live, the quote is `ACCEPTED`, every other open quote is `SUPERSEDED`, `CONFIRMED` is offered. `CONFIRMED` always requires the **live** version's quote to be `ACCEPTED` or the existing admin override. |
| **Decline** | Finance | unchanged | |
| **Unaccept** | Finance (owner) | `unacceptNative` | `ACCEPTED → SENT` on the document only. It does **not** flip `liveVersionId` back and does **not** un-supersede the other quotes (they were superseded by a business decision, re-send them if needed). Refused once an invoice has been issued from the version or gear has been checked out (`UNACCEPT_TOO_LATE`). |
| **Make live** | strip, panel, compare | `versions.makeLiveNative({ versionId })` | §4.8. Not blocked by issued invoices (D6). |
| **Compare** | header menu, panel, strip | `diffSnapshotEntries` retargeted to row shapes | A **mode on the real page** (§5 item 6). The five-copy `SnapshotEntityType` union (I-2) collapses to ONE definition in `src/lib/project-snapshot-diff.ts`, typed from the row validators; the engine's inputs become `{ table, rows }` pairs for the two versions. |
| **Delete** | panel | `versions.deleteNative` | Live: never. Non-live and never sent: manager; deletes its rows and its pre-send quote row. Ever sent: the existing owner-only, typed-confirm, audit-surviving path, which erases the quote row and its PDF too (#1029's decision), so nothing dangles. **Refused** while an invoice carries its `versionId` (`VERSION_REFERENCED`). Crew and sub-hire lineage links are unaffected (they resolve against live). |
| **Duplicate project / Save as template / Create from template** | existing | `duplicateNative` (also the instantiate-a-template path, `projectWrites.ts:1201`), `saveAsTemplateNative` | Both go through `copyPlanGraph`; copy the **live** version by default, `fromVersionId?` optional; the result starts at v1. |

Removed verbs: Save version, Reprice from revision, Recall-to-edit, Protect/Unprotect, Unlock
session (open/commit/discard). Correction stays (a metadata fix on the document, not the version).

### 4.5 The locking matrix — explicit, one table, shown in the UI

`resolveLocks(project, version) → { money: Perm; structure: Perm; planFields: Perm; warehouse: Perm; exit: Exit }`
where `Perm = "allowed" | "unpriced" | "justify" | "locked"` and `Exit` names the affordance the
strip shows. The strip and every `LockedField`/`GatedButton` read this one result.

| Situation | Money fields | Structure (add/remove/qty) | Plan fields (dates/client/notes) | Warehouse verbs | Exit |
|---|---|---|---|---|---|
| Non-live, not locked | allowed | allowed | allowed | greyed (D15) | — |
| Non-live, `pricingLocked` | locked | locked | locked | greyed | New version from it · Recall |
| Live, OPEN status, not locked | allowed | allowed | allowed | allowed | — |
| Live, OPEN status, `pricingLocked` | locked | unpriced ($0 + badge, drift flagged) | locked (window/tax are priced) · notes allowed | allowed | New version · Recall |
| Live, CONFIRMED / PREPPING / CHECKED_OUT | locked | unpriced | notes allowed, dates justify | allowed | New version → make live |
| Live, ON_SITE / RETURNED | locked | justify | justify | allowed | New version → make live |
| Live, COMPLETED / INVOICED | locked | locked | locked | locked | New version → make live (admin/PM + justification) |
| Any, CANCELLED | locked | locked | locked | greyed | Re-open status (D5, justified from CONFIRMED+) |

Two rules replace today's three mechanisms:
- **`pricingLocked` ⇒ priced fields locked everywhere; structure locked unless live** (D18). The
  live version must be able to take on-site reality; that reality is flagged as drift against the
  client's document by the strip (the `QuoteDriftIndicator` component is deleted; its state
  moves into `VersionStrip`).
- **Lifecycle ⇒ applies to the live version only.** "Unlock" is gone: you change a locked live
  job by making a new version and making it live. Making live on a locked project is the gated,
  audited act (`invoice:publish` up to RETURNED; `isHardLockOverrideAllowed` + justification at
  COMPLETED/INVOICED), which is exactly where the existing override audience and justification
  bounds are reused (R-3.1).

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
version's lines (`{ viewedVersionId }`). The `excludeProjectId` occurrences (25 across 6 non-test files outside `availabilityCore.ts`) are the seam.
The substitution is invisible in the UI. Warehouse and outbound verbs (prep, check-out,
dispatch, send crew offer, send supplier PO) stay **visible but greyed** on a non-live version
through the existing `GatedButton` pattern (`aria-disabled`, tooltip: "v3 isn't live. Make it
live to prep or check out."), so a PM sees at a glance which actions belong to the live version
(D15). The tab is otherwise identical.

### 4.8 Make live, and the copy primitive

```
makeLiveNative({ versionId: K })            // K ≠ liveVersionId, K.contentState === "ready", not a template-only op
 1. permission + lifecycle gate (4.5)        // the ONE place the lock bites for versions;
    //  at COMPLETED/INVOICED takes `justification` (a privileged arg, needs its policy row in
    //  src/lib/api/privileged-args.ts) with the existing 10–1000 bounds
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
`bypassQuoteLock`; `recallNative`'s un-supersede branch (`quotesWrites.ts:455-461`, meaningless once
send no longer supersedes across versions); `quotes.version` (number) in Phase 7, derived through
`versionId` → `projectVersions.number` until then (R-3.1).

**The sweep — the honest cost of "same components for every version":** every read of a
versioned table by project has to become a read by version. Counted on 2026-09-15 by grepping
`withIndex("by_projectId` on each table's queries in `convex/` (excluding tests):

| Table | `by_projectId` reads | `by_projectId_*` composite reads | Other index reads the ratchet must cover |
|---|---|---|---|
| `projectLineItems` | ~30 | ~24 (`_status`, `_sortOrder`) | `by_modelId`, `by_assetId`, `by_kitId`, `by_bulkAssetId`, `by_categoryId`, `by_groupId`, `by_parentLineItemId`, `by_organizationId*` |
| `projectServices` | ~14 | 3 | `by_lineItemId`, `by_crewRoleId`, `by_organizationId*` |
| `projectGroups` | ~12 | 10 | `by_categoryId`, `by_organizationId` |
| `projectCategories` | ~6 | 6 | `by_organizationId` |
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
   (mockup 2). Absent when there is nothing to say (live, open, nothing sent).
3. **A non-live version is the real page.** Same tabs, same rows, same inline editing, same add
   menu, same availability column (mockup 3); only warehouse verbs are absent.
   Tasks/Files/Comments stay live with the existing inline note.
4. **Frozen reads as read-only, not disabled** (Carbon): text stays legible, field chrome
   changes, a tooltip names the exit. `LockedField`/`GatedButton` are kept and now read the
   matrix in §4.5.
5. **Make live states what changes before it runs** (mockup 6): changes, what stays, warehouse
   conflicts, and the paperwork consequence ("Quote v3 hasn't been sent").
6. **Compare is a mode on the real page** (mockup 7): comparing v3 with v4 renders v3 in the
   normal tabs with changed rows highlighted in place and old → new values in the cells,
   unchanged rows dimmed, a change count on each tab, and the strip carrying the summary, the
   change stepper and "Make v3 live". No bespoke diff table. This is the reading of
   "comparisons should feel similar to editing a project" (§9.1, to confirm).
7. **Words.** "Version", "Live", "Frozen", "New version from vN", "Make vN live". Never
   "snapshot", "revision", "promote", "restore", "unlock session".

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
5. Refuse to run while any unlock session is `OPEN`.
6. Every removed field stays declared `v.optional` for one release (the `depositPercent`
   precedent), then a cleanup backfill strips it.

---

## 7. Phases

| # | Phase | Scope | Effort | Depends |
|---|---|---|---|---|
| **0** | **Spike** | Rename `by_projectId*` → `by_versionId*` on `projectLineItems` in a scratch branch; classify every site (live-job vs version-specific vs cross-project); prove `duplicateNative` scoped to a version and a `lineItemMergeMaps`-style re-point of units/check records on a fixture | S | — |
| **1** | **Model + live backfill** | `projectVersions`, optional `versionId`/`lineageId`/`liveVersionId`, `copyPlanGraph` extracted from `duplicateNative`, backfill of the LIVE version only (§6 step 1), coalescing helpers, invariants 1–2 + tests. Ships alone: live tables unchanged in meaning. | M | 0 |
| **2** | **Reads and writes by version** | The sweep (§4.9): index rename incl. composites, every tab's data hook and every `*Native` mutation take `versionId`, `liveRows` helper, `assertVersionWritable` threaded through every mutation, version-aware recalc (D21), the viewed-version availability path (§4.7), ratchet, exhaustive live-only test; then §6 step 2 materialisation, which is the first moment non-live rows exist. | L | 1 |
| **3** | **Make live + version verbs** | `makeLiveNative` with lineage re-pointing, plan-field/totals swap, conflicts and the size budget; `createNative`/`setLabelNative`/`deleteNative`; accept = make live (D20; exercised on the live version only until Phase 6 lets send target a non-live one); delete the promote/restore/auto-capture machinery | M | 2 |
| **4** | **Lock simplification** | Retire unlock sessions + `bypassQuoteLock` + `protected`; lifecycle lock applies to live only; `assertVersionWritable` needs the version threaded through every `*Native` mutation, so this follows the sweep; justification threaded through add/update (closes I-14); CANCELLED decision (I-15) | M | 2 |
| **5** | **UI** | Version menu, Versions panel, `VersionStrip`, Make-live dialog, Compare, Finance tab documents rail, delete the projected read-only surfaces | L | 2, 3, 4 |
| **6** | **Quotes from any version** | `sendNative({versionId})`, multiple SENT with one ACCEPTED (D19), accept = make live from a non-live version (D20), locked non-live rendering, drift against the sent document | M | 3, 5 |
| **7** | **Cleanup + docs** | Remove dead tables/fields after one release; FEATUREDOCS 62/66/70 rewritten as one doc; `docs/glossary.md`; CLAUDE.md conventions | S | 6 |
| **8** | **Optional line items** (D11) | Client-facing optional lines / single-select sections on a quote: `optional` + `optionGroup` on line items, excluded from totals until chosen, chosen state recorded on accept. Touches the `DocumentLineItem` shape, so the CLAUDE.md two-consumer PDF audit applies. Own design doc before build. | M | 6 |

Phases 1–4 are server-only; 1 ships alone (a live-only backfill leaks nothing), 2–4 ship together behind the existing UI. Phase 5 is
the big visible change. Phases 0–4 ≈ L, the whole program ≈ XL at human-team scale.

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

## 9. Decisions (Jayden, 2026-09-15)

| # | Decision |
|---|---|
| **D1** | **Non-live versions are directly editable.** A version is a workspace. This commits to the §4.9 sweep. |
| **D2** | ~~A version is a full snapshot including crew assignments and sub-hires.~~ **Superseded by D16** after the cold read; the plan-only scope stands. |
| **D3** | **A quote can be sent from any version**, not only the live one. Accepting a non-live version's quote offers "Make vN live". |
| **D4** | **Unlock sessions are retired.** Changing a locked live job is: new version → edit → make live. Per-edit justification stays for ON_SITE structural edits on the live version. |
| **D5** | **The four lifecycle tiers stay**, applied to the live version only. CANCELLED from CONFIRMED+ is gated with a justification (closes I-15). |
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
| **D18** | **`pricingLocked` is an explicit flag on the version** (set by send, cleared by recall, kept after superseded/declined/expired): priced fields locked everywhere; structure adds allowed on the live version at $0; a locked non-live version is read-only (§4.5). |
| **D19** | **Multiple SENT quotes may be out at once, one per version; at most one ACCEPTED per project;** accepting one supersedes the others; re-sending supersedes only that version's own earlier document. |
| **D20** | **Accept = make live in the same transaction.** CONFIRMED always requires the live version's quote to be ACCEPTED or the admin override. |
| **D21** | **Recalc is version-aware and totals are stored per version**: `projects.*` for the live version, `projectVersions.*` otherwise, swapped on make-live. |
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
| **D27** | **New error codes** (`PRICING_LOCKED`, `VERSION_LOCKED`, `VERSION_NOT_LIVE`, `LINE_NOT_LIVE`, `VERSION_REFERENCED`, `VERSION_TOO_LARGE`, `UNACCEPT_TOO_LATE`) map through `resolveLockCopy` so toasts name the exit; `isJustificationRequired` recognises `UserFacingError` (closes I-14). |
| **D28** | **ASCII diagrams in code** as acceptance criteria of Phases 2–3: version × quote state machine in `convex/versions.ts` (replacing `quotesWrites.ts`'s old one), the make-live pipeline in `makeLiveNative`, the swap in `convex/lib/planHome.ts`, the lock matrix in `convex/lib/projectLocks.ts`. |
| **D29** | **One Playwright journey spec** `e2e/harness-versions.spec.ts` (create → new version → edit → send → accept/make live → warehouse follows) on the existing harness, in CI's e2e job. |
| **D30** | **Order-independence tests** for scan-then-make-live and make-live-then-stale-scan (units end on the live lineage), plus the no-lineage-match `unplanned` carry. |
| **D31** | **`financeOrg` loads `projectVersions.by_organizationId` once per call** and groups several SENT quotes per project into one row; a read-count assertion in `financeOrg.test.ts`. |
| **D32** | Housekeeping folded into Phase 7: stale doc references (I-16) and stale phase comments (I-17). |

**Rollback runbook (D24).** If the Phases 2–4 release misbehaves: (1) `pnpm exec convex deploy` the previous
tagged functions; (2) re-add `by_projectId` and its composites to the five versioned tables in
`convex/schema.ts` (rows never lost `projectId`, so the index rebuilds from data); (3) leave
`projectVersions` and the new columns in place (they are `v.optional` and unread by the old code);
(4) non-live rows materialised by §6 step 2 would be visible to old readers, so step 2 runs only
after the release has soaked for one working day.

---

## 10. POLICY.md notes (BUILD mode)

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
