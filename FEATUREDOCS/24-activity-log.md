# Activity Log (Audit Trail)

## Overview
Tracks every significant write operation across all entities. Full audit
trail with filtering, searching, and CSV export.

**The Postgres `ActivityLog` model is frozen** — it holds pre-cutover history
only and is no longer written to. The live audit trail is the Convex
`activityLogs` table (`convex/activityLog.ts` + `activityLogWrites.ts`). See
FEATUREDOCS/54.

## Logging Utility (`src/lib/activity-log.ts`)
- **`logActivity(input)`**: Convex-only now — calls `api.activityLogWrites.record`
  (best-effort, wrapped in try/catch, never blocks the write that produced it).
  Used by the permanent server-action carve-outs (auth, SSO, site admin, etc.)
  that still exist under `src/server/`. Browser-direct `*Writes.ts` mutations
  write their own audit row atomically in-mutation instead and skip this helper.
- **`buildChanges(before, after, fields, labels?)`**: Compares two objects and
  returns a changes array for UPDATE details.

## Convex Functions (`convex/activityLog.ts` / `activityLogWrites.ts`)
- **`activityLog.list`** / **`activityLog.listByEntity`**: Browser-direct
  reactive reads (`useAuthedQuery`), consumed via `src/hooks/use-activity-log.ts`.
- **`activityLog.exportRows`**: Read used by the CSV export carve-out below.
- **`activityLogWrites.record`** / **`recordMany`**: The write path.

## Server Action: `src/server/activity-log.ts` (CSV export carve-out only)
CSV generation is Node string-building, kept server-side per FEATUREDOCS/54's
"CSV/Node" carve-out category. It reads Convex via the service token
(`getConvexClient()` → `api.activityLog.exportRows`), not Postgres.
- **`exportActivityLogCSV(filters)`**: CSV export respecting current filters.

The reads that used to be `getActivityLogs`/`getEntityActivityLog` server
actions are now browser-direct Convex queries — there's no server-action
equivalent for them anymore.

## Page: `/activity`
- Full-width table with filter bar: entity type, action, date range, search, CSV export.
- Expandable rows show field changes ("field: old -> new").
- Paginated, sortable by timestamp (newest first).

## Entity Detail Integration
**`ActivityTimeline`** component (`src/components/activity/activity-timeline.tsx`): Compact timeline for entity detail pages.

## Sidebar & Navigation
- Sidebar: "Activity Log" with `ScrollText` icon, gated by `reports` read permission.
- Page commands: aliases `activity`, `audit`, `log`, `history`, `trail`.

## `getOrgContext()` Enhancement
Returns `userName` (from `session.user.name`) alongside `organizationId` and
`userId`, enabling the remaining server-action carve-outs to log the acting
user's name via `logActivity`. Browser-direct mutations get the acting user
from `resolveActor(ctx, actor)` instead (see FEATUREDOCS/54 and 28-patterns.md).
