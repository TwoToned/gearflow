# Real-Time Sync System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

> **⚠️ SUPERSEDED & REMOVED (2026-06-11).** This system was torn out as the
> next-to-last step of the Phase 6 Convex migration. It never delivered a single
> cross-user update: the emit side was a no-op (a PascalCase vs lowercase
> `entityType` mismatch in `mapEntityTypeToEvent` meant `events.emit` was never
> reached), and the read side only invalidated React Query keys whose every reader
> is now a reactive Convex hook or `useServerQuery`. All four files
> (`src/lib/events.ts`, `src/app/api/realtime/route.ts`, `src/hooks/use-realtime.ts`,
> `src/providers/realtime-provider.tsx`) and the `logActivity` emit hook are gone.
> Cross-user liveness is now Convex's reactive engine; the version-vector pattern
> (`useReactiveServerQuery` + `convex/<table>Detail.ts`) covers detail composites
> Convex can't subscribe to directly. See
> [FEATUREDOCS/54 — Convex Data Layer](./54-convex-data-layer.md) (the "SSE /
> EventEmitter teardown" section). This document is retained for historical context only.

## Overview

Server-Sent Events (SSE) + in-memory event bus + React Query invalidation. When any server action writes to the database, the event system broadcasts a "this changed" notification to all connected clients in the same organization. Each client invalidates its React Query cache for the affected data, triggering an automatic refetch — no manual page refresh needed.

## Architecture

```
Server Action write → logActivity() → events.emit() → SSE route → browser EventSource → queryClient.invalidateQueries()
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/events.ts` | Typed EventEmitter singleton — `events.emit()`, `events.on()`, `events.onAny()` |
| `src/app/api/realtime/route.ts` | SSE endpoint (`GET /api/realtime?orgId=xxx`) — authenticates, filters by org, streams events |
| `src/hooks/use-realtime.ts` | Client hook — creates EventSource, maps events to React Query key invalidation |
| `src/providers/realtime-provider.tsx` | "use client" wrapper — activates useRealtime in the component tree |
| `src/lib/activity-log.ts` | Hook point — emits realtime events after every successful audit log write |

### Event Types

| Event | Payload | Triggered By |
|-------|---------|------------|
| `project:updated` | `{ orgId, projectId, actorId }` | Project field changes, status transitions |
| `project:created` | `{ orgId, projectId, actorId }` | New project creation |
| `project:deleted` | `{ orgId, projectId, actorId }` | Project deletion |
| `line-item:changed` | `{ orgId, projectId, actorId }` | Add/update/delete/reorder line items |
| `asset:updated` | `{ orgId, assetId, actorId }` | Asset field changes |
| `asset:created` | `{ orgId, assetId, actorId }` | New asset creation |
| `kit:updated` | `{ orgId, kitId, actorId }` | Kit field changes |
| `kit:created` | `{ orgId, kitId, actorId }` | New kit creation |
| `warehouse:changed` | `{ orgId, projectId, actorId }` | Check-out, check-in, warehouse operations |
| `maintenance:changed` | `{ orgId, assetId, actorId }` | Maintenance record changes |
| `crew:changed` | `{ orgId, actorId }` | Crew member changes |
| `settings:changed` | `{ orgId, actorId }` | Org settings changes |

### React Query Invalidation Mapping

| Event | Query Keys Invalidated |
|-------|----------------------|
| `project:updated` | `["project", orgId, projectId]`, `["projects"]`, `["dashboard"]` |
| `project:created` / `project:deleted` | `["projects"]`, `["dashboard"]` |
| `line-item:changed` | `["project", orgId, projectId]`, `["project-overbooked"]`, `["availability"]` |
| `warehouse:changed` | `["warehouse-project", orgId, projectId]`, `["warehouse-projects"]` |
| `asset:updated` | `["asset", orgId, assetId]`, `["assets"]` |
| `asset:created` | `["assets"]` |
| `kit:updated` | `["kit", orgId, kitId]`, `["kits"]` |
| `kit:created` | `["kits"]` |
| `maintenance:changed` | `["maintenance-records"]`, `["asset", orgId, assetId]` |
| `crew:changed` | `["crew-members"]` |
| `settings:changed` | `["org-settings"]` |

### Actor-Aware Filtering

Each event carries `actorId`. The SSE endpoint filters out events where `actorId === requestingUserId`, so clients don't refetch data from their own mutations (React Query already handles that via `onSuccess` → `invalidateQueries` in each mutation).

### Reconnection

EventSource handles reconnection natively — on disconnect, the browser automatically reconnects with exponential backoff. The SSE route sends heartbeat comments (`: heartbeat\n\n`) every 15 seconds to prevent idle timeout.

## Security

- SSE endpoint requires a valid session (via `getSession()` from Better Auth)
- Events are scoped by `orgId` — clients in org A never receive events from org B
- Event payloads contain only entity IDs, never sensitive data (the client refetches via React Query with its own auth)

## Configuration

| Setting | File | Value | Notes |
|---------|------|-------|-------|
| React Query `staleTime` | `query-provider.tsx` | 15s | Reduced from 60s for faster real-time refetch |
| SSE heartbeat interval | `realtime/route.ts` | 15s | Prevents proxy/load-balancer idle timeout |
| `refetchOnWindowFocus` | `query-provider.tsx` | `false` | Unchanged — realtime handles freshness now |

## Limitations

- **Single-process**: The in-memory EventEmitter only works within one Node.js process. If RVLT Flow scales to multiple pm2 workers, events won't propagate between them. The fix: add a PostgreSQL LISTEN/NOTIFY bridge (the event bus API stays the same).
- **Reconnection on org change**: Switching organizations closes and reopens the EventSource. This is intentional — the client shouldn't receive events for orgs it's not viewing.
- **No data pushing**: Events contain only IDs, not full records. The client refetches via React Query. This keeps SSE payloads tiny and data-fetching logic centralized.

## Future Work

### Phase 2: Full Integration
- Add explicit `events.emit()` in all server action files (currently only `logActivity()` emits)
- Add cross-tab awareness (currently each tab gets its own SSE connection — fine for now)
- Reduce staleTime further or add per-query staleTime overrides for critical real-time pages

### PostgreSQL LISTEN/NOTIFY Bridge
- Create a persistent PG listener that subscribes to `gearflow_event` channel
- Server actions run `NOTIFY gearflow_event, '...'` after writes
- The listener forwards to in-memory EventEmitter
- Allows multi-process scaling without Redis

### Conflict Detection
- Add `version` columns to conflict-prone models (Project, ProjectLineItem)
- Prisma optimistic concurrency via `updateMany({ where: { version } })`
- Surface version conflicts in the UI: "This was modified by Jayden. Reload?"
