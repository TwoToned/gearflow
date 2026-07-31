# Activity Log (Audit Trail)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-31 (review quarterly — POLICY.md R-5.5)_

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
- **Reason / Justification column** (`src/app/(app)/activity/page.tsx`): reads
  `metadata.justification ?? metadata.reason` — the two names the codebase uses
  for "why a caller had to type an explanation" (see below) — and renders it
  next to the summary, truncated with a full-text tooltip. Em dash when absent.

## Entity Detail Integration
**`ActivityTimeline`** component (`src/components/activity/activity-timeline.tsx`): Compact timeline for entity detail pages. Also renders the same
`metadata.justification`/`metadata.reason` text as a "Reason: …" line under the
summary when present.

## Finance events (quotes, invoices, Xero, project locks)

Every quote/invoice lifecycle mutation and the Xero push already wrote an audit
row before this section existed; what changed (2026-07-31) is that each now
uses a **specific `action` string** instead of a generic `CREATE`/`UPDATE`/`DELETE`,
so the log is filterable/labelable per verb. `action` is still free-form text
(no schema enum) — see `src/app/(app)/activity/page.tsx`'s `actionLabels` dict
for the display label of every value below; add a new entry there whenever a
finance mutation gains a new action string.

**Quotes** (`convex/quotesWrites.ts`, `entityType: "quote"`):
`QUOTE_CREATED` (new draft / new version / reprice-from-revision), `QUOTE_SENT`,
`QUOTE_RECALLED` (reason in `metadata.reason`), `QUOTE_DELETED` (draft delete or
recall-then-delete), `QUOTE_ACCEPTED`, `QUOTE_DECLINED` (reason in
`metadata.reason`), `QUOTE_UNACCEPTED`, `QUOTE_PROTECTED`/`QUOTE_UNPROTECTED`,
`QUOTE_CORRECTED`. The PDF-store step (`generateQuoteArtifact`,
`src/server/finance-documents.ts`) separately logs `QUOTE_DOCUMENT_STORED` —
this fires right after `QUOTE_SENT` but is a distinct row (rendering/storage
succeeding is not the same event as the send itself).

**Invoices** (`convex/invoicesWrites.ts`, `entityType: "invoice"`):
`INVOICE_CREATED`, `INVOICE_ISSUED`, `INVOICE_VOIDED` (reason in
`metadata.reason` — there is no separate "recall" verb for invoices, since an
issued invoice is immutable; void is the un-issue action, see FEATUREDOCS/66),
`INVOICE_DELETED` (draft only), `INVOICE_CREDIT_CREATED`. PDF storage
(`generateInvoiceArtifact`) logs `INVOICE_DOCUMENT_STORED`.

**Xero sync** (`convex/xeroPush.ts`'s `logXeroPushActivity`, called from
`src/server/xero.ts`'s `pushInvoiceToXero()`): `INVOICE_XERO_SYNCED` on success
(summary distinguishes first push vs. re-push/update), `INVOICE_XERO_SYNC_FAILED`
on failure (`summary` carries the error detail). Separate from `xeroSyncLogs`
(`convex/xeroSyncLogs.ts`), a narrower Xero-specific sync log not shown on
`/activity` — this row is the general-audience audit entry.

**Project lock/unlock** (`entityType: "project"`): opening/closing an unlock
session is already its own explicit action —
`UNLOCK_OPENED`/`UNLOCK_COMMITTED`/`UNLOCK_DISCARDED`/`UNLOCK_AUTO_COMMITTED`
(`convex/projectUnlockSessionsWrites.ts`, justification in `metadata.justification`).
Entering a locked tier has no separate action of its own — it's a normal
`STATUS_CHANGE` (`convex/projectWrites.ts`'s `updateStatusNative`) — but that
row is enriched whenever the transition crosses a lock-tier boundary
(`lockTierForStatus`/`LOCK_TIER_RANK` in `convex/lib/projectLocks.ts`): the
summary gets a `— project locked (TIER)` / `— project unlocked (TIER)` suffix,
and `metadata.lockTierFrom`/`lockTierTo` are stamped for anyone querying the
log programmatically. See FEATUREDOCS/62 for the tier table itself.

## Sidebar & Navigation
- Sidebar: "Activity Log" with `ScrollText` icon, gated by `reports` read permission.
- Page commands: aliases `activity`, `audit`, `log`, `history`, `trail`.

## `getOrgContext()` Enhancement
Returns `userName` (from `session.user.name`) alongside `organizationId` and
`userId`, enabling the remaining server-action carve-outs to log the acting
user's name via `logActivity`. Browser-direct mutations get the acting user
from `resolveActor(ctx, actor)` instead (see FEATUREDOCS/54 and 28-patterns.md).
