# Notification System

## Types
| Type | Trigger | Link |
|------|---------|------|
| `overdue_maintenance` | scheduledDate passed, status != COMPLETED | `/maintenance/{id}` |
| `overdue_return` | rentalEndDate passed, status in active statuses | `/projects/{id}` |
| `upcoming_project` | rentalStartDate within 3 days | `/projects/{id}` |
| `low_stock` | bulkAsset.availableQuantity <= reorderThreshold | `/assets/registry/{id}` |
| `pending_invitation` | Pending invitations for current user | `/settings/team` |
| `expiring_cert` | CrewCertification expiry within 30 days | `/crew/{id}` |
| `pending_offers` | Crew assignments in OFFERED status | `/crew` |
| `pending_timesheets` | Crew time entries in SUBMITTED status | `/crew/timesheets` |
| `flagged_asset` | Project line item in FLAGGED_FAULTY/FLAGGED_TT_OVERDUE | `/warehouse/{projectId}` |

## Implementation
- Server: `getNotifications()` in `src/server/notifications.ts` queries all types
- Client: `src/components/layout/notifications.tsx` — bell icon with dropdown
- Dismissal persists in the `NotificationDismissal` table, keyed by `(userId, notificationKey)`. localStorage is a transient optimistic-UI fallback; the DB is the source of truth. Server actions: `getDismissedKeys()`, `dismissNotification(key)`, `pruneStaleDismissals(activeKeys)`. Clicking a notification fires both an optimistic local hide and a server-side persist + navigate.
