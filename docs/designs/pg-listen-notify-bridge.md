# PG LISTEN/NOTIFY Real-Time Sync Bridge

**Design Doc** — replaces the in-memory-only EventEmitter with PostgreSQL's native pub/sub, so real-time events survive process restarts and cross pm2 workers.

**Author:** Vera
**Date:** 9 June 2026
**Effort:** ~3 days

---

## The Problem

RVLT Flow's current real-time sync (`FEATUREDOCS/53-realtime-sync.md`) uses a Node.js `EventEmitter` singleton in `src/lib/events.ts`. When a server action writes data, `logActivity()` emits an event. The SSE endpoint at `/api/realtime/route.ts` subscribes to that EventEmitter and pushes to connected clients.

**This only works within a single process.** If the Next.js server restarts (deploy, pm2 reload, crash), all in-flight events are lost. If you scale to multiple pm2 workers (which is the actual fix for 502s), events emitted by worker A never reach clients connected to worker B.

The fix was already outlined in FEATUREDOCS/53 as "Phase 2: PostgreSQL LISTEN/NOTIFY Bridge."

---

## Architecture

```
┌──────────────────────┐
│  Server Action        │
│  (writes data)        │
│  logActivity()        │
│    → emit event       │     ┌──────────────────────────┐
│    → pg_notify(...) ──┼────▶│  PostgreSQL              │
└──────────────────────┘     │  LISTEN 'gearflow_event'  │
                             └──────────┬───────────────┘
                                        │ NOTIFY received
                                        ▼
                             ┌──────────────────────────┐
                             │  PG Listener (in-process) │
                             │  runs in Next.js server   │
                             │  calls events.emit()      │
                             └──────────┬───────────────┘
                                        ▼
                             ┌──────────────────────────┐
                             │  /api/realtime SSE route  │
                             │  pushes to clients        │
                             └──────────────────────────┘
```

The `pg_notify` + listener is purely additive — the existing `events.emit()` path stays untouched. The NOTIFY acts as an *additional* signal source that survives restarts.

### Key Files

| File | What It Does |
|------|-------------|
| `src/lib/realtime-listener.ts` | **NEW** — Persistent PG connection + `LISTEN gearflow_event`. Forwards NOTIFY payloads to `events.emit()`. |
| `src/lib/events.ts` | **MODIFIED** — Add `eventId` to RealtimeEvent (UUID from pg_notify payload) for dedup. |
| `src/lib/activity-log.ts` | **MODIFIED** — After current `events.emit()`, also `SELECT pg_notify('gearflow_event', ...)`. |
| `src/app/api/realtime/route.ts` | **MODIFIED** — Reconnect logic for when PG listener restarts. |
| `src/lib/pg-notify.ts` | **NEW** — Reusable helper: `pgNotify(eventType, payload)` — runs `SELECT pg_notify(...)`. |
| `ecosystem.config.js` | **NO CHANGE** — Listener runs in-process with the existing gearflow process. |

The listener runs in-process with the Next.js server (like how the Discord bot used to run via `instrumentation.ts`). It gets its own raw `pg` connection pool (separate from Prisma's), dedicated to LISTEN.

---

## Implementation Plan

### Step 1: `src/lib/pg-notify.ts` — The NOTIFY helper

A thin wrapper that runs `SELECT pg_notify('gearflow_event', $1)` using a dedicated raw `pg` client.

```
- Import `pg` (already in package.json dependencies)
- Create `PgNotifyClient` class:
  - connect() — creates a raw pg.Pool, connects
  - notify(event: RealtimeEvent) — JSON.stringify + pg_notify
  - close()
- Export singleton or allow caller to manage lifecycle
- Use DATABASE_URL from env (same as Prisma, but parse out the connection params for raw pg)
- Must NOT interfere with Prisma's connection pool
```

### Step 2: `src/lib/realtime-listener.ts` — The LISTEN daemon

A persistent listener that runs `LISTEN gearflow_event` and forwards to `events.emit()`.

```
- Import `pg` for a raw connection + the events.ts emitter
- `startRealtimeListener()`:
  1. Create a dedicated raw pg.Client (NOT pool — LISTEN needs a dedicated connection)
  2. Connect, run `LISTEN gearflow_event`
  3. On notification: parse JSON payload → build RealtimeEvent → events.emit()
  4. On connection error: exponential backoff reconnect (starts at 1s, caps at 30s)
  5. On SIGTERM/SIGINT: cleanup, close connection
- `stopRealtimeListener()` — graceful shutdown
- Export both functions
```

Payload shape for pg_notify:
```json
{
  "eventId": "uuid",         // for dedup
  "type": "project:updated",
  "payload": {
    "orgId": "org_xxx",
    "actorId": "user_xxx",
    "projectId": "proj_xxx"
  },
  "timestamp": 1712345678901
}
```

`eventId` is a UUID generated at notify-time. The listener uses this to deduplicate events that might arrive through both the old EventEmitter path and the new pg_notify path (during the transition / when both are active).

### Step 3: Modify `src/lib/events.ts`

```
- Add `eventId: string` to RealtimeEvent type
- No other changes to the EventEmitter itself
- Generate UUIDs via crypto.randomUUID() (Node.js built-in, no dep needed)
```

### Step 4: Modify `src/lib/activity-log.ts`

The key integration point. After the existing `events.emit()`, also fire a pg_notify.

```
- Import the pgNotify helper
- After events.emit() succeeds:
    try { await pgNotify(event); } catch { /* log, don't block */ }
- This is additive — if pg_notify fails, the existing EventEmitter path still works
```

But wait — `logActivity()` currently catches ALL errors silently and swallows them. We need to make pg_notify fire-and-forget too.

### Step 5: Start the listener at server boot

```
- In `src/instrumentation.ts` (or a new `src/lib/bootstrap.ts`):
  import { startRealtimeListener } from "./realtime-listener";
  startRealtimeListener();
- Need to ensure this only runs on the long-running server, not during build
- Check: process.env.NEXT_PHASE === 'phase-production-server' or similar guard
```

If `instrumentation.ts` doesn't exist yet, create it. Next.js 16 supports the `register()` hook in `instrumentation.ts` for exactly this kind of lifecycle setup.

### Step 6: Modify `src/lib/db-url.ts` or create a pg connection helper

The raw pg client needs a connection string. Parse `DATABASE_URL` (without Prisma's additional params like `connection_limit` and `statement_timeout` — those are Prisma-specific).

```
- Create `src/lib/raw-db-url.ts`:
  - Takes DATABASE_URL
  - Strips out Prisma-specific params (connection_limit, pool_timeout, options with statement_timeout)
  - Returns clean connection string for raw pg
```

### Step 7: Update FEATUREDOCS/53-realtime-sync.md

Document the new architecture, the pg_notify payload format, the listener reconnection behavior, and deployment notes.

---

## Connection Management

The LISTEN connection must be persistent (cannot use Prisma's pool). Design:

```
- Single dedicated pg.Client (not Pool)
- Client connects at server start, stays open
- Reconnect on drop: exponential backoff
  - start: 1s, multiply by 1.5 each attempt
  - cap: 30s
  - max attempts: infinite (retry forever)
  - on reconnect: re-run LISTEN gearflow_event
- On server shutdown: client.release() via SIGTERM handler
```

The dedicated client uses one connection from the PostgreSQL pool. For a self-hosted single-server deployment, this is negligible overhead.

---

## Deployment

The listener starts inside the existing `gearflow` pm2 process. No new pm2 process needed. The deploy workflow (`npm run build` → `pm2 restart gearflow`) already handles restarts — the listener will reconnect on boot.

**Kubernetes / multi-replica note:** If RVLT Flow ever runs across multiple replicas, each replica runs its own LISTEN connection. All receive the same NOTIFY. Each forwards to its own EventEmitter. Because the SSE route also runs per-replica, each replica correctly pushes events to its own connected clients. No change needed.

---

## Migration Path

**Phase 1 (this plan):** PG LISTEN/NOTIFY bridge alongside existing EventEmitter. Both fire. The NOTIFY path is the one that survives restarts.

**Phase 2 (future):** Once stable, the in-memory-only `events.emit()` in `logActivity()` can be removed, making pg_notify the single source of truth. The EventEmitter is still used locally within the process to bridge the listener → SSE route.

**Phase 3 (future):** Reduce React Query `staleTime` from 15s to 5s or eliminate it for real-time-critical queries, now that events are durable.

---

## Acceptance Criteria

1. Start the dev server. Open two browser tabs to the same project.
2. In tab A, change a project field. Tab B updates within 1-2 seconds.
3. Stop the dev server (`Ctrl+C`). Start it again.
4. While the server was down, simulate a NOTIFY via `psql`:
   ```sql
   SELECT pg_notify('gearflow_event', '{"eventId":"test-1","type":"project:updated","payload":{"orgId":"...","actorId":"..."},"timestamp":123}');
   ```
5. The listener catches it on reconnect and... well, this is tricky because there are no SSE clients. The real test is:
   - Start server → connect client
   - Restart the server
   - Client auto-reconnects SSE
   - Server reconnects PG LISTEN
   - New writes (via server actions) propagate to client
6. **No regression:** All existing SSE + React Query invalidation still works.
7. **No cycles:** A pg_notify from the listener process doesn't trigger itself.
8. **Logs:** Listener logs connect/disconnect/reconnect events at `info` level.
9. **Clean shutdown:** Listener disconnects cleanly on `SIGTERM`/`SIGINT`.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PG connection leak on restart | Low | `'exit'` / `'SIGTERM'` handler calls client.end() |
| Event duplication (notify + emit both fire) | Medium | eventId in payload; consumer can dedup if needed |
| NOTIFY payload too large (PG limit: 8KB) | Low | Payloads are tiny (IDs only, no data) |
| Listener blocks server startup if PG is down | Low | startRealtimeListener() is fire-and-forget, retries async |
| Prisma adapter-pg conflicts with raw pg client | Low | Separate connections — Prisma manages its pool, listener manages its client |