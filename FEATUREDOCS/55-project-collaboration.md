# 55 — Project Collaboration

Convex-backed collaboration substrate for projects: presence, edit locks, comment
threads, review markers, blocking gates, and a realtime activity feed. Every piece
of collaboration state persists to **Convex** (not Prisma) so it is shared and
reactive across all viewers of a project. The Next.js server-action layer is the
trusted bridge (service token); the browser subscribes reactively via `useQuery`.

## Targets

Collaboration attaches to a `(entityType, entityId)` container plus an optional
`(targetType, targetId)` for granularity. For projects the container is
`entityType: "project"`, `entityId: <projectId>`, and the target is one of:

| targetType | targetId | gates / scopes |
|------------|----------|----------------|
| _(none)_   | _(none)_ | the whole project |
| `lineItem` | line item id | a single equipment line |
| `group`    | project group id | every line inside that group |
| `category` | project category id | a section / category |

The strings and helpers live in `src/lib/collaboration-targets.ts`
(`COLLAB_TARGET_TYPES`, `lineItemTarget`, `groupTarget`, `categoryTarget`,
`targetKey`). `targetKey` is the stable `"type:id"` map key the equipment views use
to look rows up against a single project-wide subscription.

## Convex tables (`convex/schema.ts`, mutations in `convex/collaboration.ts`)

- **`collaborationLocks`** — edit locks. Heartbeat-kept, auto-expiring; a stale
  lock can be taken over. Mutations: `acquireLock`, `heartbeatLock`,
  `releaseLock`, `takeoverLock`. Reads: `getLock`, `listLocksForEntity`.
- **`presence`** — transient "who is here" heartbeats (`heartbeatPresence`,
  `clearPresence`).
- **`commentThreads` / `comments`** — threaded comments per target. Threads carry
  `isBlocking`, `status` (`open` / `resolved`), and `mentionUserIds`. Mutations:
  `createThread`, `addComment`, `setThreadBlocking`, `resolveThread`,
  `reopenThread`. Reads: `listThreads`, `listThreadCommentCounts` (keyed by
  `targetId`), `getProjectBlockingSummary`.
- **`reviewMarkers`** — per-target review state (`needs_review` / `follow_up` /
  `resolved`). Mutation `setReviewMarker`; read `getReviewMarker`.
- **`activityEvents`** — the realtime feed (see below).

All Convex mutations require the **service token** (`requireService`); browser
writes are rejected. Authorization (`requirePermission` / `getOrgContext`) happens
in the server action *before* the Convex call. Reads use `requireOrgRead`.

## Edit locks (section-level) — point 2

`useEditLock` (`src/hooks/use-collaboration.ts`) acquires a lock for the open
editor and heartbeats it, releasing on unmount. Wired into:

- `edit-group-dialog.tsx` — `targetType: group` while editing a project group.
- `rename-category-dialog.tsx` — `targetType: category` while renaming a section.

While locked by someone else the form is disabled and `LockedEditorOverlay` shows
who holds it; a **stale** lock exposes a takeover button.

Passive "X is editing" badges on group/category rows are fed from a **single**
`listLocksForEntity` subscription in `equipment-tab.tsx` (memoized into
`lockByTarget`, looked up by `targetKey`) rather than mounting an active hook per
row.

## Comment threads & blocking gates — point 4

A blocking comment is an open `commentThreads` row with `isBlocking: true`.
`getProjectBlockingSummary` returns `lineItemTargetIds`, `groupTargetIds`, and
`hasProjectLevel`. The pure decision logic lives in
`src/lib/blocking-comments-gate.ts` (`evaluateBlockingGate`) and is reused by the
server-only `assertNoBlockingComments` wrapper:

- **Full-project gate** (check-out, send-out, forward status) — blocks on ANY open
  blocker.
- **Per-line-item gate** (prep / pull / check & pack) — blocks only when there is a
  project-level blocker, the item itself is blocked, **or the item's group is
  blocked**. Callers in `src/server/check-records.ts` resolve the line item's
  `groupId` and pass it so a group-level blocker gates its members.

## Resolved-thread reply behavior — point 5

`addComment` **rejects** replies to a `resolved` thread (throws). Replying no longer
silently reopens it — the reviewer must explicitly `reopenThread` first (which goes
through the server action's `requirePermission`). This keeps the resolved state
authoritative.

## Activity feed — point 3

`activityEvents` is the realtime feed. The UI component
`src/components/collaboration/activity-feed.tsx` (`ProjectActivityFeed`) subscribes
via `listActivityEvents` and renders on the project detail page under a
"Collaboration" sidebar section (alongside the legacy Prisma audit timeline).

Events are written two ways:

1. **In-band, atomic with the state change** — the comment / marker mutations call
   an internal `recordActivity` helper so the feed write is part of the same Convex
   transaction. Covered actions: `comment_created` / `comment_blocking_created`,
   `comment_added`, `thread_blocked` / `thread_unblocked`, `thread_resolved`,
   `thread_reopened`, `review_needs_review` / `review_follow_up` /
   `review_resolved`. Actor identity (`actorUserId` / `actorName` / `actorColor`)
   is threaded from the server action into the mutation args.

2. **From other server mutations** — quote / line-item and group / category edits
   log feed events via the plain library helper
   `src/lib/collaboration-activity.ts` (`writeCollabActivityEvent`), called from
   already-authorized actions:
   - `updateLineItem` → `line_item_updated`
   - `updateProjectGroup` → `group_updated` (skips pure drag-reorders)
   - `updateProjectCategory` → `category_updated` (rename only)

   `writeCollabActivityEvent` is deliberately **not** a server action — exporting it
   from a `"use server"` module would register a public, permission-less endpoint
   that any org member could call to inject arbitrary activity events. It takes the
   caller's already-resolved actor context (no second `getOrgContext`) and calls the
   `logActivityEvent` Convex mutation (service-token gated).

## Operational data mirroring

Quote/line-item and group/category writes continue to mirror their operational
state to Convex through the existing mirror helpers — `upsertProjectLineItemsToConvex`
(`@/lib/line-item-mirror`), `syncProjectGroupsToConvex` /
`patchProjectCategoryInConvex` (`@/lib/project-grouping-mirror`) — and
`recalculateProjectTotals`. The collaboration activity write is additive and does
not replace those mirrors.

## Files

- `convex/collaboration.ts`, `convex/schema.ts` — Convex tables, mutations, queries.
- `src/lib/collaboration-targets.ts` (+ test) — target descriptors / keys.
- `src/lib/blocking-comments-gate.ts` (+ test) — pure gate decision logic.
- `src/lib/blocking-comments-read.ts` — server-only summary fetch + `assertNoBlockingComments`.
- `src/lib/collaboration-activity.ts` — `writeCollabActivityEvent` helper.
- `src/lib/collaboration-colors.ts` — deterministic per-user colours.
- `src/server/collaboration.ts` — server actions (presence, locks, threads, markers).
- `src/server/check-records.ts` — prep/pull gates pass `groupId`.
- `src/server/line-items.ts`, `src/server/project-groups.ts`, `src/server/project-categories.ts` — feed writes on edits.
- `src/hooks/use-collaboration.ts` — `useEditLock` and friends.
- `src/components/collaboration/*` — comment panel, activity feed, locked-editor overlay.
- `src/components/projects/equipment-tab.tsx`, `equipment-rows.tsx`, `edit-group-dialog.tsx`, `rename-category-dialog.tsx` — UI wiring.
