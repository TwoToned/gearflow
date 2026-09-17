# Notification System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

## Types
| Type | Trigger | Link |
|------|---------|------|
| `overdue_maintenance` | scheduledDate passed, status != COMPLETED | `/maintenance/{id}` |
| `overdue_return` | rentalEndDate passed, status in active statuses | `/projects/{id}` |
| `upcoming_project` | rentalStartDate within 3 days | `/projects/{id}` |
| `pending_invitation` | Pending invitations for current user | `/invite/{id}` |
| `pending_offers` | Crew assignments in OFFERED status | `/crew` |
| `pending_timesheets` | Crew time entries in SUBMITTED status | `/crew/timesheets` |
| `flagged_asset` | Project line item in FLAGGED_FAULTY/FLAGGED_TT_OVERDUE | `/warehouse/{projectId}` |
| `incident_report` | New/open MaintenanceRecord with `incidentType` set (Report Issue or an immediate check-item FAIL) — see FEATUREDOCS/64 | `/warehouse/{projectId}` or `/maintenance/{id}` |
| `pending_join_requests` | Pending `PendingOrgJoinRequest` rows (B2, #1094) — owner/admin viewers only | `/settings/team` |
| `quote_expiring` | Live SENT/EXPIRED quote with `validUntil` inside `QUOTE_EXPIRING_SOON_DAYS` (7 days), or already past it (#1225, Q2) — `invoice:read` holders only | `/projects/{projectId}?tab=finance` |

`low_stock` and `expiring_cert` are gone — they never shipped past the trigger column (no
`AppNotification` branch, no preference flag ever existed for either), so they're removed
here rather than left as aspirational rows. If either ships later it's a new row with its
own trigger/link/preference, not a resurrection of these.

## Implementation

### In-app bell
- Server: `getNotifications()` in `src/server/notifications.ts` queries all types.
- Client: `src/components/layout/notifications.tsx` — bell icon with dropdown.
- Dismissal persists in the `NotificationDismissal` table, keyed by `(userId, notificationKey)`. localStorage is a transient optimistic-UI fallback; the DB is the source of truth. Server actions: `getDismissedKeys()`, `dismissNotification(key)`, `pruneStaleDismissals(activeKeys)`.

### Email delivery
- Per-user opt-in flags live in `UserNotificationPreference` (one row per user, lazily created) — nine flags today (`NOTIFICATION_PREFERENCE_DEFAULTS` in `src/lib/validations/notification-preferences.ts`, mirrored byte-for-byte in `convex/lib/notificationPreferences.ts`, pinned by `convex/userNotificationPreferences.test.ts` + `src/lib/user-notification-preferences-read.test.ts`). Defaults: high-signal events (overdue maintenance/returns, invitations, flagged assets, reported issues, expiring quotes) ON; advisory events (upcoming projects, pending offers, pending timesheets) OFF. `pending_join_requests` has no flag — it's bell-only, admin/owner-visible, never emailed.
- Settings page: `/account/notifications`.
- Templates: `src/lib/notification-emails.ts` — one factory per type returning `{ subject, html }`.
- Orchestrator: `sendNotificationEmails()` in `src/server/notification-email-sender.ts`. Iterates orgs, fans out to active (non-banned) members of each org, checks the per-type pref flag, dedupes via `NotificationEmailLog`, sends through `sendEmail()`.
- **Audience gating (#1225, D4).** `NotificationToSend` carries an optional `audience?: (recipient: OrgRecipient) => boolean`, checked before the recipient even becomes a candidate. Every type omits it (open to every active member) except `quote_expiring`, which sets `audience: (r) => hasPermission(r.role, "invoice", "read")` — a quote nudge names a client and a dollar total in the subject line. `OrgRecipient.role` comes straight off the `member` row `loadOrgRecipients` already loads; there is deliberately no second "who can see money" table (R-3.1) — a role's invoice access can change and the gate follows it automatically.
- Cron endpoint: `POST /api/cron/notifications` (also accepts GET for Vercel Cron). Auth: `Bearer ${CRON_SECRET}`. Cadence: every 15 min — the dedupe log makes over-firing safe.
- **Scheduler (Phase 6a): `convex/crons.ts`.** Convex owns the durable schedule; `internal.scheduledJobs.runNotificationEmails` (a Convex internalAction) invokes the route above on a 15-minute interval. The executor logic stays in the Next route because it fans out to org/member/user rows whose source of truth is Postgres/Better Auth (the Convex mirrors are not verified-complete in prod). **Dormant until `ENABLE_CONVEX_CRONS=true`** on the Convex deployment (plus `CONVEX_CRON_TARGET_URL` + `CRON_SECRET`); until then the external cron remains the trigger. See `convex/scheduledJobs.ts` for the full rationale and the deferred route-removal note.
- `pending_invitation` notifications are intentionally NOT re-emailed by the cron (Better Auth's organization plugin already emails the invite link on creation). The flag exists for consistency in the bell-dropdown view.
- Day-bucketed aggregate keys (e.g. `crew-pending-offers:2026-05-14`) ensure aggregate notifications email at most once per day. `quote_expiring` is bucketed differently — `quote-expiring:{quoteId}:{soon|expired}`, not per-day — deliberately: a quote should nudge at most **twice** in its life (once when the window opens, once when it lapses), not once a day for a week straight.

### Dedupe strategy
`NotificationEmailLog` row per `(userId, notificationKey)`. Rows older than 30 days are GC'd by `pruneStaleNotificationEmailLogs()` (run at the end of each cron tick) so even keys that vanish from the active set eventually fall out.

### Dashboard chip — "N models due for service" (WS6 #945)
Recurring preventative-maintenance cycles generated by `serviceSchedules` (see
`FEATUREDOCS/15-maintenance.md`) are **excluded** from the `maintenanceDue`
stat/chip's count (`convex/dashboardStats.ts`'s `bundle` query: any due
`maintenanceRecords` row with `serviceScheduleId` set is skipped from
`maintenanceDue` and instead counted into a separate `modelsDueForService`
tally — distinct models, so two due schedules on the same model count once).
This prevents the two dashboard signals from double-counting the same
underlying work. `modelsDueForService` powers its own "N models due for
service" chip in the dashboard's Needs Attention panel
(`src/app/(app)/dashboard/page.tsx`), linking to `/maintenance/due`. No new
notification TYPE was added for this in v1 — generated records still flow
into the existing `overdue_maintenance` bell type via their `scheduledDate`
(an org-wide PM digest is deferred).
