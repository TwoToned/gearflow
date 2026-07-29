# Finance — Quotes, Invoices, Client Payment Profiles, Xero Integration

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

WS1 of #934 (#940) — the finance model. **RVLT Flow owns quote + invoice
generation; Xero owns the ledger, payment collection, and reconciliation.**
This reverses the earlier "no Flow-side finance" stance recorded in
`docs/designs/app-cleanup-unification.md` (P8/P9 — see that doc's reversal
note); `docs/ROADMAP.md` ("Finance repositioned") is the up-to-date decision
record. RVLT Flow still does **not** collect payments, run AU GST/BAS
reporting, or email documents to clients — those stay Xero's job.

## Architecture

```
Project (recalc-owned pricing) → Quote revision (snapshot, versioned) → PDF
                                → Invoice (Flow-numbered) → InvoiceLine (resolved Xero coding)
                                     → Xero draft invoice (push)
```

- **Quote revision** (`quotes` table) — see "Quote revisions (#986)" below.
  Sending freezes the project's CURRENT server-computed pricing (never trusts
  client-supplied money — R-9.3) into an immutable row.
- **Invoice** (`invoices` table) — `kind`: `FULL | DEPOSIT | BALANCE |
  CREDIT`. Created as `DRAFT`; `invoiceNumber` is assigned only at `issueNative`
  (the ONE numbering moment — drafts stay unnumbered). Immutable once
  `ISSUED` — a correction is `VOID` + reissue, or a `CREDIT` invoice.
  `paymentStatus` (`UNPAID | PARTIALLY_PAID | PAID`) is written only by a
  future Xero payment-status poll (phase 2, not built in this PR — see
  "Deferred" below); it is never client-writable.
- **InvoiceLine** (`invoiceLines` table) — snapshot rows under an invoice.
  `PARENT_JOIN` for org-export (no `organizationId` column — joined via
  `invoiceId` into the already org-scoped `invoices` row, same pattern as
  `supplierOrderItems`/`subHireItems`). Carries the RESOLVED
  `xeroAccountCode`/`xeroTaxType` per line, frozen at push time — an issued
  invoice's coding never changes retroactively when a model/kit/category
  mapping is edited later.

### Money is never hand-typed

`convex/lib/financeSnapshot.ts` `buildFinanceLines` is the SINGLE shared
line-breakdown builder behind both `Quote.snapshot` and `Invoice`/
`InvoiceLine` — it mirrors `recalcProjectTotals`'s own revenue-counting
rules (priced groups bill as one line, unpriced-group extras only when
`isCustomItem`/sub-hire, etc.) so a quote/invoice's lines always sum to the
totals `recalc.ts` already stored on the project. This is the DATA-MODEL
snapshot, not the PDF's own line structuring (`structure-line-items.ts`,
unchanged) — that pipeline stays presentation-only.

- **FULL** invoice: the project's full `subtotal`/`taxAmount`/`total`, full
  line breakdown.
- **DEPOSIT** invoice: % of the tax-**inclusive** total (matches the
  pre-#940 display math), with its own GST fraction computed from the
  project's tax rate — a real tax invoice, not a placeholder line. % defaults
  to the client's `profileDepositPercent` (or 25) when not overridden at
  creation.
- **BALANCE** invoice: server-computed as `total - Σ(non-VOID DEPOSIT
  invoices)`, never a client-supplied figure.
- **CREDIT** invoice: negates an already-`ISSUED` invoice's amounts
  (`creditForInvoiceId` back-reference).

`depositPaid`/`invoicedTotal` on the **project** are DERIVED in
`recalcProjectTotals` (summed from this project's `ISSUED` invoices — see
"Derive, don't hand-type" below), not the invoice-level fields above.

## Quote revisions (#986 — Phase A of #985)

WS1 shipped `quotes.version` as a number bumped inside `publishNative` by
scanning existing rows: no draft state, no send, no dates, no recall, and a
`DRAFT` literal nothing ever wrote. #986 replaced that with a real revision
model. The program-level design is
[`docs/designs/finance-first-class-version-control.md`](../docs/designs/finance-first-class-version-control.md).

### One counter, three tables

```
projects.revision : number         ← the authority (starts at 1 on create)
  quotes.version  = the revision it was cut from   (exactly one quote row per revision)
  projectSnapshots.revision                        (the frozen entity state for that revision)
```

Project v2 == Quote v2 == the snapshot taken at v2. There is deliberately **no
second counter** (R-3.1) and **no quote document number** — a quote is referred
to everywhere as `<projectNumber> v<version>` (`RVLT-2026-0087 v2`), because the
project number is already the shared reference with the client.
`src/lib/project-number.ts` and `src/lib/invoice-number.ts` are untouched.

`projects.revision` is **server-owned**: written only by `createNative` (seeded
to 1; templates carry none) and `quotesWrites.newVersionNative`, and stripped
from every generic client patch alongside `PROJECT_MONEY_ANCHORS`
(`PROJECT_SERVER_OWNED` in `convex/projectWrites.ts`). Absent reads as 1 via
`projectRevision()` — one coalesce, not one per call site.

### State machine

```
  v1 DRAFT ─ send ─▶ v1 SENT ─ accept ─▶ v1 ACCEPTED ─▶ project may CONFIRM
       ▲               │ │ │
       └─ recall ──────┘ │ └─ decline ─▶ v1 DECLINED
                         └─ new version ─▶ v2 DRAFT   (v1 → SUPERSEDED on v2's send)
```

`QuoteStatus`: `DRAFT | SENT | ACCEPTED | DECLINED | SUPERSEDED | EXPIRED`.

**Supersede fires on SEND, not on draft.** v1 stays `SENT` while v2 is a draft,
so there is always exactly one row representing "what the client currently has",
and cutting a draft never invalidates it. That is the difference between version
control and a delete button. **Recall reverses it**: un-sending v2 restores the
row it superseded to `SENT`, because v1 is then the last thing actually sent.

Supersede applies to an `ACCEPTED` revision as well, which has a consequence
worth stating outright: **acceptance does not survive a re-quote.** Accept v1,
then send v2, and `hasAcceptedQuote` goes false — the client agreed to v1's
price, not v2's, so the project needs v2 accepted (or an admin override) before
it can advance to `CONFIRMED` again. Cutting the v2 *draft* changes nothing; only
sending it does. A project that is ALREADY `CONFIRMED` stays confirmed — the gate
fires on transitions, not continuously.

**`EXPIRED` is derived on read**, never stored — `validUntil < now && SENT`
(`convex/lib/quoteState.ts` `effectiveQuoteStatus`). No cron, no clock skew, no
stale row, same precedent as the derived readiness chips below. Consumers MUST
branch on `effectiveStatus`, not the raw `status` column.

**`PUBLISHED` is deprecated** and normalises to `SENT` on read, so behaviour is
identical before, during and after the migration. It stays declared in the
validator until a backfill run confirms zero live rows carry it — strict Convex
schema validation rejects a push where an existing document has a value the
validator no longer declares (the `depositPercent` incident below is the
standing precedent).

### Server-enforced invariants (each has a test)

- Exactly one quote row per `(projectId, revision)` — `by_projectId_version` is
  the uniqueness guard.
- At most one `DRAFT`, always at `projects.revision`. Cutting v2 while v1 is
  still a draft is refused; edit the draft instead.
- At most one live (`SENT`/`ACCEPTED`) row — the document the client is holding.
- `projects.revision` is monotonic. Never decremented, never reused — a
  recalled-then-re-sent revision keeps its number.

### The five verbs (`convex/quotesWrites.ts`)

| Verb | Behaviour |
|---|---|
| **Send** (`sendNative`) | Freezes the revision: `buildFinanceLines` money snapshot + a `QUOTE_SENT` `captureProjectSnapshot` at the same revision, stamps `quoteDate`/`validUntil`/recipient, sets `SENT`, supersedes the previous live row, offers `ENQUIRY/QUOTING → QUOTED`. Creates the `DRAFT` row when the revision has none yet. |
| **Recall** (`recallNative`) | `SENT`/`EXPIRED` → `DRAFT` on the same revision, with a bounded reason. The artifact is marked recalled and **retained, never deleted** — the client may already hold it. Restores the row this send superseded. |
| **New version** (`newVersionNative`) | Increments `projects.revision` and inserts a `DRAFT` at the new number. The previous live row is untouched until the new one sends. A draft carries `snapshot: null` — its figures are the project's live totals until it is sent. |
| **Accept** (`markAcceptedNative`) | `SENT → ACCEPTED` + acceptance date + optional reference (PO number, email subject). An `EXPIRED` revision cannot be accepted without an explicit re-send. Unblocks `CONFIRMED`. |
| **Decline** (`markDeclinedNative`) | `SENT`/`EXPIRED` → `DECLINED` + bounded reason. Offers `CANCELLED`, never forces it. |

All five take the standard 4-guard browser-direct shape (FEATUREDOCS/54) plus
org-checked reference loads and `writeActivityLog`. `sendNative` and
`newVersionNative` keep `assertLifecycleGuard(…, { kind: "financial" })`, so a
hard-locked project can't emit a quote out of band.

**"Send" does not email anyone.** Flow records the send, freezes pricing and
(Phase B, #987) stores the PDF for the user to attach to their own mail. The UI
says so outright — naming a button "Send" in a product that doesn't deliver mail
is otherwise a trap. This holds the #934 "no client-facing emails" line.

**Money never originates from the client** (R-9.3). `sendNative`'s only client
inputs are `quoteDate`, `validityDays`, `recipientContactId` and `notes`.

### Permissions (split)

- **Send / new-version / accept / decline** → `invoice:publish`
  (owner/admin/manager — the existing audience, unchanged).
- **Recall** → additionally `isHardLockOverrideAllowed` (org admin/owner, or a
  member of the project's `projectManagers` set). Un-sending a document the
  client may already be holding is trust-sensitive in a way the other four verbs
  are not.

No new permission resource is introduced — both checks already existed.

### Acceptance gate on CONFIRMED

`projectWrites.updateStatusNative` refuses a transition landing on `CONFIRMED`
unless a revision is `ACCEPTED`. Org admins/owners and the project's PMs
override with a bounded justification, reusing #792's audience and #793's bounds
(`requireJustification` in `convex/lib/projectLocks.ts` — the bounds were
already duplicated inline there, so #986 collapsed them to one definition).

Only an actual transition INTO `CONFIRMED` is gated, so re-saving an
already-confirmed project never re-prompts. A re-crossing IS gated again,
matching `crossesIntoSnapshotStatus`'s own re-crossing rule — pricing may have
moved while the project was reverted.

### Validity and expiry

`src/lib/quote-validity.ts` is the SINGLE definition of the default (30 days),
the bounds (1–365) and the day-boundary maths; `convex/lib/quoteDates.ts` mirrors
it byte-for-byte (the Convex bundler can't resolve `@/`), pinned by
`convex/quoteDates.test.ts`. Before #986 the default was hand-copied into
`document-settings.tsx` and `build-document-data.ts` and the bounds into
`org-settings.ts` — three copies of two constants.

`validUntil` is the **end of its calendar day in the ORG's timezone**, resolved
two-pass so it survives DST in both hemispheres and half/quarter-hour offsets. A
quote must not expire a day early for a PM in another state. It is stamped ONCE,
at send, and only read back — the pre-#986 PDF computed validity from `now` at
render time, so re-opening a quote silently extended how long it was valid.

### Backfill

`convex/backfillQuoteRevisions.ts` + `scripts/convex-backfill-quote-revisions.ts`.
Production has effectively no live quote data, so this is a simple forward
migration: `revision ← max(quotes.version)` else 1; `PUBLISHED → SENT`;
`publishedAt/ById → sentAt/ById`; `quoteDate`/`validUntil` derived on the org's
calendar day; and a `DRAFT` v1 inserted for every project with no quote row.

Pre-existing sent quotes get **no artifact** — retro-rendering one from today's
project state would manufacture a document that was never sent, which is the
exact defect this program removes. Their rows show the retry action rather than a
download; taking it renders from current state, which is a deliberate,
user-initiated choice and not something the migration does behind their back.

"Effectively none" is a basis for choosing the simple path, not a licence to skip
verification. The driver counts first, **halts** on a mismatch against
`--expect-quotes` before writing anything, and fails the run unless
`verifyQuoteRevisions` reads zero un-migrated rows afterwards.

### Not in Phase A

The unified status × quote-state lock tier (shipped — #988), the real Finance
tab with its send and invoice-issue dialogs and drift indicator (shipped —
#989, see "The Finance tab" below), lock UX (shipped — #990), and the
org-level Finance section (shipped — #992, see "Org-level Finance section"
below) remained.

## Immutable documents (#987 — Phase B of #985)

A quote's money was already frozen at send and an invoice's row was already
immutable once ISSUED — but the **document** was live-rendered on every click,
so both guarantees stopped at the database boundary. Now the PDF is rendered
once, at the freeze moment, and the bytes are kept:

```
sendNative / issueNative  (Convex transaction — the row)
        └─▶ src/server/finance-documents.ts  (server action — the document)
              generatePdf() ─▶ uploadToS3() [Convex _storage] ─▶ storageId
                    └─▶ convex/financeArtifacts.ts attach*Artifact
                          └─▶ quotes.pdfFileId / invoices.pdfFileId
```

Chosen over "reconstruct the document from the snapshot on demand" because it is
the only option that is actually immutable: a reconstruction path re-executes
~1,400 lines of `build-document-data.ts` plus the composer against a snapshot
that would have to grow to carry every token, and any future change to that code
would silently rewrite historical documents. Storing bytes makes the guarantee
structural rather than disciplinary — the same reasoning as `withValidatedBody`.

### The rules

- **Attach once, never overwrite.** `attachQuoteArtifact` / `attachInvoiceArtifact`
  return `{ attached: false, pdfFileId }` when one is already there instead of
  replacing it. That is what makes exposing a retry button safe: a retry racing a
  slow first attempt loses harmlessly, and the server action bins its orphan
  upload.
- **Nothing deletes one.** A recalled, superseded, declined or voided row keeps
  its artifact — the client may be holding that copy, so destroying ours makes
  the record worse. The rail badges the state next to the download.
- **A draft has no artifact**, and the mutations refuse to give it one. Its only
  document is the watermarked preview, which is never stored.
- **Dates come from the row.** The render is handed the stamped
  `quoteDate`/`validUntil` (or an invoice's `issuedAt`), never `now`.
- **No regeneration path on read.** `/api/finance/{quote,invoice}/…/pdf` streams
  the stored bytes or 404s. A route that can regenerate is a route that can hand
  the client a different document under the same name.

### Failure handling

The render runs after the Convex transaction commits, so it can fail on its own.
A `SENT` quote (or `ISSUED` invoice) with a null `pdfFileId` is therefore a real
state, and it is never silent: the row renders "Document missing — generate", and the
retry is only reachable while `pdfFileId` is null. The send/issue itself is never
rolled back for a render failure — the money is frozen either way.

### Surfaces

| Surface | Behaviour |
|---|---|
| Quote revision row | Download (stored artifact) · Preview draft (watermarked) · Document missing — generate. Exactly one of the three, always — the wording covers a failed render and a pre-#987 row alike, neither of which is a state the user should have to guess at. |
| Invoice row | Same three states, keyed on `issuedAt` instead of `sentAt`. |
| Header **Documents ▾** | Warehouse artifacts only. "Quote / proposal" and "Invoice" are gone — that dropdown was the rogue path. |
| `/api/documents/[projectId]?type=quote` | 400 without `preview=1`; with it, requires `invoice:read` and stamps DRAFT PREVIEW — NOT SENT on every page. |

Permissions: `invoice:read` to download or preview, `invoice:publish` to
generate/retry a quote artifact, `invoice:issue` for an invoice one — the same
audiences that can send and issue in the first place. Both routes carry explicit
cross-org tests (`quotes.by_cuid`/`invoices.by_cuid` are GLOBAL indexes,
R-8.4.3).

## The Finance tab (#989 — Phase D of #985)

The structured workflow that replaces "press the Documents button and hope."
`Finance` is now a top-level project tab (`Equipment · Labour & logistics ·
Finance · Tasks · Notes · Files`) — the old `Financials` tab's content
(`StalePricingBanner`, the unlock banner, `FinancialSummary`, `ProjectCostsPanel`)
moved in wholesale rather than being duplicated; only the tab's `value`/label
changed (`financials` → `finance`). Full UI/UX spec:
[`docs/designs/finance-workflow-ux.md`](../docs/designs/finance-workflow-ux.md).

### Send dialog (`src/components/projects/finance/send-quote-dialog.tsx`)

Replaces the bare "Send quote" button that used to call `quoteWrites.send(projectId)`
with no data at all. Captures quote date (defaults today), valid-for days
(defaults from `OrgDocumentSettings.quoteValidityDays`), a recipient — the
client's contacts via `useClientContacts` fed into the Radix `combobox-picker.tsx`
(**never** a Base UI popup — it would inherit the modal Dialog's
`pointer-events: none` body lock and swallow every click, CLAUDE.md) — and
notes. **No monetary input** (R-9.3): the read-only summary renders the
project's own recalc-owned `subtotal`/`taxAmount`/`total`. Does not close on
success — it becomes the handover state (Download PDF / Copy summary for email
/ Done), with a passive, non-forcing offer to advance the project's status
when `sendNative` returns `offerStatusChange`. Footer states outright that Flow
doesn't email the client (decision 7, #934).

### Invoice issue dialog (`src/components/projects/finance/issue-invoice-dialog.tsx`)

Same treatment on **issue** (draft creation stays one click): invoice date, due
date (defaults to invoice date + the new `OrgDocumentSettings.paymentTermsDays`,
default 14 — `src/lib/invoice-terms.ts` / `convex/lib/invoiceDates.ts`, mirrored
like `quote-validity.ts`/`quoteDates.ts`), notes, and a read-only amount
summary. **This closes a live bug**: `issueNative` always accepted a `dueDate`
argument, but the panel called `invoiceWrites.issue(id)` with none at all, so
every invoice issued before #989 has no due date. `invoices.invoiceDate` is a
new field (distinct from the `issuedAt` system timestamp) so a re-opened
invoice's printed date never depends on `issuedAt` alone.

### Revision viewer + reprice-from-revision

`src/components/projects/finance/quote-revision-viewer-dialog.tsx` reuses the
existing snapshot/diff plumbing (`convex/projectLocksRead.ts`'s
`snapshotEntries`/`currentEntries`, `src/lib/project-snapshot-diff.ts`) that
`ProjectVersionsPanel` already exercises for whole-project snapshots — scoped to
one quote revision, with a two-item compare (`vs previous` / `vs the job now`,
D5 of the UX doc — not an arbitrary-pair matrix).

**"Use vN's pricing for v(N+1)"** (`convex/quotesWrites.ts`
`repriceFromRevisionNative`, `src/components/projects/finance/reprice-from-revision-dialog.tsx`)
is the forward-only equivalent of "Restore" that every version-history pattern
studied offers and this program deliberately doesn't — rewriting a SENT quote
in place would falsify the record of what a client was given. It composes
`newVersionNative`'s "cut the next draft" behaviour with
`restoreProjectSnapshot({ scope: "FINANCIAL" })` (already used by the unlock-
session FINANCIAL discard) in ONE transaction, writing **one** audit entry for
the whole operation. Structure (gear, quantities, dates) is untouched — only
the locked money fields move. The confirm dialog discloses, before running: how
many items added since the source revision have no price in it (they'll be
unpriced), and whether the rental window has moved since (shown only when it
actually has).

### Drift indicator (`src/components/projects/finance/quote-drift-indicator.tsx`)

"This job no longer matches the document the client is holding" — nearly free
to build, because `diffSnapshotEntries` already compares a sent revision's
frozen snapshot against current live state; this buckets the resulting rows by
kind (`src/lib/quote-drift.ts`) for a one-line summary. Renders nothing on an
untouched project (zero-noise). Deliberately distinct from
`StalePricingBanner`, which answers a different question ("stored prices no
longer match what current dates would derive" → offers Recalculate) — both can
be true at once and are not merged.

### Lock strip (`src/components/projects/finance/quote-lock-strip.tsx`)

Always mounted at the top of the Finance tab, reading the single
`useProjectLockStatus` subscription (now also surfacing `reason`/`revision`/
`quoteState`, extended from #988's `projectLocksRead.status`) so the tab
explains itself — "Pricing locked — quote v2 is with the client" vs. "this job
is confirmed" — instead of a bare "locked". The other five lock-legibility
surfaces (header chip, `<LockedField>`, `<GatedAction>`, list/board glyphs) are
Phase E (#990) — out of scope here; `lock-copy.ts` stays a single local
function until Phase E has a second caller to generalise it for.

### `window.confirm` is gone from the finance surface

The invoice panel's "Advance this project's status to INVOICED?" prompt (and
its quote-send equivalent, offered but never forced) are both Radix `Dialog`s
now — CLAUDE.md's "no `AlertDialog` — use `Dialog`" convention, DESIGN.md.

### `quoteStatusIntent()` (`src/lib/status-colors.ts`)

`DRAFT → neutral, SENT → info, ACCEPTED → primary, DECLINED → error,
EXPIRED/RECALLED → warning`; `SUPERSEDED` renders no pill at all (plain muted
text — a dead revision doesn't earn a filled shape). `Badge` gained `info`/
`primary` variants so SENT/ACCEPTED render in the SAME solid-red-is-live
vocabulary DESIGN.md defines, rather than being lossily mapped onto the
pre-existing ok/warn/overbooked set. Expiry is colour **and** words — "Valid
until 25 Aug (3 days left)" in warn inside `QUOTE_EXPIRING_SOON_DAYS`, "Expired
2 days ago" in the error tone past it — never colour alone (a11y).

## Org-level Finance section (#992 — Phase F of #985)

Every finance surface up to this point is per-project — there was no way to ask
"which quotes are sitting unanswered", "what expires this week", or "which
confirmed jobs never got invoiced" without opening projects one at a time. A
`/finance` nav item (sidebar, `invoice` resource, green hue) renders six
bounded sections in `convex/financeOrg.ts`'s single `bundle` query:

| Section | Definition |
|---|---|
| Quotes out | `effectiveStatus === "SENT"`, oldest (longest outstanding) first |
| Expiring | `SENT`/`EXPIRED` with `validUntil` inside `QUOTE_EXPIRING_SOON_DAYS` (7, `convex/lib/quoteDates.ts` — the SAME threshold the per-project Finance tab uses, R-3.1), including already-expired |
| Never sent | `DRAFT` revisions on active (non-template, non-`CANCELLED`) projects |
| Confirmed but uninvoiced | Project status `CONFIRMED` or later (excluding `CANCELLED`) with zero `ISSUED` invoices |
| Deposit due | Same CONFIRMED-or-later candidate set, client `paymentProfile === "DEPOSIT_BALANCE"`, no `ISSUED` `DEPOSIT` invoice — the per-project nudge chip (`project-finance-panel.tsx`) lifted to org scope |
| Outstanding | `ISSUED` invoices not `paymentStatus: "PAID"` — reflects issuance, not confirmed payment (the UI says so explicitly); full payment truth needs the Xero payment-status poll, still deferred (see "Deferred" below) |

### Perf — bounded, not a per-project loop (the #942 lesson)

`computeFinanceBundle` (shared by `bundle` and the cheap `counts` query, same
split as `overbookingBoard.ts`) does a small, fixed number of reads: a capped
`organizationId_status` index scan per raw quote status (`SENT`, the legacy
`PUBLISHED`, `DRAFT`), one capped scan per CONFIRMED-or-later project status
(same idiom as `dashboardStats.ts`'s `OPEN_MAINTENANCE_STATUSES` loop), one
capped `ISSUED`-invoice scan that feeds Outstanding, Confirmed-uninvoiced AND
Deposit-due simultaneously, then a referenced-only fan-out for any project/
client not already in scope. `SECTION_CAP` (200, exported for tests) is a
defensive ceiling, not the boundedness mechanism itself — each bucket is
bounded by *business state* (a row leaves the moment it's accepted/invoiced/
paid), the same reasoning `overbookingBoard.ts`'s date range provides for its
sections. `capped: boolean` in the response (and the dashboard/test-visible
`SECTION_CAP` export) is the signal if an org ever does exceed it.
`quotes.by_organizationId_status`, `invoices.by_organizationId_status` and
`projects.by_organizationId_status` all already existed on `main` before this
phase — no new indexes were needed.

### Deep links, not a second data model

Every row links to `/projects/{id}?tab=finance` — the project detail page
(`src/app/(app)/projects/[id]/page.tsx`) now seeds its `Tabs` from a `?tab=`
search param (falling back to `equipment`) purely so this screen has somewhere
to land; it's uncontrolled otherwise; no new tab-sync machinery. The page
itself renders nothing but what the aggregation returns — no client name
resolution, no dollar computation, nothing recomputed from `buildFinanceLines`
(R-9.3/R-3.1).

### Dashboard chips reuse the aggregation, not the logic

`useNativeOrgFinanceCounts` (`src/hooks/use-native-dashboard.ts`, mirroring
`useNativeOverbookingCounts`) backs two `NeedsAttention` chips ("N quotes
expiring", "N quotes out") that link to `/finance` — decision 9's "dashboard
chips link here rather than duplicating the logic."

### Filters — client shipped, PM and date-range deferred

The Finance page filters by client name (client-side, over the already-bounded
result set). PM and date-range were scoped out — see "Deferred" below — rather
than shipping a filter that shows raw ids or misrepresents which date it's
filtering on.

## Numbering (zero engine change)

Invoices reuse `src/lib/project-number.ts`'s template/scopeKey/counter engine
**verbatim** — same `renderProjectNumber`/`scopeKeyFor`/`datePartsInTimezone`,
same `projectNumberSequences` counter table, same
`reserveProjectNumberCounter` race-free RMW. The only addition is a namespace
prefix (`"INV:" + scopeKeyFor(...)`, see `src/lib/invoice-number.ts`
`INVOICE_SCOPE_PREFIX`) so the invoice counter and the project-number counter
never collide despite sharing a table. Default format `INV-%YYYY-%SEQ`,
`YEARLY` reset, 4-digit padding — configurable via `OrgSettings.invoiceNumberFormat`
/`invoiceNumberIncrementReset`/`invoiceNumberIncrementPadding`
(`src/lib/org-settings-types.ts`), validated the same way as
`projectNumberFormat` in `updateOrganization`. Unlike project numbers,
invoices have **no manual-entry fallback** — every issued invoice goes
through this engine.

## Derive, don't hand-type

- `clients.paymentProfile` (`FULL_UPFRONT | DEPOSIT_BALANCE`, absent =
  `FULL_UPFRONT`) + `clients.profileDepositPercent` (default 25) — the
  client payment profile now owns "how much deposit". `projects.depositPercent`
  is retired at the application layer (no reader/writer anywhere), but is
  **still declared `v.optional` in the schema** — the original hard removal
  broke the prod Convex deploy, because real pre-#940 wizard values were still
  stored on live project documents and strict schema validation rejects a push
  where an existing document has a field the validator no longer declares.
  `backfillStripProjectDepositPercent.ts` strips it from every project; once a
  run confirms zero remaining, the field can be fully deleted from the
  validator in a follow-up PR.
- `projects.depositPaid`/`invoicedTotal` — moved from "hand-typed wizard
  input, applied nowhere server-side" to recalc-OWNED
  `PROJECT_MONEY_ANCHORS` (same treatment as `equipmentRevenue`/`total`/
  `margin`): summed from this project's `ISSUED` invoices in
  `recalcProjectTotals`, stripped from every client patch regardless of
  lock tier. `issueNative`/`voidNative` call `recalcProjectTotals` directly
  so the derived figures update immediately, not on the next unrelated
  line-item edit.
- The wizard's old "Financial" edit-only block (Deposit %/Deposit
  paid/Invoiced total hand-typed inputs) is REMOVED. `financial-summary.tsx`'s
  client-side `total * depositPercent / 100` math is replaced with a real
  "Invoicing" block (Deposit invoiced / Invoiced to date / Outstanding) fed
  by the derived fields above.

## Lifecycle locks

Quote send/new-version and invoice create/issue/void go through the shared
`assertLifecycleGuard(ctx, project, { kind: "financial" })` (FEATUREDOCS/62)
— same FINANCE_LOCKED+ gate every other money-touching mutation uses. Phase C
(#988) folds quote state into the tier resolution itself (`resolveLockTier`),
so a sent revision raises the tier and "cut the next revision" becomes the
sanctioned exit; the gate sites don't change. No new project status was added
for "ready to invoice" — readiness is derived
(the payment-profile-driven "deposit not yet invoiced" nudge chips on the
project's Finance tab), and issuing a BALANCE/FULL invoice offers a UI-chain
prompt to advance the project to `INVOICED` (the EXISTING project status
update mutation — not a new nested mutation). Editing a project with an
issued, non-void invoice warns + requires confirmation; it never blocks.

## Permissions

New `invoice` resource (`convex/lib/permissionsCore.ts`):
`create/read/update/delete/publish/issue/void/xero_push/xero_manage`.
Owner/admin get everything; manager gets `create/read/update/publish/issue/
xero_push` (not `delete`/`void`/`xero_manage`); member gets `create/read`;
warehouse/viewer get `read` only. `xero_manage` gates connecting/
disconnecting Xero and editing coding settings — a more sensitive action
than day-to-day invoice pushing (`xero_push`).

## Xero integration

### Connection (OAuth2)

`src/server/xero.ts` (the permanent server-only carve-out — external I/O +
secrets, FEATUREDOCS/54's "HMAC/crypto tokens/external API" bucket, same
bucket as `woocommerce`) + `src/lib/xero-client.ts` (the actual HTTP client,
Zod-validated responses — POLICY.md R-8.2.3). `getXeroAuthorizeUrl()` builds
the authorize URL with an HMAC-signed `state` token (`src/lib/xero-oauth-state.ts`,
keyed off `BETTER_AUTH_SECRET`, 10-minute TTL) carrying `{orgId, userId}` —
the **public** callback route (`/api/integrations/xero/callback`, added to
`src/middleware.ts` `publicRoutes`) verifies the state instead of relying on
the session cookie surviving the external redirect through Xero's servers.
The refresh token is encrypted via `src/lib/crypto/secret-vault.ts`
(AES-256-GCM) before it ever touches `xeroIntegrations.refreshTokenEncrypted`;
no access token is persisted — it's minted from the refresh token on demand
and the ROTATED refresh token Xero returns is persisted immediately
(Xero invalidates the old one on every refresh).

**Scopes are granular, not the broad legacy set** — Xero split `accounting.transactions`
into granular scopes on 4 March 2026, and any Xero app created after that date is issued
ONLY the granular set, so `XERO_OAUTH_SCOPES` (`src/lib/xero-client.ts`) requests
`accounting.invoices` (covers invoices/credit notes/quotes — everything this integration
pushes), not the deprecated broad scope.

**The callback route's post-exchange redirect is built from `env.NEXT_PUBLIC_APP_URL`,
never `request.url`** — behind the prod reverse proxy, `new URL(path, request.url)`
resolves off whatever `Host` header Next's Node process sees internally, which isn't
guaranteed to be the public hostname (this shipped once, sending users to
`http://localhost:3000/settings/xero?xero_connected=1` after an otherwise-successful
token exchange). `xeroRedirectUri()` (same file, used to build the Xero-side
`redirect_uri`) already used the trusted env var; the callback's own redirect now
matches it.

### Account-coding cascade

`convex/lib/xeroAccountCascade.ts` — pure resolver functions, unit-tested at
every level:

**Equipment/kit line** (first non-null wins):
1. `projectLineItems.xeroAccountCode` (per-line override)
2. `models.xeroRentalAccountCode`/`xeroSaleAccountCode` (by line kind) OR
   `kits.xeroAccountCode` (kit-parent lines — a kit isn't a model)
3. `categories.xeroAccountCode`
4. `xeroIntegrations.defaultAccountCode` (org default)

**Service** (first non-null wins): line override → per-service-type default
(`xeroIntegrations.serviceAccountDefaults[LABOUR|DELIVERY_TRANSPORT|MISC]`) →
org default. **Tax type**: per-line override → `xeroIntegrations.defaultTaxType`.

**Group** (a priced `projectGroups` row bills as its own invoice line —
`convex/lib/financeSnapshot.ts` "priced groups bill as ONE line"): group
override → `projectGroups.categoryId`'s category default → org default. A
group isn't a model/kit, so it has no level-2 equivalent — reuses
`resolveEquipmentAccountCode` with `modelOrKitCode: null` rather than a
bespoke 2-level function (`resolveGroupLineCode` in `convex/xeroPush.ts`).

Resolved server-side at PUSH time (`convex/xeroPush.ts` `resolveCodingForInvoice`
— one Convex query, all the DB reads through model/kit/category/service-type/
org-default) and snapshotted onto `invoiceLines` — never re-resolved after
push. A variance note surfaces on the push result when a line's Xero tax type
diverges from the org default, so a coding override that implies a different
effective rate than Flow's own project-rate math is never silently invisible.

**Ambiguity resolved:** this app has no live SALE line-item workflow yet
(that's WS11/#950 — `models.xeroSaleAccountCode` exists as a field for it,
nothing else). Every equipment line resolves via the RENTAL branch of the
cascade today; the SALE branch is unit-tested but unreachable until #950
wires an actual sale line type.

### Per-entity coding override UI

Every level of the cascade above has a write path + form field:

- **Category default** — `categories.xeroAccountCode`, a labelled "Xero
  coding" section (border-separated, not just a bare field) on the category
  create/edit dialog (`src/components/assets/category-manager.tsx`) — this
  dialog has no `SmartFormSection`-style layout the way model/kit forms do,
  so the field needs its own visual heading to not blend into the plain
  field list around it.
- **Model defaults** — `models.xeroRentalAccountCode`/`xeroSaleAccountCode`,
  a "Xero coding" `SmartFormSection` on `src/components/assets/model-form.tsx`
  (rental and sale are independent — a kit-parent line reads `kits.xeroAccountCode`
  instead, since a kit isn't a model).
- **Kit default** — `kits.xeroAccountCode`, same pattern on
  `src/components/kits/kit-form.tsx`.
- **Line override** — `projectLineItems.xeroAccountCode`/`xeroTaxType`, on
  `src/components/projects/edit-line-item-dialog.tsx`. Note `lineItemWrites.patchNative`
  is a BLOCKLIST model (`LINE_IMMUTABLE_ON_PATCH`), not an allowlist, so these
  two fields technically already passed through server-side before this UI
  landed — what was missing was the client never sending them
  (`buildLineItemSetClear` in `src/hooks/use-line-item-writes.ts`) and no
  length bound (`assertLineItemFields` in `convex/lineItemWrites.ts`), both
  now added (R-8.6.2 — defense-in-depth on a blocklist mutation). Tucked
  behind a collapsed-by-default "Advanced: Xero coding" `Accordion` — this
  dialog is on the everyday line-editing path, unlike category/model/kit
  forms, so the override stays reachable without cluttering the common case.
- **Service override** — `projectServices.xeroAccountCode`/`xeroTaxType`, on
  the `ServiceDialog` in `src/components/projects/services-panel.tsx` — same
  collapsed-by-default `Accordion` treatment, same reasoning.
- **Group override** — `projectGroups.xeroAccountCode`/`xeroTaxType`, on
  `EditGroupDialog` (`src/components/projects/edit-group-dialog.tsx`) — same
  collapsed-by-default `Accordion` treatment (a group's own dialog is also on
  the everyday project-editing path). This dialog uses local `useState`, not
  React Hook Form, so the field is wired directly (`value`/`onChange`), not
  through a `Controller`. Sent as the raw string on every save, never
  `|| undefined` the way `description` is — an omitted/`undefined` key never
  reaches the Convex mutation at all (`JSON.stringify` drops `undefined`
  values), so "clear the override" would otherwise be silently lost instead
  of patching back to unset; `updateGroupNative`'s own `a.xeroAccountCode ||
  undefined` does the clear-on-empty-string itself.

Kit-parent project lines were the other explicit ask ("show up on kits...
when they [are] items on a project") — already covered by the line override
above without any extra work: a kit-parent row (`kitId` set, `isKitChild:
false`) opens the exact same `EditLineItemDialog` as any other equipment
line, with no kit-specific code path that would intercept or hide the Xero
section.

`MappedGroup` (both copies — `src/lib/project-equipment-reconstruct.ts` for
the client-safe equipment-tab bundle, `src/lib/project-line-item-read.ts` for
the server-side read path) and `GroupData`
(`src/components/projects/equipment-row-types.ts`) all needed the two new
fields threaded through explicitly — both are allowlist mappers over the raw
`projectGroups` doc, not passthrough spreads, so a new schema field is
invisible to either read path until added by hand.

All six write paths mirror `categorySchema`/`modelSchema`/etc.'s new
`.max(50)` bound server-side (`assertCategoryFields`/`assertModelFields`/
`assertKitFields`/`assertLineItemFields`/`assertServiceFields`/`assertStrLen`
calls in `updateGroupNative` — R-8.6.2, a browser-direct caller bypassing the
client Zod parse can't skip the bound).

**Shared UI**: `src/components/settings/xero-coding-fields.tsx` —
`XeroAccountCodeField`/`XeroTaxTypeField`, both self-gating on `useXeroLinked()`
(render `null` when unlinked, matching every other Xero-linked-only surface)
and sourced from the same `useXeroCodingOptions()` hook Settings → Xero's own
org-default pickers use (R-3.1 — one mapping from `xeroIntegrations.cachedAccounts`/
`cachedTaxRates` to `ComboboxPicker` options, not five copies). Every "Xero
coding" section on category/model/kit is itself conditionally rendered on
`useXeroLinked()` too — a titled section with self-gating-to-null fields
inside would otherwise show an empty section with no content, which reads as
broken.

**Codeless accounts are excluded from the picker, not just displayed oddly.**
`useXeroCodingOptions()` filters `cachedAccounts` down to `!!a.Code` before
mapping to `ComboboxPicker` options — Xero's Invoices API `AccountCode` field
takes the short account CODE, never the internal `AccountID` GUID, so an
account with no code was never a valid selection regardless. This also fixed
a real bug: the old fallback `a.Code ?? a.AccountID` only triggers on
null/undefined, not on `Code: ""` (which Xero returns for some accounts with
no code assigned) — that account's option `value` silently collapsed to
`""`, the exact sentinel every picker here uses for "nothing selected."
Every UNSET override field then matched that account by coincidence and
rendered it as if selected, which read as "every override defaults to the
first account in the list, and clearing never actually clears."

### Linked gate

`convex/lib/xeroGate.ts` `isXeroLinked(ctx, orgId)` (server) and
`src/hooks/use-xero-linked.ts` `useXeroLinked()` (client) both read the same
`xeroIntegrations.isConnected` flag via `xeroIntegrations.getForOrg` — one
definition of "linked", not two independently-drifting checks. When
unlinked, every coding field (category/model/kit/line/service forms, the
client's Xero contact card, the Settings → Xero page) is hidden but the
stored value is retained, inert.

### Deployment gate

A second, deployment-level gate sits above the org-level linked gate:
`src/server/xero.ts` `isXeroConfigured()` reports whether `XERO_CLIENT_ID`/
`XERO_CLIENT_SECRET` are set at all (unauthenticated — it reveals nothing but
a boolean). When unset, the "Xero" item never renders in the Settings nav
(`src/app/(app)/settings/layout.tsx`, `useServerQuery` — one-shot, never
invalidated, a deployment's env config doesn't change mid-session) and a
direct visit to `/settings/xero` shows a "not configured" message instead of
a "Connect Xero" button that would otherwise throw at click-time
(`requireXeroAppCredentials()` in `src/server/xero.ts`).

### Account-coding pickers are searchable, not plain `Select`s

`/settings/xero`'s org-default-account, default-tax-type, and per-service-type
account fields use `ComboboxPicker` (`src/components/ui/combobox-picker.tsx`),
not the plain Radix `Select`. A full chart of accounts commonly runs into the
hundreds of rows — a bare `Select`'s dropdown has no built-in scroll affordance
in this codebase's wrapper and can render off-screen; `ComboboxPicker` gives a
search input plus an internally-scrollable (`max-h-60 overflow-y-auto`) list,
the same component already used everywhere else in the app for name+code
pickers (e.g. the model picker in `asset-form.tsx`). `allowClear` lets a
default be reset back to "unset" (falls through to the next cascade level)
without a separate clear control.

### Client contact mapping

Lives on **Settings → Xero → "Client mapping"** (`src/components/settings/xero-client-mapping.tsx`),
not the client detail page — moved there so mapping doesn't require opening
each client individually: one searchable box (`useClientSearch`, the
indexed `api.search.clients` query, not a whole-org JS filter) lists every
client with its current mapping status, and expanding a row reveals the
actual search/link/unlink UI. That per-client UI itself is unchanged —
`XeroContactCard` (`src/components/clients/xero-contact-card.tsx`) is reused
as-is, just embedded per-row instead of standalone on the client page, so
there's one definition of "how to map a client," not two. Search Xero
contacts by name, or push an unmapped client's invoice and the push flow
auto-creates the contact. **Duplicate protection:** auto-create first tries
an exact-email match against Xero (`findXeroContactByEmail`) and LINKS
instead of creating when found — verified by `src/server/xero.test.ts`'s
mocked-boundary tests. `convex/clientXeroWrites.ts` is deliberately separate
from the general `clientWrites.ts` browser-direct mutations —
`xeroContactId`/`xeroContactName` can only change through a real Xero
search/create/link round trip, never a plain client-form save.

### Reference data cache

`xeroIntegrations.cachedAccounts`/`cachedTaxRates` — fetched on connect and
via a Settings-page "Refresh" action (`refreshXeroReferenceData`); every
account/tax-type picker reads this cache, never Xero directly per keystroke.
A stale-cache banner shows `cacheError`/`cacheRefreshedAt` when the last
refresh failed.

### Sync log

`xeroSyncLogs` (modeled on `wooCommerceOrderLogs`) — one row per
push/contact-sync/token-refresh/reference-fetch attempt, success or failure.

## Key files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | `quotes`, `invoices`, `invoiceLines`, `xeroIntegrations`, `xeroSyncLogs` tables; Xero coding fields on `categories`/`models`/`kits`/`projectLineItems`/`projectServices`; `clients.paymentProfile`/`profileDepositPercent`/`xeroContactId`/`xeroContactName` |
| `convex/quotesWrites.ts` | The five quote verbs: `sendNative`/`recallNative`/`newVersionNative`/`markAcceptedNative`/`markDeclinedNative` |
| `convex/quotes.ts` | `listForProject` (with derived `effectiveStatus`) / `revisionStateForProject` |
| `convex/lib/quoteState.ts` | Derived `EXPIRED`, `PUBLISHED`→`SENT` normalisation, `hasAcceptedQuote`, org-checked quote/project loaders |
| `convex/lib/quoteDates.ts` / `src/lib/quote-validity.ts` | Validity default + bounds + timezone-correct `validUntil`/expiry (mirrored pair) |
| `convex/backfillQuoteRevisions.ts` | Forward migration + `verifyQuoteRevisions` |
| `src/hooks/use-quote-writes.ts` / `src/components/projects/project-quote-rail.tsx` | Client wiring for the five verbs + `repriceFromRevision` + the revision row's document action |
| `src/components/projects/finance/send-quote-dialog.tsx` | Quote date/validity/recipient/notes, no money — the send handover state (#989) |
| `src/components/projects/finance/issue-invoice-dialog.tsx` | Invoice date/due date/notes at issue — closes the missing-due-date bug (#989) |
| `src/components/projects/finance/accept-quote-dialog.tsx` | Acceptance date + optional reference, instead of a bare click (#989) |
| `src/components/projects/finance/quote-revision-viewer-dialog.tsx` | Read-only "as of v N" view + vs-previous/vs-current diff (#989) |
| `src/components/projects/finance/reprice-from-revision-dialog.tsx` | "Use vN's pricing for v(N+1)" confirm dialog (#989 §8.1) |
| `src/components/projects/finance/quote-drift-indicator.tsx` / `src/lib/quote-drift.ts` | "Job no longer matches the sent document" summary + banner (#989) |
| `src/components/projects/finance/quote-lock-strip.tsx` | The Finance tab's always-mounted lock explanation (#989) |
| `convex/quotesWrites.ts` `repriceFromRevisionNative` | Composes `newVersionNative` + `restoreProjectSnapshot(FINANCIAL)` in one transaction, one audit entry (#989) |
| `src/lib/invoice-terms.ts` / `convex/lib/invoiceDates.ts` | Payment-terms default + bounds + `computeDueDate` (mirrored pair, #989) |
| `convex/financeArtifacts.ts` | Attach-once artifact mutations + the org-checked context queries the download routes authorise against (#987) |
| `src/server/finance-documents.ts` | `generateQuoteArtifact` / `generateInvoiceArtifact` — render, upload, attach, bin the orphan on a lost race |
| `src/lib/finance-artifacts.ts` / `src/lib/finance-artifact-response.ts` | Artifact file naming + the shared streaming/org-check half of both routes |
| `src/app/api/finance/{quote,invoice}/[id]/pdf/route.ts` | Download the stored document — no regeneration path |
| `convex/invoicesWrites.ts` | `createNative`/`issueNative`/`voidNative`/`deleteDraftNative`/`createCreditNative` |
| `convex/lib/financeSnapshot.ts` | `buildFinanceLines` — the shared quote/invoice line-breakdown builder |
| `convex/lib/xeroAccountCascade.ts` | Pure cascade resolver functions |
| `convex/xeroPush.ts` | Push-time coding resolution (in-context DB reads) + apply/fail mutations |
| `convex/xeroIntegrations.ts` / `convex/xeroSyncLogs.ts` / `convex/clientXeroWrites.ts` | Service-only CRUD (mirrors `wooCommerceIntegrations.ts`) |
| `convex/lib/xeroGate.ts` | `isXeroLinked` |
| `src/server/xero.ts` | OAuth connect/callback, reference-data refresh, coding settings, contact mapping, `pushInvoiceToXero` |
| `src/lib/xero-client.ts` | Xero REST API client (OAuth2 + Accounting API), Zod-validated |
| `src/lib/xero-oauth-state.ts` | HMAC-signed OAuth `state` token |
| `src/lib/invoice-number.ts` | Invoice-numbering constants + scopeKey namespace prefix |
| `src/lib/invoices-read.ts` | Service-token read — latest issued invoice number (PDF `invoice_number` token) |
| `src/hooks/use-xero-linked.ts` | Client-side linked gate |
| `src/app/api/integrations/xero/callback/route.ts` | Public OAuth callback route |
| `src/components/settings/xero-client-mapping.tsx` | Searchable client list + per-row `XeroContactCard` (Settings → Xero) |
| `src/components/clients/xero-contact-card.tsx` | The actual per-client search/link/unlink UI, embedded by the above |
| `src/components/ui/combobox-picker.tsx` | Searchable, scrollable account/tax-type pickers on Settings → Xero |
| `src/components/settings/xero-coding-fields.tsx` | `XeroAccountCodeField`/`XeroTaxTypeField` — shared, self-gating cascade override fields used on category/model/kit/line/service forms |
| `convex/financeOrg.ts` | The org-level Finance section's one aggregation query (`bundle`/`counts`, #992) — six bounded sections, no per-project loop |
| `src/hooks/use-native-org-finance.ts` / `useNativeOrgFinanceCounts` (`use-native-dashboard.ts`) | Client wiring for the page subscription + the cheap dashboard-chip counts (#992) |
| `src/app/(app)/finance/page.tsx` | The `/finance` page — six sections, client-name filter, deep links to `?tab=finance` (#992) |

## Testing

- `convex/lib/xeroAccountCascade.test.ts` — 24 tests, every cascade level +
  rental-vs-sale + service-type branches.
- `convex/xeroPush.test.ts` — 6 tests, cascade resolution IN CONTEXT (real
  DB reads through model/kit/category/service, not just the pure functions).
- `src/lib/xero-client.test.ts` — 16 tests against fixture Xero responses
  (mocked `fetch`).
- `src/lib/xero-oauth-state.test.ts` — 5 tamper/expiry tests.
- `src/server/xero.test.ts` — 4 mocked-boundary tests on `pushInvoiceToXero`
  (auto-create-contact idempotency, the failure path).
- `convex/lib/xeroGate.test.ts` — 4 tests, the linked gate + org-scoping.
- `convex/quotesWrites.test.ts` / `convex/invoicesWrites.test.ts` — 40 tests,
  server-computed money, gapless/namespaced numbering, cross-org IDOR guards,
  RBAC, lifecycle-lock gating. #986 added the four revision invariants,
  supersede-on-send-not-on-draft, the recall round trip (including restoring
  the superseded predecessor), derived-`EXPIRED` blocking acceptance, and the
  manager-can-send-but-not-recall / PM-can-recall RBAC split.
- `convex/quoteDates.test.ts` — pins the `convex/lib` ↔ `src/lib` mirror over a
  timezone × instant × validity matrix, and asserts `validUntil` lands on the
  last local instant of its calendar day across DST in both hemispheres, at
  half/quarter-hour offsets, and over month/year/leap boundaries.
- `convex/backfillQuoteRevisions.test.ts` — dry-run/apply split, every migration
  step, idempotency, template exclusion, monotonicity, SERVICE-only access, and
  zero un-migrated rows afterwards.
- `convex/financeArtifacts.test.ts` — 13 tests: attach-once (never overwrites),
  the sent/issued preconditions, service-only access, and a cross-org case per
  function including "the quote is mine but the project isn't".
- `src/server/finance-documents.test.ts` — 11 tests, led by *"a sent quote's PDF
  is byte-identical on repeat download while the live project changes underneath
  it"*: the pipeline is re-primed with different bytes between calls and the
  stored artifact does not move. Plus the invoice equivalent, stamped dates
  (never `now`), the retry path, and orphan cleanup on a lost attach race.
- `src/app/api/finance/__tests__/artifact-routes.test.ts` — 15 tests: streams
  stored bytes and never calls `generatePdf`, cross-org 404s on both routes, a
  403 when the stored file's org doesn't match, `?type=quote` without `preview=1`
  is a 400, and preview requires `invoice:read`.
- `src/lib/pdfme/document-composer.test.ts` / `plugins/gearflow-draft-watermark.test.ts`
  — the watermark reserves exactly its own height, repeats on every page, drops
  no line items, is absent from a normal render, and survives the em dash
  Helvetica can't encode.
- `convex/projectWrites.test.ts` — the acceptance gate on `CONFIRMED`: blocked
  without an accepted revision, satisfied by one, unsatisfied by a merely-SENT
  one or another org's (IDOR), the admin/PM override with its audited
  justification, and `revision` being un-forgeable and un-clearable.
- `convex/recalc.test.ts` — 4 new tests for the derived `depositPaid`/
  `invoicedTotal` fields.
- `convex/quotesWrites.test.ts` (#989) — `repriceFromRevisionNative`: seeds the
  next draft with an earlier revision's money fields leaving structure
  untouched, exactly one audit entry, rejects a source quote from another
  project / with no stored snapshot / while the current revision is still an
  open draft, RBAC and cross-org IDOR.
- `convex/invoicesWrites.test.ts` (#989) — regression: `invoiceDate`/`dueDate`
  are always stamped even when the caller supplies neither (the bug this
  closes), an explicit override wins, and the org's configured
  `paymentTermsDays` is respected.
- `convex/invoiceDates.test.ts` — pins the `convex/lib` ↔ `src/lib`
  `paymentTermsDays` mirror and the `computeDueDate` contract.
- `src/components/projects/finance/__tests__/send-quote-dialog.smoke.test.tsx`
  — jsdom smoke test that actually **opens** the send dialog and its recipient
  `combobox-picker.tsx` inside the Radix modal `Dialog` (the standing
  Radix/Base-UI-in-modal regression class), and asserts no monetary input
  exists anywhere in the form.
- `convex/financeOrg.test.ts` (#992) — 11 tests: every section's true-positive
  row against deliberate noise (an ACCEPTED quote absent from Quotes
  out/Expiring, a DRAFT on a CANCELLED project absent from Never sent, a PAID
  invoice absent from Outstanding, a client with an already-issued deposit
  absent from Deposit due); cross-org IDOR (a caller never sees another org's
  rows, and a token/orgId mismatch rejects); `counts` mirrors `bundle`'s
  section lengths; and the boundedness regression guard — a fixture with
  `SECTION_CAP + 25` SENT quotes asserts the result stays capped and
  `capped: true`, not a full collect.
- `src/app/(app)/finance/__tests__/finance-page.smoke.test.tsx` — jsdom smoke
  test rendering every section (populated and empty/zero-noise states) and the
  client-name filter, per CLAUDE.md's overlay-UI convention.

## Deferred (not built in this PR)

- **Payment-status poll (phase 2).** `invoices.paymentStatus` field + the
  Xero-linked gate exist; the cron that polls Xero for payment status and
  writes it back does not. `convex/scheduledJobs.ts`'s
  `ENABLE_CONVEX_CRONS` off-by-default discipline (FEATUREDOCS in that file)
  is the pattern to follow when this lands.
- **Project financial tab "invoiced/paid/outstanding" summary** beyond what
  `financial-summary.tsx`'s new Invoicing block already shows.
- **Live Xero verification — partial.** The OAuth connect/callback round trip
  HAS since been exercised against Xero's live servers (a real developer app,
  post-deploy) and works end to end. A real invoice push has still only been
  exercised against fixture responses (`src/lib/xero-client.test.ts`), never
  a live Xero org's Accounting API.
  Two live-only gotchas discovered so far, both fixed: (1) Xero split the
  broad `accounting.transactions` OAuth scope into granular scopes on 4 March
  2026 — any app created after that date is issued ONLY the granular set, so
  `XERO_OAUTH_SCOPES` (`src/lib/xero-client.ts`) requests `accounting.invoices`,
  not the deprecated broad scope. (2) the OAuth callback route's post-exchange
  redirect must be built from `env.NEXT_PUBLIC_APP_URL`, never `request.url`
  — see "Connection (OAuth2)" above.
- **`/finance`'s PM and date-range filters (#992).** Client-name filtering
  shipped; PM and date-range did not. PM needs a display-name resolution for
  `projectManagerId` that doesn't exist anywhere in the app yet (see
  "Org-level Finance section" above); date-range was left out because the six
  sections don't share one meaningful date field (validity vs. rental end vs.
  due date) and a single control would misrepresent at least one section.
