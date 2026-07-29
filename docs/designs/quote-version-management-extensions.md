# Quote version management — deletion, protection, correction, artifact fix

> _Owner: Jayden Nawotka · Created: 2026-07-29_

**Driver:** Jayden — a follow-up pass on top of the locked quote-revision model, covering
operational gaps found while designing/using it: deleting a mistaken version, protecting a
sent/accepted quote from further tampering, correcting dates on an already-sent quote without
losing the paper trail, and a live bug where recalling and resending a quote silently serves
the stale pre-recall PDF.

**Extends:** [`finance-first-class-version-control.md`](./finance-first-class-version-control.md)
(tracking [#985](https://github.com/TwoToned/gearflow/issues/985), phases A–F,
[#986](https://github.com/TwoToned/gearflow/issues/986)–990, [#992](https://github.com/TwoToned/gearflow/issues/992)).
This doc does not modify that doc's model — one shared `projects.revision` counter, the five
verbs (Send/Recall/New version/Accept/Decline), immutable-artifact-by-default — except for one
explicit, called-out reversal in §2.2.

**Explicitly ruled out of scope (carried over from the parent doc, §12):** multiple
concurrently-editable draft revisions / variant quotes with independent equipment lists. That
was scoped out of v1 because it breaks the shared-counter model and the warehouse-availability
model (two live equipment lists can't both be "the real booking" for the same physical gear).
Nothing here reopens that. Every feature below still assumes exactly one live line-item set and
exactly one revision counter.

---

## 1. Problem

Four gaps found once the locked model was designed against real workflows:

1. **No way to delete a mistaken version.** Fat-fingering "new version" has no undo except
   living with the gap in the version list forever.
2. **No protection against further edits to an accepted quote.** Recall is available to
   anyone with `isHardLockOverrideAllowed`, with no way to say "this one specifically must not
   be touched again."
3. **No way to fix a wrong date on an already-sent quote without a full version bump.** Send
   date / due date typos currently require Recall → New Version → Send again, which is more
   ceremony than a metadata typo warrants, and changes the version number for a non-substantive
   fix.
4. **Live bug:** recalling a sent quote, editing notes/discount, and resending serves the
   **stale pre-recall PDF** — confirmed root cause below (§5).

---

## 2. Decisions

### 2.1 Delete a never-sent draft — revision counter rolls back

A `DRAFT` quote that has **never** been `SENT` can be deleted outright. Nobody outside the
company has ever seen it, so nothing is lost. On delete, `projects.revision` **rolls back** to
the highest revision that was ever actually sent (or `1` if none was) — a draft that never
shipped shouldn't leave a permanent gap in the version numbering. The next "new version" reuses
that number.

This is a narrow, deliberate exception to the parent doc's "never decremented, never reused"
invariant (§3.1 there) — that invariant is about **sent** revisions (a superseded one is never
reissued); it was never about numbers a draft merely reserved and discarded.

### 2.2 Recall, then delete a sent quote — full erase, explicitly accepted risk

**This reverses a decision made earlier in this same design conversation** ("never truly delete
a sent version") after being pushed back on twice — recorded here so the reversal is visible,
not silent (R-14.4 — surfaced, not swallowed).

Confirmed behavior: Recall (SENT → DRAFT) followed by Delete **permanently erases** the quote
row and its stored PDF, even though a client may already have opened or downloaded that PDF.
Jayden confirmed this explicitly, twice, after the risk was explained.

**Required safeguards** (non-negotiable part of this decision, not optional polish):
- **Owner-only permission** — one tier above Recall's existing `isHardLockOverrideAllowed`
  audience (admin/owner/PM). Deleting something a client may hold is a strictly bigger act than
  un-sending it.
- **Typed confirmation dialog** — not a generic "are you sure?"; the user must type something
  identifying (e.g. the version label) before the delete fires. No `AlertDialog`/`window.confirm`
  per CLAUDE.md — a Radix `Dialog`.
- **Audit log entry that survives the row.** `writeActivityLog` already writes to a table
  independent of the entity it describes — confirm the delete mutation logs project id, quote
  version, who, when, and that it was a full erase of a previously-sent revision, so there is
  still a record that this happened even though the quote and its PDF are gone.
- A `DRAFT` quote that was **never** sent does not need any of this — that path is §2.1.

### 2.3 Protect — a soft lock independent of quote status

New `quotes.protected: boolean`. Owner-only to set/unset (one notch above Recall's audience —
"nobody touches this, including whoever could normally recall it").

While `protected: true`:
- Recall is blocked.
- Correction (§2.4) is blocked.
- Delete (§2.2) is blocked — protection is the stronger guarantee; you must explicitly
  un-protect before an owner can erase it.

**Default:** auto-set `protected: true` the moment a revision reaches `ACCEPTED`. A client has
committed to those exact numbers; protect it by default, with an explicit owner override to
un-protect if a genuine correction is later needed.

### 2.4 Correction — audited in-place date/PDF fix, no version bump

New mutation `correctNative`, distinct from Recall and New Version:

- Edits `sentAt` / `quoteDate` / `validUntil` / `dueDate` on the **current** revision. Does
  **not** touch price, snapshot, or line items — that's what New Version is for.
- Re-renders the PDF. Per CLAUDE.md's stored-bytes rule, the **old PDF is kept, not
  overwritten** — `quotes.pdfFileId` becomes an append-only list (or a small
  `quotes.priorPdfFileIds: string[]`) rather than a single field. The new PDF is what
  `/api/finance/quote/[quoteId]/pdf` serves by default, stamped **"REISSUED — corrects vN sent
  \<original date\>, edited by \<user\> on \<correction date\>."** The prior PDF stays
  reachable, badged "Superseded by correction."
- Writes an audit entry: field, old value, new value, who, when — same shape as every other
  audited write in the app.
- Blocked if `protected: true` (§2.3), or if the revision isn't `SENT`/`ACCEPTED` (a `DRAFT`
  just gets edited normally — no "correction" concept needed pre-send).
- Permission: same floor as Recall (`isHardLockOverrideAllowed`) at minimum — arguably higher,
  since this mutates a document already in the client's hands rather than un-sending it. Use
  the same audience as Recall unless review says otherwise.

### 2.5 PDF regen bug fix — clear `pdfFileId` on recall

Root cause (confirmed by code investigation, file:line references in §5): `recallNative`
(`convex/quotesWrites.ts:391-397`) flips `status` back to `DRAFT` but never clears
`quotes.pdfFileId`. The subsequent resend correctly refreshes `notes`/`snapshot` from the
now-edited live project, but its patch (`convex/quotesWrites.ts:302-319`) also never touches
`pdfFileId`. The post-send auto-render
(`src/hooks/use-quote-writes.ts:87` → `generateQuoteArtifact`) then hits the "already has an
artifact, don't overwrite" guard (`src/server/finance-documents.ts:64-65`,
`convex/financeArtifacts.ts:157`) and silently serves the **pre-recall** PDF.

**Fix:** `recallNative` clears `pdfFileId` (and any correction-history list from §2.4) back to
`undefined` when it flips `SENT → DRAFT`. This forces the next send's auto-render through the
real render path. The "don't overwrite an existing artifact" guard stays fully intact for the
normal single-send case — this only changes behavior for the recall→resend cycle, which is
exactly the case that's currently broken.

This fix is a **prerequisite** for §2.4 (Correction) working correctly, and is small/low-risk
enough to ship independently and first.

---

## 3. Data model changes

```ts
// quotes
protected: v.optional(v.boolean()),           // owner-only soft lock; default false
priorPdfFileIds: v.optional(v.array(v.string())), // correction history; current pdfFileId stays the field name for "what serves now"

// activity log (existing table, new event kinds)
"quote.deleted_after_recall"   // §2.2 — logged even though the quote row is gone
"quote.corrected"              // §2.4 — field, old value, new value
"quote.protected" / "quote.unprotected"  // §2.3
```

`recallNative` gains a clear of `pdfFileId` (and `priorPdfFileIds`, if any exist from a prior
correction cycle) as part of its existing patch (§2.5).

No changes to `projectSnapshots`/`projectSnapshotEntries`, `quotes.snapshot`, or any
`DocumentLineItem` shape — none of this touches pricing or structure.

---

## 4. Open questions

- **Correction permission bar** — same as Recall, or strictly higher? Leaning higher (owner
  only, matching Delete's bar) since review of §2.2's reversal suggests "touches a document the
  client may hold" deserves the same trust level regardless of which of these three actions
  it is. Flag for `/plan-eng-review` before implementation.
- **Does `protected` block New Version too?** Currently scoped to block only Recall/Correction/
  Delete — New Version doesn't touch the protected row (v2 stays exactly as sent, v3 is a fresh
  draft), so it's left allowed. Confirm this is the intended boundary.
- **Invoices** — none of §2.1–2.4 currently extend to `invoices` (parent doc explicitly keeps
  invoices non-versioned, corrected via VOID + reissue). Not addressed here; revisit if the
  same operational gaps show up there.

---

## 5. Investigation notes — PDF regen bug (§2.5), for the record

- `generateQuoteArtifact` short-circuits on an existing `pdfFileId`
  (`src/server/finance-documents.ts:64-65`) — deliberate "render once" behavior, confirmed
  correct for the normal case.
- `recallNative` patches only `status`/`recalledAt`/`recalledById`/`recallReason`/`updatedAt`
  (`convex/quotesWrites.ts:391-397`) — `pdfFileId` untouched, confirmed intentional today per
  `convex/financeArtifacts.ts:34-36` ("nothing deletes one... a recalled or superseded revision
  KEEPS its artifact") — correct for the *superseded* case, wrong for the *same-revision
  resend* case, which is the gap this doc closes.
- Resend reuses the same row (`sendFields`, `convex/quotesWrites.ts:302-319`) — updates notes/
  snapshot/dates, never `pdfFileId`.
- PDF render itself reads **live** project state at render time — `client_notes` and
  `discount_percent`/`discount_amount` both come from `getProjectByIdMapped`
  (`src/lib/pdfme/build-document-data.ts:139,754-755,763`), not from any frozen snapshot — so
  a genuine re-render (once triggered) will correctly reflect edited notes/discount. The bug is
  purely "nothing tells the render-once guard that a recall happened," not a data-freshness
  problem.

---

## 6. Rollout — five issues under one tracker

| # | Item | Scope | Depends on |
|---|---|---|---|
| 1 | PDF regen bug fix | Clear `pdfFileId` on recall (§2.5) | — (ship first, independently) |
| 2 | Delete never-sent drafts | Delete + revision rollback (§2.1) | — |
| 3 | Recall-then-delete (full erase) | Owner-only, typed confirm, surviving audit log (§2.2) | #2's delete plumbing |
| 4 | Protect (soft lock) | `protected` field, blocks Recall/Correction/Delete, auto-set on ACCEPTED (§2.3) | — |
| 5 | Correction | `correctNative`, PDF reissue history, audit trail (§2.4) | #1 (pdfFileId clearing pattern), #4 (protected gate) |
