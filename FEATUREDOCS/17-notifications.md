# Notification System

## Types
| Type | Trigger | Link |
|------|---------|------|
| `overdue_maintenance` | scheduledDate passed, status != COMPLETED | `/maintenance/{id}` |
| `overdue_return` | rentalEndDate passed, status in active statuses | `/projects/{id}` |
| `upcoming_project` | rentalStartDate within 3 days | `/projects/{id}` |
| `low_stock` | bulkAsset.availableQuantity <= reorderThreshold | `/assets/registry/{id}` |
| `pending_invitation` | Pending invitations for current user | `/invite/{id}` |
| `expiring_cert` | CrewCertification expiry within 30 days | `/crew/{id}` |
| `pending_offers` | Crew assignments in OFFERED status | `/crew` |
| `pending_timesheets` | Crew time entries in SUBMITTED status | `/crew/timesheets` |
| `flagged_asset` | Project line item in FLAGGED_FAULTY/FLAGGED_TT_OVERDUE | `/warehouse/{projectId}` |

## Implementation

### In-app bell
- Server: `getNotifications()` in `src/server/notifications.ts` queries all types.
- Client: `src/components/layout/notifications.tsx` — bell icon with dropdown.
- Dismissal persists in the `NotificationDismissal` table, keyed by `(userId, notificationKey)`. localStorage is a transient optimistic-UI fallback; the DB is the source of truth. Server actions: `getDismissedKeys()`, `dismissNotification(key)`, `pruneStaleDismissals(activeKeys)`.

### Email delivery
- Per-user opt-in flags live in `UserNotificationPreference` (one row per user, lazily created). Defaults: high-signal events (overdue maintenance/returns, low stock, invitations, expiring certs, flagged assets) ON; advisory events (upcoming projects, pending offers, pending timesheets) OFF.
- Settings page: `/account/notifications`.
- Templates: `src/lib/notification-emails.ts` — one factory per type returning `{ subject, html }`.
- Orchestrator: `sendNotificationEmails()` in `src/server/notification-email-sender.ts`. Iterates orgs, fans out to active (non-banned) members of each org, checks the per-type pref flag, dedupes via `NotificationEmailLog`, sends through `sendEmail()`.
- Cron endpoint: `POST /api/cron/notifications` (also accepts GET for Vercel Cron). Auth: `Bearer ${CRON_SECRET}`. Recommended cadence: every 15 min — the dedupe log makes over-firing safe.
- `pending_invitation` notifications are intentionally NOT re-emailed by the cron (Better Auth's organization plugin already emails the invite link on creation). The flag exists for consistency in the bell-dropdown view.
- Day-bucketed aggregate keys (e.g. `crew-pending-offers:2026-05-14`) ensure aggregate notifications email at most once per day.

### Dedupe strategy
`NotificationEmailLog` row per `(userId, notificationKey)`. Rows older than 30 days are GC'd by `pruneStaleNotificationEmailLogs()` (run at the end of each cron tick) so even keys that vanish from the active set eventually fall out.
