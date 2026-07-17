# 55 — Project Collaboration

Convex-backed collaboration substrate for projects: presence, edit locks, comment
threads, review markers, blocking gates, and a realtime activity feed. Every piece
of collaboration state persists to **Convex** (not Prisma) so it is shared and
reactive across all viewers of a project. Reads and most writes are now
Convex-native browser-direct (see the note under Targets, below) — the browser
subscribes reactively via `useQuery` and calls mutations directly via `useMutation`,
authorized inline by each Convex function rather than through a Next.js
server-action bridge.

## Targets

> **Note (Convex-native browser-direct):** most of `convex/collaboration.ts` is now
> called directly from the browser (`src/hooks/use-collaboration.ts` uses
> `useMutation`/`useQuery` against it), with authorization (`requireOrgRead` /
> `requireOrgPermission`) enforced inside each Convex function rather than in a
> `src/server/collaboration.ts` bridge (that file no longer exists). Only
> `logActivityEvent` remains `requireService`-gated — see the "Convex tables"
> section below for the current, corrected picture.

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

⚠️ **Stale as of the Convex-native browser-direct migration.** Almost all mutations
above are now called directly from the browser and gate themselves with
`requireOrgPermission(ctx, orgId, "project", ...)` / `requireOrgRead` inline — there
is no more server-action bridge holding a service token. The one holdout is
`logActivityEvent`, which is still `requireService`-gated (and, per the note in
"Operational data mirroring" below, has no live caller left — `writeCollabActivityEvent`,
the helper that used to call it from server actions, is now dead code). Reads use
`requireOrgRead`/`requireOrgPermission`.

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

Blocking comments only gate **project** prep / send-out, so the Block toggle in
`CommentThreadPanel` (both the per-thread button and the new-comment switch) is
hidden unless `entityType === "project"`. Other records get plain discussion
threads.

## Live build feedback (Phase 4)

The equipment rows give subtle realtime feedback while collaborators work
(`equipment-rows.tsx` + keyframes in `globals.css`):

- **Editing pulse** — a row another user currently holds an edit lock on shows a
  softly pulsing left edge tinted with the editor's colour (`.collab-editing`,
  `--collab-color` set inline).
- **Changed flash** — whenever a row's `updatedAt` changes (own save or a
  realtime push from another user) it briefly flashes (`.collab-changed`).
- Both animations are gated behind `prefers-reduced-motion`: a static edge / no
  flash when motion is reduced. Per-user attribution ("who changed it") lives in
  the activity feed rather than per-row text.

## Other records — presence, comments, edit locks (Phase 6)

The substrate is generic over `entityType` (a free string), so the same
primitives extend to non-project records with **no schema changes**. Client,
supplier, and asset-registry detail pages now carry:

- a `PresenceAvatarStack` (who else is viewing),
- an `EntityCommentsButton` (`entity-comments-button.tsx`) — wraps
  `CommentThreadPanel` with a live open-thread count for any record,
- an `EditLockGate` (`edit-lock-gate.tsx`) wrapping their edit forms — a
  record-level edit lock (`targetType`/`targetId` mirror the entity) that shows
  the form read-only behind a `LockedEditorOverlay` while another user edits,
  with stale takeover. The server-side revision check stays authoritative.

## Resolved-thread reply behavior — point 5

`addComment` **rejects** replies to a `resolved` thread (throws). Replying no longer
silently reopens it — the reviewer must explicitly `reopenThread` first (which is
gated by its own `requireOrgPermission` check in `convex/collaboration.ts`). This
keeps the resolved state authoritative.

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

2. **From other Convex mutations** — ⚠️ **stale, updated 2026-07-17.** This used to
   describe a `src/lib/collaboration-activity.ts` helper (`writeCollabActivityEvent`)
   called from already-authorized `src/server/*.ts` actions after a quote/line-item or
   group/category edit. That helper still exists but is now **dead code — nothing
   imports it** (confirmed by repo-wide grep). The Convex-native browser-direct
   migration folded the same feed writes directly into the mutations that replaced
   those server actions, atomic with the state change (via the shared `recordActivity`
   pattern, same as point 1 above):
   - `addLineItem`/`updateLineItem`/`removeLineItem` → `line_item_added`/
     `line_item_updated`/`line_item_removed`, now in
     [`convex/lineItemWrites.ts`](../convex/lineItemWrites.ts)
   - `addKitLineItem` → `kit_added` (one grouped event with member count; an
     `emitActivity` flag lets bulk callers suppress it) — also `convex/lineItemWrites.ts`
   - `addCustomLineItem` → `custom_item_added` — also `convex/lineItemWrites.ts`
   - `applyGroupTemplate` → `template_applied` (one grouped "imported N items"
     event; passes `emitActivity: false` to the per-kit adds so a bulk import
     never spams the feed with one event per row) — now
     [`convex/groupTemplatesWrites.ts`](../convex/groupTemplatesWrites.ts)
     (formerly `src/server/group-templates.ts`, now deleted)
   - `updateProjectGroup` → `group_updated` (skips pure drag-reorders) — now
     [`convex/projectGroupsWrites.ts`](../convex/projectGroupsWrites.ts)
   - `updateProjectCategory` → `category_updated` (rename only) — now
     [`convex/projectCategoriesWrites.ts`](../convex/projectCategoriesWrites.ts)

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
- `src/lib/collaboration-activity.ts` — `writeCollabActivityEvent` helper. Now dead
  code (no importers) — see point 2 under "Activity feed" above.
- `src/lib/collaboration-colors.ts` — deterministic per-user colours.
- `src/components/collaboration/entity-comments-button.tsx` — generic record comments button.
- `src/components/collaboration/edit-lock-gate.tsx` — record edit-lock wrapper (Phase 6).
- `convex/groupTemplatesWrites.ts` — grouped `template_applied` import event (formerly `src/server/group-templates.ts`, deleted).
- `src/app/(app)/{clients,suppliers,assets/registry}/[id]/{page,edit/page}.tsx` — record collaboration wiring.
- `src/server/check-records.ts` — prep/pull gates pass `groupId`.
- `convex/lineItemWrites.ts`, `convex/projectGroupsWrites.ts`, `convex/projectCategoriesWrites.ts` — feed writes on edits (formerly `src/server/line-items.ts`, `src/server/project-groups.ts`, `src/server/project-categories.ts`, all deleted).
- `src/hooks/use-collaboration.ts` — `useEditLock` and friends.
- `src/components/collaboration/*` — comment panel, activity feed, locked-editor overlay.
- `src/components/projects/equipment-tab.tsx`, `equipment-rows.tsx`, `edit-group-dialog.tsx`, `rename-category-dialog.tsx` — UI wiring.
