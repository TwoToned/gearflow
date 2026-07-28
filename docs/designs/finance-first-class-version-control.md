# Finance as a first-class, version-controlled workflow

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-07-28
**Driver:** Jayden — _"I want to make the finance (quoting, invoicing stuff) a first-class
citizen and streamlined workflow, compliant with version control and such."_ Three concrete
asks: (1) real quote versioning wired into the quoting workflow, (2) a structured Finance
menu on projects that owns quote send/versioning/dates/PDF instead of "rogue pressing the
documents button", (3) project locking that is **visible** rather than a toast that fires
after you've already tried something.
**Supersedes/extends:** WS1 (#940, FEATUREDOCS/66) shipped the finance *entities*;
#957/#791/#792/#793 (FEATUREDOCS/62) shipped the lock *enforcement*. This doc is the
workflow and UX layer neither of them built.
**Tracking:** [#985](https://github.com/TwoToned/gearflow/issues/985) (sub-issues #986–#990).
**Owning docs to update:** [FEATUREDOCS/66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md),
[FEATUREDOCS/62](../../FEATUREDOCS/62-project-lifecycle-locks.md),
[FEATUREDOCS/13](../../FEATUREDOCS/13-pdfs.md),
[FEATUREDOCS/10](../../FEATUREDOCS/10-projects.md).

---

## 1. Problem — what's actually in the repo today

Verified against the codebase on 2026-07-28, not from the docs.

### 1.1 There are three unrelated "version" mechanisms, and none is the one we want

| Mechanism | What it is | Why it isn't versioning |
|---|---|---|
| `projectSnapshots` + `projectSnapshotEntries` | Whole-project entity snapshots | Captured **automatically** at CONFIRMED / COMPLETED / UNLOCK only (`crossesIntoSnapshotStatus`). Not user-driven, unnamed, unnumbered, invisible outside a ⋯-menu panel. |
| `quotes.version` | A number bumped inside `publishNative` | Derived at publish time by scanning existing rows (`convex/quotesWrites.ts` L60-72). Never surfaced as a workflow. No draft state, no send, no dates, no recall. |
| The PDF | `generatePdf(projectId, orgId, "quote")` | Reads **live project state** (`src/lib/pdfme/build-document-data.ts`). Reads the `quotes` table **not at all**. |

### 1.2 The central defect: a sent quote is not reproducible

`/api/documents/[projectId]?type=quote` renders from whatever the project looks like **right
now**. Two clicks a week apart produce two different documents under the same name, and the
document the client is holding exists nowhere in the system. `quotes.snapshot` freezes
money — but the PDF never consults it, and the snapshot doesn't carry the line
descriptions, client block, dates, terms or notes needed to re-render the page anyway.
`quotes.pdfFileId` is declared in `convex/schema.ts` (L2089) and has **zero readers and zero
writers** — a placeholder nobody wired.

The same is true of invoices: `invoices` are documented as "immutable once ISSUED", and the
row genuinely is — but the **artifact** is still live-rendered from the project on every
click, so the immutability guarantee stops at the database boundary.

### 1.3 Finance has no home in the UI

`ProjectFinancePanel` (306 lines) is mounted at the **bottom of the Financials tab**, below
the billing summary, the unlock banner, the financial summary, a divider, the costs panel and
another divider. Publishing a quote is a bare button with no dialog — no quote date, no
valid-until, no recipient, no preview, no confirmation. Meanwhile the header's **Documents ▾**
dropdown offers "Quote / proposal" and "Invoice" as one-click live PDFs, entirely outside the
finance workflow. That dropdown is the "rogue" path.

Also in that panel: a `window.confirm()` for the advance-to-INVOICED prompt
(`project-finance-panel.tsx` L109) — against CLAUDE.md's "no `AlertDialog` — use `Dialog`"
convention and DESIGN.md.

### 1.4 The locks are real on the server and nearly invisible on the client

The server side is genuinely good: one `assertLifecycleGuard`, one tier table, stable
`ConvexError` codes, ~25 gate sites. The client side is one mount:

```
src/app/(app)/projects/[id]/page.tsx:155   const lockStatus = useProjectLockStatus(id, orgId)
src/app/(app)/projects/[id]/page.tsx:570   <UnlockSessionBanner …>   ← inside the Financials tab
```

That's the **entire** consumption surface. Which means, verified by grep:

- **No lock indication in the project header**, on the lifecycle stepper, or anywhere outside
  the Financials tab. A locked project looks identical to an open one.
- **The Equipment tab is fully interactive on a locked project** — every price input, every
  add/remove control is enabled. You find out it's locked from a red toast, after the fact.
- **`useJustifiedMutation` has zero call sites.** It is built, smoke-tested, exported and
  wired into nothing (FEATUREDOCS/62 admits this under "Wiring status"). Every ON_SITE+
  structural edit therefore fails with a `JUSTIFICATION_REQUIRED` toast and no way to
  supply the justification.
- **`UnpricedBadge` has zero call sites.** New items silently default to $0 with no visual
  marker, which is precisely the case the badge exists for.
- **No lock indicator on the project list, board, or cards** — you can't tell before opening.
- **The deferred gate sites are still open** (FEATUREDOCS/62 "Deliberately deferred"):
  `bulkDeleteServicesNative`, `bulkUpdateServiceStatusNative`, `generateServicesNative`,
  `cloneServicesNative`, `convertLineItemToServiceNative`, `reorderNative`,
  `bulkDeleteNative`, `bulkStatusNative`, `generateShiftsNative`. Any UI that claims "locked"
  while these write is lying.

### 1.5 Consequence

The three asks are one problem. Quote versioning without immutable artifacts is theatre;
a Finance menu without a lock is a suggestion; a lock without UI is a trap. They share one
spine, and this doc builds that spine once.

---

## 2. Locked decisions (Jayden, 2026-07-28)

1. **One shared revision number.** `projects.revision` is the single counter. Project v2 ==
   Quote v2 == the snapshot taken at v2. A new project is v1 with a draft Quote v1. There is
   no second counter anywhere.
2. **Sending a quote locks pricing; cutting a new version is the unlock.** Structural adds
   stay possible on a sent revision but land at $0 (the existing `defaultToZero` behaviour).
   A **Recall** action un-sends for pre-client typo fixes, audited.
3. **Acceptance is required to confirm, admin-overridable.** A revision must be `ACCEPTED`
   before the project advances to `CONFIRMED`; org admins/owners and the project's PMs can
   override with a bounded justification, reusing the existing hard-lock-override audience
   and justification plumbing.
4. **Quote and Invoice leave the Documents dropdown.** Documents keeps warehouse artifacts
   only. Client-facing finance documents come from the Finance tab: the stored immutable
   artifact for a sent revision / issued invoice, plus an explicitly watermarked **DRAFT
   PREVIEW** before sending.

Refined 2026-07-28 (second pass):

5. **No quote numbering engine.** A quote is identified by its project number + version —
   `RVLT-2026-0087 v2`. No `QTE:` counter, no new org settings, no second numbering surface
   to keep in sync. The project number is already the shared reference with the client.
6. **Invoices get full parity** with the quote workflow: a real issue dialog with invoice
   date, due date and notes. This also fixes a live bug — `dueDate` is plumbed all the way
   through `issueNative` (`convex/invoicesWrites.ts` L214-242) but the UI's `issueInvoice(id)`
   never passes it, so **every invoice issued today has no due date at all**.
7. **"Send" means freeze + generate, not email.** Flow records that you sent it (date,
   recipient, version), freezes pricing and produces the PDF; you attach it to your own
   email. This holds the #934 "no client-facing emails" decision. The button still reads
   "Send quote" because that's the real-world act, but the dialog says plainly that Flow
   doesn't email the client.
8. **Rental dates stay editable after a send, but drift is flagged loudly.** Gigs move;
   locking dates would fight operational reality. Instead the Finance tab and lock strip
   surface "this project has changed since quote v2 was sent", with what changed (§6.5).
9. **Finance gets an org-level home** — a `/finance` section, not only a per-project tab
   (Phase F, §6.6). Today finance is visible one project at a time, so nothing is chaseable.
10. **Quotes do not push to Xero.** Flow owns the quote end to end; Xero only ever sees the
    invoice. Two systems holding divergent quote versions is the exact failure this program
    exists to remove.
11. **Send/accept = manager+ (`invoice:publish`); recall = admin/owner or the project's PM.**
    Un-sending a document the client may already hold is trust-sensitive, so it reuses
    #792's narrower `isHardLockOverrideAllowed` audience rather than the general permission.
12. **Production has effectively no live quote/invoice data** (confirmed by Jayden) — the
    #940 features shipped recently and haven't been used in anger. The backfill is therefore
    a simple forward migration, not a defensive one (§8).

---

## 3. Target model — the quote revision is the unit of version control

### 3.1 One number, three tables

```
projects.revision : number         ← the authority (starts at 1 on create)
  quotes.version  = revision it was cut from   (exactly one quote row per revision)
  projectSnapshots.revision                    (the frozen entity state for that revision)
```

`projects.revision` is **recalc-adjacent but not recalc-owned**: it is written only by the
two revision mutations below, stripped from every generic client patch the same way
`PROJECT_MONEY_ANCHORS` already are (`convex/projectWrites.ts`). Never client-supplied.

**Identity.** A quote has no document number of its own (decision 5). It is referred to
everywhere — UI, PDF header, filename, audit log — as `<projectNumber> v<version>`, e.g.
`RVLT-2026-0087 v2`. `src/lib/project-number.ts`'s engine is untouched by this program;
only invoices keep their `INV:`-namespaced counter.

**Invariants (server-enforced, tested):**
- Exactly one quote row per `(projectId, revision)`. The existing
  `by_projectId_version` index becomes the uniqueness check.
- At most one `DRAFT` quote per project, and it is always at `projects.revision`.
- At most one `SENT` quote per project (the one the client is holding).
- `projects.revision` is monotonic. Never decremented, never reused — a recalled-then-
  re-sent revision keeps its number, a superseded one is never reissued.

### 3.2 Revision lifecycle

```
        project created
              │
              ▼
        v1  DRAFT ──── send ────▶ v1  SENT ──── accept ────▶ v1  ACCEPTED ──▶ project may CONFIRM
              ▲                     │  │  │
              │                     │  │  └── decline ─────▶ v1  DECLINED
              └──── recall ─────────┘  │
                                       └── new version ────▶ v2  DRAFT   (v1 → SUPERSEDED on v2's send)
                                                                  │
                                                    valid-until passes
                                                                  ▼
                                                            v1  EXPIRED
```

`QuoteStatus` (`convex/lib/validators.ts` L449) goes from
`DRAFT | PUBLISHED | SUPERSEDED` to
`DRAFT | SENT | ACCEPTED | DECLINED | SUPERSEDED | EXPIRED`.
`PUBLISHED` is renamed to `SENT` (backfill in §7) — "published" was never accurate; nothing
was published anywhere.

**Supersede timing:** v1 stays `SENT` while v2 is a draft. It only flips to `SUPERSEDED` when
v2 is actually sent. There is always exactly one document that represents "what the client
currently has", and cutting a draft never invalidates it. This is the difference between a
version-control system and a delete button.

**EXPIRED** is derived-on-read, not a cron — `validUntil < now && status === "SENT"` renders
as expired and blocks acceptance without an explicit re-send. No scheduled job, no clock
skew, no stale row. (Consistent with FEATUREDOCS/66's "readiness is derived" precedent.)

### 3.3 The five verbs

| Verb | Mutation | What it does |
|---|---|---|
| **Send** | `quotesWrites.sendNative` | Freezes the revision: captures the finance snapshot (`buildFinanceLines`, unchanged) **and** a `revision` snapshot via `captureProjectSnapshot`, stamps the user-chosen `quoteDate` + computed `validUntil` + recipient contact, schedules artifact render (§4), sets `SENT`, supersedes the previous `SENT` row, raises the project's lock state (§5), offers to advance `ENQUIRY/QUOTING → QUOTED`. |
| **Recall** | `quotesWrites.recallNative` | `SENT → DRAFT` on the current revision. Marks the stored artifact `recalled` (retained for audit — never deleted; the client may already have it). Requires `invoice:publish` + a bounded reason. Drops the lock back. |
| **New version** | `quotesWrites.newVersionNative` | Increments `projects.revision`, inserts a `DRAFT` quote at the new number, releases the pricing lock. The previous `SENT` row is untouched until the new one sends. |
| **Accept** | `quotesWrites.markAcceptedNative` | `SENT → ACCEPTED` with an acceptance date + optional reference (PO number, email subject). Unblocks `CONFIRMED`. |
| **Decline** | `quotesWrites.markDeclinedNative` | `SENT → DECLINED` with a bounded reason. Offers `CANCELLED`, never forces it. |

All five: the standard 4-guard browser-direct shape (FEATUREDOCS/54) — `assertWritesEnabled`,
`enforceBrowserWriteLimit`, `requireOrgPermission`, `resolveActor` — plus `assertRefInOrg`,
plus `writeActivityLog`. `sendNative` keeps `assertLifecycleGuard(…, { kind: "financial" })`
so a hard-locked project can't emit a new quote out of band.

**Permissions (decision 11).** Send, new-version, accept and decline check
`invoice:publish` — owner/admin/manager, the existing audience. **Recall additionally
requires `isHardLockOverrideAllowed`** (org admin/owner, or a member of the project's
`projectManagers` set — `convex/lib/projectLocks.ts`), because un-sending a document the
client may already be holding is a trust-sensitive act. No new permission resource is
introduced; both checks already exist.

**"Send" does not email anyone (decision 7).** Flow stamps the revision as sent, freezes
pricing, and produces the PDF. The dialog states this outright so nobody assumes the client
was contacted — which is the failure mode of naming a button "Send" in a product that
doesn't deliver mail (#934: "no client-facing emails — PDFs sent manually / by Xero").

**Money still never originates from the client** (R-9.3). The send dialog's only inputs are
`quoteDate`, `validityDays`, `recipientContactId`, `notes`. Every figure comes from
`buildFinanceLines` + the project's recalc-owned totals, exactly as `publishNative` does today.

### 3.4 Acceptance gate on CONFIRMED

`projectWrites.updateStatusNative` gains one check on transitions landing on `CONFIRMED`:

```ts
if (to === "CONFIRMED" && !(await hasAcceptedQuote(ctx, project))) {
  await requireHardLockOverrideAllowed(ctx, orgId, projectId, actor.userId);  // reuse #792's audience
  assertStrLen(justification, "justification", { min: 10, max: 1000 });       // reuse #793's bounds
}
```

Reuses the existing override audience and justification bounds — no new permission, no new
dialog primitive, no second copy of the bounds (R-3.1). The client pre-checks and shows the
override dialog rather than letting the server 
throw first, using the same `useJustifiedMutation` pattern.

---

## 4. Immutable artifacts — the PDF becomes the record

### 4.1 Render-and-store at the freeze moment

The moment a quote is sent (or an invoice issued), the PDF is rendered **once** and the bytes
stored, then never regenerated:

```
send/issue ──▶ Next.js server action (pdfme runs in Node, not Convex)
                 └─▶ generatePdf(...)  ──▶ uploadToS3()  [= Convex _storage, src/lib/storage.ts]
                       └─▶ storageId ──▶ quotes.pdfFileId / invoices.pdfFileId
```

Chosen over "reconstruct the document from the snapshot at render time" because it is the only
option that is *actually* immutable: a reconstruction path re-executes ~1,400 lines of
`build-document-data.ts` + the composer against a snapshot that would need to grow to carry
every token, and any future change to that code silently changes historical documents. Storing
bytes makes the guarantee structural rather than disciplinary — the same reasoning as
`withValidatedBody` in CLAUDE.md.

`src/lib/storage.ts` already routes to Convex `_storage`, and `storedFiles` already carries
the org row the `/api/files/{storageId}` proxy authorises against — so this is a new caller of
an existing, org-checked path, not new infrastructure.

**Failure handling.** Render failure must not silently produce a `SENT` quote with no
document. `sendNative` writes the row inside the Convex transaction; the artifact render runs
immediately after in the server action and patches `pdfFileId`. A quote in `SENT` with a null
`pdfFileId` renders a "Document still generating / failed — retry" state in the Finance tab
with a `regenerateArtifactNative`-style retry that is only callable while `pdfFileId` is null.
Never a silent gap, never a second render path for a quote that already has one.

### 4.2 Draft preview

`GET /api/documents/[projectId]?type=quote&preview=1` stays, but:
- requires `invoice:read`,
- renders a **DRAFT PREVIEW — NOT SENT** watermark block (new `LayoutBlock` kind in
  `document-layouts.ts`; layouts are plain TS per the #790 redesign, so this is a block, not a
  template),
- is reachable **only** from the Finance tab's send dialog and the draft revision row.

### 4.3 Artifact retrieval

`GET /api/finance/quote/[quoteId]/pdf` and `/api/finance/invoice/[invoiceId]/pdf` — org-checked,
stream the stored bytes, `Content-Disposition` naming the revision
(`RVLT-<projectNumber>-quote-v2.pdf`). No regeneration path. A recalled or superseded
revision's artifact stays downloadable, badged with its state.

### 4.4 PDF data-shape audit (CLAUDE.md standing rule)

The new watermark block is a **new `LayoutBlock` kind**, not a `DocumentLineItem` shape
change — so the three-consumer audit (`gearflow-table.ts` render,
`document-composer.ts` `calculateItemHeight`, `getFilteredParentItems`) applies only to the
composer's block-height switch, which must reserve height for the watermark block. That
reservation gets a `document-composer.test.ts` case. No line-item shape changes anywhere in
this program — confirmed by walking the send path: it consumes `buildFinanceLines`, which is
the *data-model* snapshot builder and explicitly not the PDF's line structuring
(FEATUREDOCS/66 §"Money is never hand-typed").

---

## 5. Unified lock state — one precedence table, two inputs

**The risk here is a second lock mechanism**, which would be an R-3.1 defect on the most
safety-critical code in the app. So the quote-send lock is not new machinery: it becomes a
second *input* to the existing one.

`convex/lib/projectLocks.ts` `lockTierForStatus(status)` → `resolveLockTier({ status, quoteState })`:

| Status tier | Current quote state | Effective tier | Unlock affordance offered |
|---|---|---|---|
| OPEN (`ENQUIRY`/`QUOTING`/`QUOTED`) | none, or `DRAFT` | **OPEN** | — |
| OPEN | `SENT` or `ACCEPTED` | **FINANCE_LOCKED** | **"Create quote v(N+1)"** (primary) · "Recall quote" (secondary) |
| FINANCE_LOCKED (`CONFIRMED`+) | any | **FINANCE_LOCKED** | Unlock session (existing) |
| JUSTIFY (`ON_SITE`/`RETURNED`) | any | **JUSTIFY** | Unlock session / per-edit justify (existing) |
| HARD_LOCKED (`COMPLETED`/`INVOICED`) | any | **HARD_LOCKED** | Full unlock session (existing) |

Properties that make this safe:
- **Monotonic.** A quote state can only *raise* the tier, never lower it. A sent quote on a
  COMPLETED project doesn't soften anything.
- **One function.** Every one of the ~25 existing gate sites keeps calling
  `assertLifecycleGuard` unchanged; only the guard's internal tier resolution learns about
  quotes. Zero new gate sites, zero new call-site edits.
- **The reason is carried.** `LifecycleGuardResult` gains `reason: "STATUS" | "QUOTE_SENT"` so
  the UI can say _why_ and offer the right unlock. `LockTier` values are unchanged, so
  `FINANCIALS_LOCKED` / `PROJECT_LOCKED` codes and their toast mappings still apply.
- **`defaultToZero` is unchanged** — a quote-sent project defaults new adds to $0 exactly like
  a CONFIRMED one, which is precisely the desired behaviour for "gear added after the quote
  went out".

`projectLocksRead.status` returns the new `reason` + the current quote revision/state so the
client renders one coherent banner from one query.

---

## 6. The Finance tab

### 6.1 Promotion

`Finance` becomes a **top-level project tab** (Equipment · Labour & logistics · **Finance** ·
Tasks · Notes · Files). The money-summary content currently on "Financials" moves in; the
existing `financials` tab is retired, not duplicated. Templates keep hiding it, as today.

### 6.2 Layout

```
┌─ Finance ─────────────────────────────────────────────────────────────┐
│  Lock strip:  🔒 Pricing locked — Quote v2 sent 26 Jul                  │
│               [ Create quote v3 ]  [ Recall v2 ]                       │
├────────────────────────────────────────────────────────────────────────┤
│  ⚠ Changed since v2 was sent: 3 lines added, rental window +2 days      │
│                                            [ See what changed ]        │
├────────────────────────────────────────────────────────────────────────┤
│  Totals:  Subtotal · Discount · GST · Total · Margin                   │
│           Deposit invoiced · Invoiced to date · Outstanding            │
├────────────────────────────────────────────────────────────────────────┤
│  QUOTES                                          [ Send quote v3 ▸ ]   │
│   ○ v3  Draft      —            $18,400   [Preview draft]              │
│   ● v2  Sent       26 Jul 26    $18,120   [PDF] [Diff v1→v2] [Accept]  │
│   ○ v1  Superseded 19 Jul 26    $16,900   [PDF] [Diff]                 │
├────────────────────────────────────────────────────────────────────────┤
│  INVOICES                              [ Deposit ] [ Balance ] [ Full ]│
│   ● INV-2026-0043  Deposit  Issued  25 Jul  $4,530  [PDF] [Xero ✓]     │
│   ○ (draft)        Balance  —               $13,590 [Issue] [Delete]   │
└────────────────────────────────────────────────────────────────────────┘
```

Each revision row: version, state chip (`status-colors.ts` intents — never hardcoded per
DESIGN.md §3), quote date, valid-until (amber when within 3 days, red when expired), total,
who sent it, and its actions. There is no quote document number (decision 5) — the row reads
`v2` and the PDF header reads `Quote — RVLT-2026-0087 v2`. Clicking a row opens the read-only
"as of v N" view — which is `project-versions-panel.tsx`'s existing snapshot summary +
`project-snapshot-diff.ts`'s existing diff, now reachable from the workflow instead of a ⋯
menu. The ⋯ "Versions" entry stays as a deep link; the panel is not duplicated.

### 6.3 Send dialog

The one place a quote leaves the building. Radix `Dialog` (no `AlertDialog`), fields:

- **Quote date** — user-set, defaults to today; this is the date printed on the PDF and the
  anchor for validity. (Today: hardcoded `now` in `build-document-data.ts` L743.)
- **Valid for** — days, defaults to `OrgDocumentSettings.quoteValidityDays` (30). Shows the
  resolved date. (Today: computed from `now` at render time, so a re-render silently *extends*
  a quote's validity — a real correctness bug this fixes.)
- **Recipient** — client contact picker (`resolveClientContactDisplay` exists), stamped onto
  the revision so "who was this sent to" is answerable.
- **Notes to client** — the existing `quotes.notes`.
- **Read-only summary** — line count, subtotal, GST, total, and an explicit
  _"Sending freezes pricing at v N. To change prices afterwards, create v N+1."_
- **[ Preview draft PDF ]** (watermarked) and **[ Send quote v N ]**.

No monetary input anywhere in this dialog. The footer states plainly: _"Flow doesn't email
clients — this generates the PDF for you to send."_ (decision 7).

### 6.4 Invoice issue dialog (decision 6)

Invoices get the same treatment, because "or an invoice willy nilly" was half the original
complaint. Radix `Dialog` on **issue** (not on draft creation, which stays one click):

- **Invoice date** — user-set, defaults to today
- **Due date** — defaults to invoice date + `OrgDocumentSettings.paymentTermsDays` (**new
  setting**, default 14). Today `dueDate` is fully plumbed through `issueNative`
  (`convex/invoicesWrites.ts` L214-242) but `issueInvoice(id)` never passes it, so **every
  invoice issued today carries no due date** — an outright bug this closes.
- **Notes** and a **read-only amount summary** (server-computed; the deposit % and balance
  math are unchanged)
- **[ Preview ]** (watermarked) and **[ Issue INV-… ]** — the number is still assigned
  server-side at issue, the one numbering moment (FEATUREDOCS/66)

The existing "advance the project to INVOICED?" chain moves into this dialog's success path
as a proper `Dialog`, replacing `window.confirm`.

### 6.5 Drift indicator — "changed since v2 was sent" (decision 8)

Rental dates and gear stay editable after a send; the drift is made loud instead
(§2 decision 8). **This costs almost nothing to build**, because the pieces already exist:
`sendNative` captures a snapshot for the revision, `collectCurrentEntries` reads current
state through the identical shape, and `diffSnapshotEntries` already compares them. Drift is
just that diff, rendered as a summary line.

- Shows when a `SENT`/`ACCEPTED` revision exists and its snapshot differs from current
- Summarises by kind — lines added/removed, prices changed, rental window moved, services
  or crew changed — and "See what changed" opens the full existing diff view
- Appears on the Finance tab and in the lock strip, so it's visible from any tab
- Distinct from `StalePricingBanner`, which answers a different question ("stored prices no
  longer match what current dates would derive" → offers Recalculate). Drift answers "the
  job no longer matches the document the client is holding" → offers "Create quote v3".
  Both can be true at once; they are not merged.

### 6.6 Documents dropdown

Loses "Quote / proposal" and "Invoice". Keeps Pull slip, Delivery docket, Return sheet, Call
sheet, Project timeline. The `typeMap` entries for `quote`/`invoice` in
`src/app/api/documents/[projectId]/route.tsx` survive only behind `preview=1` + permission.

### 6.7 Org-level Finance section (decision 9 — Phase F)

Per-project finance can't be chased. A `/finance` nav section answers the questions nobody
can currently ask without opening projects one at a time:

- **Quotes out** — sent, awaiting acceptance, sorted by age
- **Expiring** — `validUntil` inside 7 days, and already-expired
- **Never sent** — draft revisions sitting on active projects
- **Confirmed but uninvoiced** — accepted/confirmed jobs with no issued invoice
- **Deposit due** — `DEPOSIT_BALANCE` clients whose deposit invoice hasn't issued
  (the existing derived nudge, lifted to org scope)
- **Outstanding** — issued invoices unpaid, once the Xero payment poll lands (FEATUREDOCS/66
  phase 2); until then the section renders issued-and-unreconciled

**Performance constraint, learned the hard way:** this must be a **date-ranged aggregation
query, not a per-project loop**. #942 records that unbounded overbooking reads once
accounted for 77% of org DB I/O. Indexes to add: `quotes.by_organizationId_status`,
`invoices.by_organizationId_status` (exists), and a bounded default horizon.

---

## 7. Lock UX — making the lock legible

Design principle: **a lock must be visible before you try, explain itself, and offer the
exit.** Today it is invisible, unexplained, and exits only through a tab you weren't on.

### 7.1 Six surfaces

1. **Header chip** — next to the project status, always mounted:
   `🔒 Pricing locked` / `🔒 Locked` / `🔓 Unlocked by Jayden · 12m`. Click scrolls to the
   lock strip. Uses `status-colors.ts` intents.
2. **Lock strip** — one shared `<ProjectLockStrip>` rendered at the top of the project
   detail (not inside a tab), replacing the Financials-tab-only banner. States: locked (with
   reason + exit CTA), session open (with "Save & relock" / "Discard" + who + why), hard
   locked (with the restricted audience explained). One component, one `useProjectLockStatus`
   subscription, mounted once.
3. **Field level** — a shared `<LockedField>` wrapper renders money inputs read-only with a
   lock glyph and a tooltip naming the reason and the exit. Wrapping, not per-form `disabled`
   props, so there is one implementation to keep honest. Applies to: `price-edit-dialog`,
   `edit-line-item-dialog`, `line-item-form-fields`, `edit-group-dialog`, `add-service-dialog`,
   `crew-panel` rate fields, `bulk-edit-line-items-dialog`, and the project edit form's tax/
   discount inputs.
4. **Action level** — gated buttons render `aria-disabled` (**not** `disabled`, which would
   kill the tooltip) inside a `TooltipProvider` — remember there is no global provider — with
   a no-op handler and copy that names the exit. Per DESIGN.md §9.1 every interactive element
   needs its states declared, and "silently dead" is not one of them.
5. **Justify tier** — `useJustifiedMutation` + `JustificationDialog` threaded through every
   equipment / group / service / crew call site. The affected actions carry a small
   "needs a reason" hint at ON_SITE+ so the dialog isn't a surprise.
6. **List / board / cards** — a lock glyph on `project-table`, `project-board` and dashboard
   cards, so the state is knowable before opening. Sourced from status + quote state
   (both already on the row) — no extra query.

Plus: **`UnpricedBadge` finally gets mounted** on every $0-defaulted line and group, which is
the visual half of `defaultToZero` that was never wired.

### 7.2 Unlock session UX

- The strip shows elapsed time, who opened it, and the justification.
- **"Save & relock" shows the diff first** — `project-snapshot-diff.ts` already diffs the
  UNLOCK snapshot against current, and `collectCurrentEntries` already reads through the same
  code path. Committing blind is the one thing that turns an audit trail into noise.
- **"Discard"** shows the same diff plus the documented conflict caveat (warehouse-backed
  entities aren't force-restored — `isWarehouseBacked`).
- Sessions **auto-commit on status change** already (`autoCommitOpenSession`); the strip now
  says so before you transition.

### 7.3 Server parity (non-negotiable)

Every mutation the new UI presents as locked **must** actually be gated, or the UI is a lie.
The deferred gate sites from FEATUREDOCS/62 close as part of this program:
`bulkDeleteServicesNative`, `bulkUpdateServiceStatusNative`, `generateServicesNative`,
`cloneServicesNative`, `convertLineItemToServiceNative`, `lineItemWrites.reorderNative`,
`crewAssignmentsWrites.bulkDeleteNative` / `bulkStatusNative` / `generateShiftsNative`.

---

## 8. Data model changes

```ts
// projects
revision: v.optional(v.number()),            // authority; absent ⇒ 1 (read-time coalesce, backfilled)

// quotes — extended, not replaced
version: v.number(),                          // == the projects.revision it was cut from
status: QuoteStatus,                          // DRAFT | SENT | ACCEPTED | DECLINED | SUPERSEDED | EXPIRED
quoteDate: v.optional(v.number()),            // user-set, printed on the PDF
validUntil: v.optional(v.number()),           // derived at send from quoteDate + validityDays
sentAt / sentById: v.optional(...),           // replaces publishedAt/publishedById (backfilled)
recipientContactId: v.optional(v.string()),
acceptedAt / acceptedById / acceptanceRef: v.optional(...),
declinedAt / declinedById / declineReason: v.optional(...),
recalledAt / recalledById / recallReason: v.optional(...),
supersededByQuoteId: v.optional(v.string()),
pdfFileId: v.optional(v.string()),            // ← finally written
snapshotId: v.optional(v.string()),           // the projectSnapshots row for this revision

// invoices
pdfFileId: v.optional(v.string()),            // stored artifact, written at issueNative
invoiceDate: v.optional(v.number()),          // user-set at issue (decision 6)

// projectSnapshots
reason: … | v.literal("QUOTE_SENT"),
revision: v.optional(v.number()),

// OrgDocumentSettings (src/lib/org-settings-types.ts)
paymentTermsDays?: number;                    // default 14 — due-date default at issue
```

New indexes: `quotes.by_projectId_status`, `quotes.by_organizationId_status` (Phase F).
`by_projectId_version` becomes the uniqueness guard.

**No quote numbering fields** (decision 5) — no `quoteNumber`, no `QTE:` scope key, no new
`OrgSettings` numbering entries. `src/lib/project-number.ts` and `src/lib/invoice-number.ts`
are untouched by this program.

**Schema discipline:** `convex/schema.ts` is hand-maintained — never regenerate
(CLAUDE.md). Every new field is `v.optional` on arrival; nothing is removed from a validator
while live documents may still carry it (the `depositPercent` prod-deploy incident recorded in
FEATUREDOCS/66 is the standing precedent).

**Backfill** (`convex/backfill*.ts`, the established pattern). Production has effectively no
live quote/invoice data (decision 12 — the #940 features shipped days ago and haven't been
used in anger), so this is a **simple forward migration**, not a defensive one. The
originally-planned lazy-draft-on-first-load path is dropped as unnecessary complexity:

1. `projects.revision` ← `max(quotes.version)` for the project, else 1.
2. `quotes.status: "PUBLISHED"` → `"SENT"`; `publishedAt/ById` → `sentAt/ById`.
3. `quotes.quoteDate` ← `sentAt`; `validUntil` ← `sentAt + quoteValidityDays`.
4. Every project without a quote row gets a `DRAFT` v1 inserted directly — a bulk insert is
   fine at this data volume, and it means every project has a coherent revision from day one
   with no lazy-creation race to reason about.
5. Any pre-existing sent quote gets **no** artifact — its row renders "no stored document
   (pre-versioning)". Retro-rendering a historical quote from today's project state would
   manufacture a document that was never sent, which is the exact defect this program removes.

**Still run a count first.** "Effectively none" is a reasonable basis for choosing the simple
path, not a licence to skip verification — the migration logs the row counts it touched, and
a mismatch against expectation halts rather than proceeds.

---

## 9. Rollout — six phases, six issues under one tracker

Tracking issue: [#985](https://github.com/TwoToned/gearflow/issues/985).
Sequenced so each phase is independently shippable and nothing half-lands.

| # | Phase | Issue | Scope | Effort |
|---|---|---|---|---|
| **A** | Revision model + state machine | [#986](https://github.com/TwoToned/gearflow/issues/986) | `projects.revision`, quote schema + enum, the five verbs, acceptance gate on CONFIRMED, backfill, server tests | M |
| **B** | Immutable artifacts | [#987](https://github.com/TwoToned/gearflow/issues/987) | Render-and-store at send/issue, `pdfFileId` wiring, artifact routes, watermarked draft preview, Documents-menu removal | M |
| **C** | Unified lock state | [#988](https://github.com/TwoToned/gearflow/issues/988) | `resolveLockTier` (status × quote), `reason` plumbing, close the deferred gate sites, parity tests | S |
| **D** | Finance tab | [#989](https://github.com/TwoToned/gearflow/issues/989) | Tab promotion, quote rail + version history + diff entry, send dialog, **invoice issue dialog + due dates**, **drift indicator**, retire `window.confirm` | M |
| **E** | Lock UX | [#990](https://github.com/TwoToned/gearflow/issues/990) | Lock strip, header chip, `<LockedField>`, `aria-disabled` action pattern, `useJustifiedMutation` wiring, `UnpricedBadge` mounting, list/board glyphs, session diff-before-commit | M |
| **F** | Org-level Finance section | [#992](https://github.com/TwoToned/gearflow/issues/992) | `/finance` nav section — quotes out, expiring, never sent, confirmed-uninvoiced, deposit due, outstanding; aggregation query (not a per-project loop) | M |

**Dependencies:** A → B, A → C, (A,B,C) → D, C → E, (A,B,D) → F. D and E are parallelisable.

---

## 10. Test plan

- **Server (Convex, `convex-test`)** — revision monotonicity; one-draft/one-sent invariants;
  supersede-on-send-not-on-draft; recall round trip; acceptance gate incl. the admin override
  path; cross-org IDOR on every new mutation and both artifact routes (R-8.4.3); RBAC per
  role; `resolveLockTier` truth table across status × quote state (the whole matrix, since
  this is the safety-critical function); every newly-gated bulk mutation rejecting when locked.
- **Pure units** — expiry derivation across DST and timezone boundaries (`datePartsInTimezone`
  already exists); `validUntil` computation; the revision-diff selectors.
- **PDF** — `document-composer.test.ts` gains a watermark-block height case; an integration
  test asserting a sent revision's stored artifact bytes are byte-identical on repeat
  download while the live project changes underneath it. That test is the whole point of the
  program and should be named so.
- **jsdom smoke** — Finance tab renders and its overlays actually **open** (the standing
  `TooltipProvider` / Radix-in-modal footguns from CLAUDE.md); locked state renders read-only
  fields and the tooltip explains; `aria-disabled` actions are reachable by keyboard.
- **a11y** — lock states announced, not colour-only (DESIGN.md); `docs/a11y-manual-checklist.md`.
- **Drift** — `diffSnapshotEntries(sentRevisionSnapshot, currentEntries)` produces the
  expected summary for each change kind (line added/removed, price changed, dates moved),
  and produces *nothing* on an untouched project (zero-noise, mirroring
  `ProjectConflictsBanner`).
- **Org finance query (Phase F)** — asserted to be a single aggregation, not an N-project
  loop; a fixture org with many projects bounds the read count.

---

## 11. Resolved questions

- **Quote numbering?** No — project number + version (`RVLT-2026-0087 v2`). Decision 5.
- **Do quotes push to Xero as Xero Quotes?** No — Flow owns the quote end to end; Xero only
  sees the invoice. Two systems holding divergent quote versions is the failure this program
  exists to remove. Decision 10.
- **Does "Send" email the client?** No — it freezes and generates; you send it yourself. The
  dialog says so explicitly. Decision 7.
- **Do rental dates lock after a send?** No — they stay editable and drift is flagged loudly
  (§6.5). Decision 8.

## 12. Open questions

- **Multiple concurrent draft revisions?** Ruled out for v1 (one draft, always at
  `projects.revision`). Comparing two speculative options is a real workflow ("with and
  without the LED wall") but it is a *variant* feature, not a version-control one, and it
  would break the shared-counter model. Revisit separately.
- **Does a recalled quote's artifact stay downloadable?** Proposed yes (retained, badged
  `Recalled`) — the client may hold it, so deleting our copy makes the record worse.
- **Do invoices get revisions too?** No. An issued invoice corrects via VOID + reissue or a
  CREDIT note (FEATUREDOCS/66); that is the accounting-correct model and versioning it would
  compete with it.
- **Should `QUOTED` become automatic on send?** Proposed: offered, not forced (matches the
  existing "issuing offers to advance to INVOICED" UI-chain precedent) — but as a **Dialog**,
  not `window.confirm`.
- **CANCELLED remains ungated** — inherited open question from #957, unchanged here.

- **Duplicated projects / templates** — a duplicate starts at `revision: 1` with a fresh
  `DRAFT` v1 and copies no quote history; a template carries no revision at all. Assumed,
  not asked — say so if that's wrong.

---

## 13. POLICY.md compliance notes (BUILD mode)

- **R-3.1 / single source of truth** — one revision counter; one lock-tier resolver; the send
  dialog's validity math resolves through the same `quoteValidityDays` setting the PDF reads.
- **R-9.3 / server authority** — no monetary amount originates in the client; the send dialog
  accepts only dates, a contact and free text; artifact bytes are rendered server-side from
  server-computed data.
- **R-8.4.3 / cross-tenant reads** — `quotes.by_cuid` and `by_projectId` are global Convex
  indexes; every read of a quote, artifact or snapshot re-checks `organizationId`. The two new
  artifact routes are the highest-risk new surface and are IDOR-tested explicitly.
- **R-8.2.3 / R-8.6.2 / R-8.6.4** — send/accept/decline/recall forms get Zod schemas in
  `src/lib/validations/quote.ts` derived with `.omit()`/`.extend()` from one base, never
  re-declared; the artifact routes take no JSON body, so `withValidatedBody` doesn't apply,
  but any that gains one must use it.
- **Browser-direct write bar (FEATUREDOCS/54)** — every `*Native` mutation mirrors its Zod
  bounds server-side via `convex/lib/fieldGuards.ts`. Client validation is UX only.
- **R-5.2 / R-5.3 / R-5.8** — FEATUREDOCS 66, 62, 13, 10 and this doc update in the same PRs
  as the behaviour.
