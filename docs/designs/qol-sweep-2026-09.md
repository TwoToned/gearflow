# QOL Sweep — Undo, Quote Nudges, Date-Move Preview, Haptics, Scan History

> _Owner: Jayden Nawotka · Status: SPEC (not started) · 2026-09-15_
>
> Companion to **#1160 project status automation** (shipped —
> [FEATUREDOCS/76](../../FEATUREDOCS/76-project-status-automation.md)). That change
> made the job's status a consequence of the work. This sweep is the same idea
> applied four more times: **the app should do the obvious thing, and tell you it
> did.**

## What's in and what isn't

| # | Item | Effort | Depends on |
|---|---|---|---|
| 1 | [Undo on warehouse actions](#1--undo-on-warehouse-actions) | S | #1160's `revertAutoAdvance` |
| 2 | [Quote follow-up nudges](#2--quote-follow-up-nudges) | S–M | — |
| 3 | [Date-move impact preview](#3--date-move-impact-preview) | M | — |
| 5 | [Haptics on scan](#5--haptics-on-scan) | XS | — |
| 6 | [Scan history strip](#6--scan-history-strip) | S | 1, 5 |

Item **4** (paste a gear list into a quote) was pitched and is deliberately **not
specced here** — it is a bigger piece of product design (fuzzy-match review UI,
confidence thresholds, unmatched-row recovery) than the rest of this sweep and
deserves its own doc.

**Build order:** 5 → 1 → 6 → 2 → 3. Five is nearly free and de-risks the scan
plumbing six depends on; one and six share a component; two and three are
independent and can go in either order or in parallel.

---

## Decisions record

These are the calls that shape the specs below. Recorded here so they aren't
re-litigated in review.

| # | Decision | Why |
|---|---|---|
| D1 | Undo is a **toast action**, not a dialog | NN/g's rule is reversibility × frequency. Deploy/return are the most frequent actions in the app and fully reversible, so a confirm dialog on each is pure friction. Dialogs stay for force-return and delete, which aren't reversible. |
| D2 | Undo lives in the **hook**, not at call sites | The reversibility is a property of the mutation, not of the button that called it. Same placement the #1160 status toast already uses, and it means zero edits to the 3,500-line warehouse page. |
| D3 | Undo **reverts the auto-advance** too; de-prep/undeploy on their own do not | FEATUREDOCS/76 is explicit that reversing gear does not reverse the status — a partial undeploy mid-job is a *correction*. An undo is a different claim: "that didn't happen." Only the undo path reverts, using the existing `revertAutoAdvance` and its "refuses if the project moved on since" guard. |
| D4 | Quote nudges are **role-gated**; other notification types are not | Every existing type is operational (gear, crew, maintenance) and safe for any member. A quote nudge names a client and a dollar total in an email subject line. It goes to `invoice:read` holders only. |
| D5 | One scan-feedback toggle covers **both** audio and haptics | The existing control is one button on a shared warehouse terminal and means "feedback on/off". Splitting it into two switches to serve a narrow case (silent night shift) adds a surface to every one of the four scan screens. Revisit if asked for. |
| D6 | The scan history strip is **in-memory, per session** | A strip that survives a refresh reads as a log, and would then be wrong (it is per-device, unauthenticated, and drops on navigation). The activity log is the log. This is a working-memory aid. |
| D7 | The date-move preview covers **gear only**, not crew | "Does this window still have gear?" is one question with one existing answer (`computeGearShortageBoard`). "Are the crew still free?" is a different question with a different data source and its own conflict semantics — bundling them makes a dialog that says two unrelated things. Crew stays a follow-on. |

---

## 1 — Undo on warehouse actions

### The problem

Every inverse is already built, guarded and tested — `undeployItems`,
`unreturnItems`, `undeprepLine`, `undeployKitsBatch`, `unreturnKitsBatch`,
`checkInKit`'s counterpart, quote `recall`/`unaccept`. None of them are reachable
from the moment the mistake happens. An operator who double-scans a case has to
leave the scan flow, find the row, open a menu and pick the reverse action — so
in practice they don't, and the data drifts.

There is exactly **one** `Undo` toast in the codebase today
(`item-check-form.tsx:236`, "All pass/fail items marked as Pass"), and it is a
local React-state undo that never reaches the server. The idiom exists; it has
never been applied to a write.

### What ships

An `Undo` action on the toast for the six browser-direct warehouse writes, added
once in `src/hooks/use-warehouse-writes.ts`.

| Forward | Reverse | Reverse permission |
|---|---|---|
| `checkOutItems(projectId, items)` | `undeployItems(projectId, items)` | `warehouse:check_in` |
| `checkOutKit(projectId, kitId)` | `undeployKitsBatch(projectId, [kitId])` | `warehouse:check_in` |
| `checkOutKitsBatch(projectId, kitIds)` | `undeployKitsBatch(projectId, res.succeeded)` | `warehouse:check_in` |
| `checkInItems(projectId, items)` | `unreturnItems(projectId, items)` | `warehouse:check_out` |
| `checkInKit(projectId, kitId)` | `unreturnKitsBatch(projectId, [kitId])` | `warehouse:check_out` |
| `checkInKitsBatch(projectId, kits)` | `unreturnKitsBatch(projectId, res.succeeded)` | `warehouse:check_out` |

**The reverse permission is not the forward one, in either direction.** A role
with `check_out` but not `check_in` can deploy and must not be offered an undo;
the mirror holds for returns. The action is omitted (not disabled) when
`useCanDo` says the reverse is out of reach — an undo button that errors is worse
than no undo button.

Batch reverses use `res.succeeded`, never the requested ids: undoing a
partially-successful batch must not attempt to reverse kits that never moved.

### Reverting the auto-advance (D3)

A deploy that tripped `ALL_CHECKED_OUT` moved the project to Deployed. Undoing
the deploy without the status leaves a job at Deployed with nothing deployed —
exactly the hole `agentRevert` already closed for agent windows.

Three small changes wire the existing primitive in:

1. `maybeAutoAdvanceProjectStatus` (`convex/lib/projectAutoStatus.ts`) currently
   mints its audit row id internally via `createId()`. Change it to **return the
   audit row id alongside the status**: `{ status, auditId } | null`. Every
   existing caller reads `.status`; the wrappers already flow `autoStatus`
   through to the hook, so extend that to `autoStatusAuditId`.
2. `undeployItems` / `unreturnItems` / `undeployKitsBatch` / `unreturnKitsBatch`
   accept an optional `revertAutoAdvanceAuditId: v.optional(v.string())`. When
   present they load that `activityLogs` row (org-checked — `by_cuid` is global)
   and call `revertAutoAdvance` with its `metadata`. The existing guards do the
   rest: it only undoes a row carrying `autoAdvanceTrigger`, and refuses if the
   project has since moved on.
3. The hook passes the id it captured from the forward call.

The arg name deliberately does not match the CI-gated privileged-arg prefixes
(`allow|force|skip|override|ignore|bypass`) or `justification` — it softens no
gate. It cannot: the reverse mutation's own RBAC check runs first, and
`revertAutoAdvance` refuses anything it did not itself write.

### UI spec

```
┌──────────────────────────────────────────────┐
│  Deployed 12 items                    Undo   │
└──────────────────────────────────────────────┘
```

- sonner `toast.success(title, { action: { label: "Undo", onClick }, duration: 10_000 })`.
- **10 seconds.** Long enough to notice a mis-scan mid-flow, short enough that it
  is gone before the next case. (The existing local undo uses 3s because it
  reverses a form field the user is still looking at.)
- Title states what happened in the past tense with a count — `Deployed 12 items`,
  `Checked in 1 item`, `Deployed kit Pelican Rack A`. No description line: the
  strip (#6) carries detail, and a two-line toast on a phone covers the scan
  input.
- On undo: the toast is replaced by `Undone — 12 items back in Prepped`
  (`toast.success`, default duration, no action). On failure, `showError` with
  `fallbackTitle: "Couldn't undo"` — the most likely cause is a genuine race and
  the operator needs to know the state did not change.
- The toast and the #1160 status toast **must not both fire**. When a call both
  advances the status and is undoable, the undo toast wins and folds the status
  into its title: `Deployed 12 items · job moved to Deployed`. Implement as one
  `announce()` that decides, not two calls.

### Edge cases

- **Undo after someone else moved the gear.** The reverse mutation already
  validates line state and throws; surface it as the error toast above. No
  optimistic client state to unwind.
- **Undo after navigating away.** The toast is global (sonner lives in the root
  layout), the mutation takes `projectId` explicitly, and nothing reads page
  state — it works from any screen.
- **Double-tap Undo.** Guard with a ref inside the closure; the second tap is a
  no-op rather than a second reverse (which for `unreturnItems` would be a real
  state change).
- **Accessory cascade.** `checkoutItemsCore` deploys accessory children;
  `undeployItemsCore` reverses the same cascade (`reverseAccessoryChildren`).
  Nothing extra to pass.

### Out of scope for phase 1

Prep (`prepItemsBatch` / `prepKitsBatch` / `completeCheckAndPack`) — its reverse
(`deprepItems`) exists, but three of the four forward paths are server actions
with mismatched return shapes (one returns an array), which is the same plumbing
gap FEATUREDOCS/76 records as the prep-toast gap. Close both together in a
follow-on, not here.

### Tests

- `convex/warehouseWrites.test.ts` — `revertAutoAdvanceAuditId` restores the
  prior status; a foreign-org audit id is rejected; an id whose project has since
  moved on is a no-op with the write still applying.
- `src/hooks/__tests__/use-warehouse-writes.undo.test.ts` (new) — the reverse
  mapping table, `succeeded`-only batching, the permission omission, and that a
  second Undo tap does not fire a second reverse.
- One jsdom smoke test that actually clicks the toast action (the `/qa` lesson
  from `model-roi-tab.smoke.test.tsx`: render the thing, don't assert on props).

---

## 2 — Quote follow-up nudges

### The problem

`convex/financeOrg.ts` already computes expiring quotes —
`buildExpiring` filters live quotes to `validUntil - now <= QUOTE_EXPIRING_SOON_DAYS`
(7 days, `convex/lib/quoteDates.ts`), including already-`EXPIRED` ones. It is
reachable only by opening `/finance`. Nothing pushes it.

There are 12 notification types and none of them is about money. A sent quote
nobody chased is the most expensive silent failure in the product.

### What ships

A `quote_expiring` notification type, in the bell and (opt-out) by email, plus a
**Chase** action on the quote rail.

### Server

1. **New Convex query** `financeOrg.expiringForNotifications({ orgId, now })` —
   returns `{ quoteId, projectId, projectNumber, clientName, version, validUntil,
   daysLeft, total }[]`, capped at `SECTION_CAP`. Extract the existing
   `buildExpiring` predicate into a shared pure helper so the board and the
   notifier cannot drift (R-3.1); do not re-implement the `SENT | EXPIRED` +
   `validUntil` rule. Guard with `requireOrgReadFor(ctx, orgId, "invoice")` (the
   same guard `financeOrg.bundle`/`counts` already use) and
   colocate an `agentOps` annotation.
2. **Bell** — a branch in `getNotifications()` (`src/server/notifications.ts`)
   adding `quote_expiring` to the `AppNotification` union.
   `href: /projects/{projectId}?tab=finance` (a valid tab — see `VALID_TABS`).
   `severity: "warning"` while live, `"error"` once expired.
3. **Email** — `quoteExpiringEmail()` in `src/lib/notification-emails.ts`
   following the existing one-factory-per-type shape, and a branch in
   `buildOrgNotifications()`.

### Audience (D4)

`NotificationToSend` gains an optional
`audience?: (recipient: OrgRecipient) => boolean`. `loadOrgRecipients` already
loads `prisma.member` — add `role` to the returned `OrgRecipient` and resolve it
through the existing `rolePermissions` / `hasPermission`
(`src/lib/org-context.ts` re-exports both from `permissionsCore`). Do **not**
add a parallel "who can see money" table.

`quote_expiring` sets `audience: (r) => hasPermission(rolePermissions[r.role], "invoice", "read")`.
Every existing type omits `audience` and behaves exactly as today.

### Preference + dedupe

- New flag `quoteExpiring` on `userNotificationPreferences` (Convex schema),
  `NOTIFICATION_PREFERENCE_DEFAULTS`, `NOTIFICATION_TYPE_TO_PREFERENCE`,
  `NOTIFICATION_PREFERENCE_LABELS`, and the Convex-side mirror
  `convex/lib/notificationPreferences.ts`. **Default `true`** — it is a
  high-signal revenue event, matching `overdueReturn`/`flaggedAsset` rather than
  the advisory `upcomingProject` tier. The two copies are pinned by
  `convex/userNotificationPreferences.test.ts` and
  `src/lib/user-notification-preferences-read.test.ts` — extend both.
- Dedupe key `quote-expiring:{quoteId}:{bucket}` where `bucket` is `soon` or
  `expired`. That is deliberately **not** day-bucketed: a quote should nudge at
  most twice in its life — once when the window opens, once when it lapses — and
  a daily key would email seven times for one quote.

### The Chase action

On the quote rail (`src/components/projects/project-quote-rail.tsx`), next to the
existing revision actions, for a revision whose effective status is `SENT` or
`EXPIRED`: **Chase** copies a follow-up block to the clipboard, reusing the
`copySummary` shape the send dialog already produces plus the sent date and days
remaining. Flow does not email the client (decision 7 of #989) and this does not
change that — it hands the operator text for their own mail client.

### Edge cases

- A quote with no `validUntil` is never expiring (already the board's rule).
- A superseded or recalled revision is not live and is already excluded by
  `effectiveQuoteStatus` — do **not** re-derive with a `status === "SENT"` test
  (see CLAUDE.md, "Quote status is DERIVED").
- An org with no `invoice:read` holders sends nothing and logs nothing; the bell
  is likewise empty for members who can't see it.

### Tests

- `convex/financeOrg.test.ts` — the extracted predicate: 7-days-out is in, 8 is
  out, no-`validUntil` is out, already-expired is in, superseded is out.
- `src/server/__tests__/notification-email-sender.test.ts` — the `audience`
  filter drops a warehouse-role recipient and keeps an admin; the two-bucket key
  emails twice, not daily.
- Preference-parity test extension.

### Docs

`FEATUREDOCS/17` (add the row — and while there, reconcile the stale
`low_stock` / `expiring_cert` rows, which the `AppNotification` union and the
8-flag preference model no longer carry), `FEATUREDOCS/66` (the Chase action).

---

## 3 — Date-move impact preview

### The problem

`ConfirmStatusImpactDialog` exists because confirming a job turns soft demand
into hard demand and can strand another job's gear. Moving a **confirmed** job's
dates does exactly the same thing and shows nothing at all.

The machinery is already written for a third case:
`projectVersionsWrites.deriveDateMoveConflicts` runs after a promote rolls the
rental window back, and reports "Moving the rental window created a shortage of
N × Model (also booked on P-123)" using `computePromoteOverbookingConflicts`. It
runs **after** the write, and only for promote.

### What ships

The same computation as a **preview query**, and a non-blocking dialog on the
project edit form.

### Server

New query `overbookingBoard.dateMoveImpact({ orgId, projectId, start, end })`:

- `requireOrgReadFor(ctx, orgId, "project")`, org-check the project row.
- Resolve the *proposed* window through `getProjectWindow` semantics
  (`projectStartDate ?? rentalStartDate`) — the caller passes the resolved
  numbers, the query does not re-derive from form fields.
- `fetchCandidateProjects` → `candidateBoardProjects` → `fetchGearData` →
  `computePromoteOverbookingConflicts`, with the project's **real** status (no
  `CONFIRMED` simulation — unlike `confirmImpact`, this is asking about a job
  that already is what it is).
- Returns `PromoteOverbookingRow[]`, capped, plus `windowMoved: boolean`.

Factor the fetch-and-compute block out of `deriveDateMoveConflicts` so the
mutation and the query share it — the post-promote conflict list and the
pre-save preview must not be able to disagree (R-3.1).

### Client

`useDateMoveGate(orgId, projectId, currentWindow, onProceed)`, a near-copy of
`useConfirmStatusGate`'s shape and, importantly, its failure posture:

- No-op unless the resolved window actually moved **and** the project is
  `CONFIRMED` or later (`isConfirmedOrLater`, `convex/lib/projectLocks.ts`). A
  pre-confirm job's demand isn't hard, so there is nothing to warn about.
- One-shot query, then either proceed silently or raise the dialog.
- **Fails open** on any query error — an advisory check must never block a real
  edit.

Wired into `project-wizard.tsx`'s `useServerMutation` in edit mode only, before
`projectWrites.update`.

### UI spec

`DateMoveImpactDialog` — same grammar as `ConfirmStatusImpactDialog`, so the two
read as one system:

```
⚠  Moving these dates creates a shortage

   3 × Shure SM58  — also booked on P-1042, P-1051
   1 × CM Lodestar — also booked on P-1039

   This is a heads-up, not a block — you can still save.

                       [ Cancel ]  [ Save anyway ]
```

- `AlertTriangle` + `text-warn` title, matching the existing dialog.
- List the first 5 rows, then "+N more" — a dialog is a summary, not a report.
- The muted `t-micro` "heads-up, not a block" line is copied verbatim from
  `ConfirmStatusImpactDialog`; the whole point is that the two feel identical.
- No `AlertDialog` (see CLAUDE.md gotchas) — `Dialog` with confirm/cancel.

### Edge cases

- Dateless → dated: `windowMoved` is true and the check runs normally.
- Dated → dateless: nothing to compare against; skip.
- A shortage that already existed before the move is still reported. Diffing
  before-vs-after would hide a pre-existing problem the operator is about to make
  someone else's, and the promote path doesn't diff either — consistency wins.

### Tests

- `convex/overbookingBoard.test.ts` — the query returns the same rows the
  post-promote path produces for the same window (the shared-core guarantee).
- `src/hooks/__tests__/use-date-move-gate.test.ts` — skips when the window
  didn't move, skips below CONFIRMED, fails open on a throwing query.
- A jsdom smoke test that renders the dialog (not just the trigger).

---

## 5 — Haptics on scan

### The problem

`src/lib/scan-feedback.ts` has a shared `AudioContext`, four tone kinds and a
per-device toggle. It has no haptics. A warehouse is loud, phones live in pockets
and gloved hands, and 2026 scanning guidance is consistent that audio and haptic
belong together.

### What ships

```ts
/** Vibration pattern per verdict, in the `navigator.vibrate` shape.
 *  Mirrors SCAN_FEEDBACK_TONES one-for-one — a kind with a tone and no
 *  pattern would be a silent half-verdict on a muted phone. */
export const SCAN_FEEDBACK_HAPTICS: Record<ScanFeedbackKind, number | number[]> = {
  success:   30,              // one short tick
  error:     [60, 40, 60],    // two firm buzzes — distinguishable through a glove
  exception: [30, 60, 30],    // double tick, mirrors the double-blip tone
  info:      15,              // barely-there
};

export function playScanHaptic(kind: ScanFeedbackKind): void { /* … */ }
```

- Feature-detect `typeof navigator !== "undefined" && typeof navigator.vibrate === "function"`,
  whole body in try/catch, swallow — identical posture to `playScanFeedback`
  ("Audio is a non-critical enhancement — never let it break a scan flow").
- **iOS Safari does not implement `navigator.vibrate`.** It no-ops there; that is
  the accepted outcome, not a bug to work around with a WebKit hack.
- `useScanFeedback.play` calls both, behind the existing `enabled` flag (D5).
  Rename the button label to "Scan feedback" / "Disable feedback"
  (`ScanAudioToggle` → `ScanFeedbackToggle`, keeping `Volume2`/`VolumeX` — no
  better two-state glyph exists for "both", and audio is the half people notice).
  The `localStorage` key stays `rvlt.scanAudio` so no one's terminal preference
  resets; document why in the module comment.
- Every one of the ~30 `scanFeedback.play(kind)` call sites is unchanged.

### Tests

`src/lib/__tests__/scan-feedback.test.ts` — stub `navigator.vibrate`, assert one
call per kind with the mapped pattern; assert a throwing `vibrate` is swallowed;
assert a missing `vibrate` is a no-op. Add a table test that every
`ScanFeedbackKind` has both a tone and a pattern, so a fifth kind can't ship half
wired.

### Docs

`FEATUREDOCS/12` (Scan Feedback section), `FEATUREDOCS/14` (the audio note).

---

## 6 — Scan history strip

### The problem

A scan confirms and vanishes. The one question an operator asks mid-flow is "did
that last one go in, or did I double-scan it?" Today the only answer is to stop,
leave the scan input, and hunt the list.

### What ships

A compact, reverse-chronological strip of the **last five** scan verdicts, above
the scan input on every scan surface.

### Mechanism

`scanFeedback.play(kind)` is already called at every verdict in the warehouse
page, the returns station, T&T quick-test and `/check/[assetTag]`. That makes it
the one hook point — but it doesn't know *what* was scanned. Widen it:

```ts
play(kind: ScanFeedbackKind, entry?: ScanHistoryEntry): void

interface ScanHistoryEntry {
  /** What was scanned, as the operator would say it — "SM58 · A-1042". */
  label: string;
  /** The verdict in words — "Prepped", "Already deployed", "Not on this project". */
  outcome: string;
  /** Optional one-tap reverse, supplied by the same `announce()` that raises
   *  the undo toast (#1) — so the strip and the toast can never disagree. */
  undo?: { label: string; run: () => void | Promise<void> };
}
```

`useScanFeedback` keeps `entries: (ScanHistoryEntry & { kind; at })[]` in state,
capped at 5, and returns it. `entry` is optional, so call sites adopt one at a
time and an un-migrated site still beeps and buzzes exactly as before.

State is in-memory and per-mount (D6).

### UI spec

```
Recent
  ✓  SM58 · A-1042          Prepped              just now    Undo
  ✓  Pelican Rack A         Kit prepped          12s ago
  !  XLR 5m · B-0031        Already deployed     40s ago
  ✓  CM Lodestar · L-07     Prepped              1m ago
  ✗  A-9999                 Not on this project  2m ago
```

- One row per entry, ≥44px touch targets (the scan tabs' existing rule, §15).
- Leading glyph by kind, using `src/lib/status-colors.ts` intents — never
  hardcoded classes (DESIGN.md §3): `success → text-ok`, `exception → text-warn`,
  `error → text-t-out`, `info → text-muted`.
- Relative time, recomputed on a 10s interval (not per render).
- `Undo` renders only on the newest entry that carries one, and only inside its
  10s window — a strip full of Undo buttons invites undoing the wrong thing.
- Wrapped in `aria-live="polite"` with `aria-atomic="false"` so a screen reader
  announces each new verdict. This is the accessibility half of a beep, and today
  there isn't one.
- Collapses to nothing when empty — no "no scans yet" placeholder above a scan
  input that is itself the call to action.
- On mobile the strip shows **two** rows with a "Show all" expander; five rows
  plus the scan input plus the tab chrome does not fit a phone above the fold,
  and the scan input must never be pushed off screen.

### Where

`src/components/warehouse/scan-history-strip.tsx`, rendered on:
`warehouse/[projectId]` pick-prep / deploy / return tabs, `warehouse/returns`,
`test-and-tag/quick-test`, `check/[assetTag]`.

### Tests

- `use-scan-feedback` — the cap holds at 5, newest first, an entry-less `play`
  adds nothing, `undo` is exposed only on the newest carrier.
- A jsdom smoke test that renders the strip with all four kinds and asserts the
  `aria-live` region and the intent classes.

---

## What this sweep deliberately does not do

- **Undo on prep** — the reverse exists; the four forward paths are server
  actions with mismatched return shapes. Bundle it with closing FEATUREDOCS/76's
  recorded prep-toast gap.
- **Undo on destructive actions** (force-return, delete, void) — not reversible,
  so they keep their dialogs (D1).
- **Crew conflicts in the date-move preview** (D7).
- **Persisting scan history** (D6).
- **A second scan-feedback toggle** (D5).
