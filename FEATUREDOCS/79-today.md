# Today (`/today`) — the personal landing page

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-17 (review quarterly — POLICY.md R-5.5)_

Work-layer program, phase 0.5 (#1242) — [`docs/designs/work-layer.md`](../docs/designs/work-layer.md)
§8.1. Depends on phase 0's mentions inbox (#1241, FEATUREDOCS/17). "Composed"
Today: assembled entirely from readers/writers that already exist, plus the
`notifications` table phase 0 added — **no schema change in this phase.**

## What it is

Today replaces Dashboard as the app's landing page (D10A). It answers "what
do I, personally, need to do today, across every job and every client?" —
one page instead of the five unrelated "things you must do" surfaces the
work-layer design doc's audit found (dashboard chip tray, `/overbookings`,
the finance chase board, the project readiness checklist, `/my-tasks`).
Only the first of those (the dashboard's derived org-wide "needs attention"
chips) is untouched; `/my-tasks` is superseded and now redirects here.

## Data model — composed, not new

| Region | Source | Reactivity |
|---|---|---|
| Overdue / Today / Later buckets | `projectTasks.myOpenTasks` (existing) | **Live** — the only subscription on the page |
| Triage bucket (mentions) | `notifications.listForMe` (phase 0) | One-shot, polled |
| Your day (rail) | `crewDashboard.upcomingShifts` + `projectServices.list`, both existing, filtered client-side to projects I manage | One-shot, polled |
| Needs you (rail) | `dashboardLists.needsYou` (**new** — see below) | One-shot, polled |

`dashboardLists.needsYou` is the one new Convex query phase 0.5 adds. It is
NOT a schema change, a new resource, or a migration — it composes existing
tables (`crewAssignments`, `quotes`) the same way `dashboardLists.home` and
`.blocking` already do, bounded to `resolveManagedProjectDocs`'s ≤24
candidates (a helper `home` and `needsYou` now share — R-3.1). Per project it
fans out: crew assignments by `by_projectId` filtered to `DECLINED` or a
stale (`> 48h`) `OFFERED`, and the live quote (`findLiveQuote` +
`effectiveQuoteStatus`) if it's `SENT` and expiring within
`QUOTE_EXPIRING_SOON_DAYS`. This bound is what keeps it from repeating the
org-wide-scan cost mistake documented in work-layer.md §9/R4/R13 (a single
query was 4.66 GB/month in production) — it never scans further than
projects the caller actually manages.

**Phase 1 (#1243): signal-state-aware.** `needsYou` is the concrete implementation of the
design doc §9 diagram's `workTriage.forMe` — a derived signal is never stored, so it's
computed live here every call, then a human's stored DECISION about it (`workSignalStates`,
FEATUREDOCS/50) is subtracted. Each row now carries a deterministic `sourceKey`
(`crew:declined:<assignmentId>`, `crew:stale:<assignmentId>`, `quote:expiring:<quoteId>`) via
`loadHiddenSourceKeys`, which loads the caller's own `workSignalStates` rows for the org and
hides a signal whose state is `dismissed`/`promoted` (permanently) or `snoozed` with
`snoozedUntil` still in the future (an expired snooze re-surfaces the signal — nothing about
the underlying row resolved it). `TodayNeedsYouRail` rows carry snooze/dismiss/promote actions
(`workSignalStatesWrites.ts`) keyed by this `sourceKey`. Deliberately NOT folded into
`needsYou`: mentions (their own dismissal is `notificationsWrites.archiveNative` — no
`workSignalStates` row needed) and "work overdue/due soon" (already real, non-derived
`projectTasks` rows in the Overdue/Today buckets via `myOpenTasks`, not a derived signal).

### One-shot polling (`useFocusPolledQuery`)

`src/hooks/use-focus-polled-query.ts` — a direct `convex.query()` call,
refreshed on tab focus and a 5-minute interval, never a live subscription.
Never blanks while refreshing (`data` keeps its last value; only `asOf`
changes), so a stale read shows a muted "as of" timestamp rather than an
empty flash. First consumer of this pattern in the codebase — the app shell
previously held no always-on subscriptions at all, and Today's design
review (R13) is explicit that reactivity should be spent only where the
user is the writer (the live task list), never on org-wide/PM-scoped signal
ranges on a page nobody closes.

## Bucketing — org timezone, not the browser's

`src/lib/today-buckets.ts`'s `bucketForDueDate` resolves Overdue/Today/Later
boundaries via `startOfDayInTimezone`/`endOfDayInTimezone`
(`src/lib/quote-validity.ts`, the byte-for-byte client mirror of
`convex/lib/quoteDates.ts`) against the org's configured timezone
(`useDocumentDatesConfig()`). **This is a deliberate fix, not a port**:
`/my-tasks` and the dashboard's old tasks-due block both bucket by
`new Date(now).setHours(0,0,0,0)` — the BROWSER's timezone — which puts a
PM's "today" a day out the moment their browser isn't set to the org's zone.
Today does not repeat that bug. See `src/lib/today-buckets.test.ts` for the
UTC+10-at-23:00 case that demonstrates the difference.

## Done / un-done

`projectTasks.myOpenTasks` only returns `TODO`/`IN_PROGRESS` rows — a task
marked `DONE` disappears from the underlying read entirely. Today keeps a
local "just completed" overlay (`src/app/(app)/today/page.tsx`) so a
just-checked task stays visible, struck through, until the next refresh —
one more click calls `update(id, {status: "TODO"})` and un-does it. This
matters because `/my-tasks`'s own status-cycle button is one-way
(`TODO → IN_PROGRESS → DONE`, no way back without opening the edit dialog);
Today's checkbox toggles either direction directly, and a failed write
reverts the optimistic overlay with a toast naming what failed.

## Peek — non-modal by design

`src/components/today/today-peek.tsx` is a `role="complementary"` panel,
deliberately NOT `Dialog`/`Sheet`. CLAUDE.md's composition note documents
why: a Radix modal `Dialog` sets `pointer-events: none` on `document.body`,
and a Base UI/nested-menu popup portalled inside it gets its clicks
swallowed. The peek is going to grow nested menus (a mention typeahead, a
snooze menu, in phase 1), so it's built as plain positioned markup from day
one rather than migrated later. Manual focus management: the heading gets
focus on open, `Esc` returns focus to the triggering row, and the row list
stays arrow-navigable while the peek is open (it is not a focus trap).

## Keyboard

`j`/`k`/arrows move the selection, `Space` opens/closes the peek, `D`
toggles done on the selected or peeked item. All via the existing
`useKeyboardShortcut` hook (disabled inside inputs/dialogs automatically).

## Navigation (DESIGN.md §16, D10A)

Today takes Dashboard's slot in both `mobile-nav.tsx` (bottom nav) and
`app-sidebar.tsx` (desktop rail) — phones have no sidebar and all five
bottom-nav slots were already taken. Dashboard moved to the account menu
(`user-nav.tsx`). Every "landing page after auth" default (`src/app/page.tsx`,
login/register/select-organization/welcome/setup/two-factor/invite,
the site-admin bounce/exit links) now targets `/today` instead of
`/dashboard` — none of this touches the `safeCallbackUrl` allowlist logic,
only the *default* destination when no specific callback was requested.
`/my-tasks` is now a pure redirect to `/today` (kept, not deleted, so old
bookmarks/links/⌘K muscle memory still land somewhere real).

The dashboard's personal "My work" zone (tasks-due block + per-project
blocker badges, formerly `MyWorkSection`) is **deleted** — Today owns that
surface now, and rendering both would show the same rows twice. The
dashboard's "On the floor now" tile (live jobs on site — an org-wide
warehouse view, not personal work) and its "Needs attention" chip tray
(the nine derived org-wide types from `src/server/notifications.ts`) are
both unchanged.

## Phase 1 (#1243) additions

Snooze, personal (non-project) items, subtasks, quick-add, stage grouping and
signal promotion landed on top of this page once `projectTasks` widened in
place (FEATUREDOCS/50) — see "Phase 1: signal-state-aware" above for the
`needsYou`/`workSignalStates` piece. Time-blocking and "Plan my day" remain
out of scope for this pass (§8.1: "'Plan my day' does not exist in phase 0.5
because there is nothing to plan with; it arrives in phase 1 with snooze and
time-blocking" — snooze shipped, the scheduling/agenda half did not).

## Tests

- `src/lib/today-buckets.test.ts` — org-tz bucket boundaries (the UTC+10 case).
- `convex/dashboardLists.test.ts` — `needsYou`'s per-manager scoping, the
  48h stale-offer threshold, the 7-day expiring-quote window, that the
  `home` refactor (factoring out `resolveManagedProjectDocs`) is
  behavior-preserving, and (Phase 1) that a dismissed/promoted/still-snoozed
  signal is hidden while an expired snooze re-surfaces it, scoped per-user.
- `convex/workSignalStatesWrites.test.ts` — snooze/dismiss upsert on
  `(orgId, userId, sourceKey)`; promote creates the task and the `promoted`
  decision atomically, defaulting the assignee to the promoting user.
- `src/app/(app)/today/__tests__/page.smoke.test.tsx` — bucketing, mention →
  Triage, mark-read on open, done/un-done, empty-bucket-vs-empty-page.
- `src/components/today/__tests__/today-rails.smoke.test.tsx` — the rails'
  loading/empty/error/stale states.
