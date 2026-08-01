# PII Data Inventory

Satisfies POLICY.md **R-8.12.1** (classify personal data: what is stored, where, and why).
**New PII fields MUST update this file in the same PR** (R-5.2 / R-8.12.1).

**Owner:** Jayden Nawotka · **Last reviewed:** 2026-07-22

Two persistence systems hold data (see CLAUDE.md dual-backend note):

- **Postgres (Prisma)** — Better Auth identity + the audit log only.
- **Convex Cloud** — all domain data (clients, crew, suppliers, activity).

All Convex domain rows are org-scoped (`organizationId`) and, for sensitive fields,
redacted for non-service callers via `convex/lib/auth.ts` `redactFields()`.

## Inventory

| Data class | Where (system · table) | Fields | Why we hold it |
|---|---|---|---|
| **Account identity** | Postgres `User` · Convex `users` (mirror) | `name`, `email`, `emailVerified`, `image` | Authentication, addressing the user, notifications |
| **Session metadata** | Postgres `Session` | `ipAddress`, `userAgent` | Session security / device identification (Better Auth) |
| **Auth factors** | Postgres `Account`, `TwoFactor`, `BackupCode`, `Passkey` | credential material (hashed/secret) | Login, MFA (managed by Better Auth — never hand-rolled, R-8.4.1) |
| **Org membership / invites** | Postgres `Member`, `Invitation`, `PendingSSOApproval` · Convex `members`, `invitations` | `email`, `name`, `role` | Team management, pending invitations |
| **Clients** | Convex `clients` | `contactName`, `contactEmail`, `contactPhone`, `billingAddress`, `shippingAddress` (+ lat/long), `taxId`, `notes` | Rental customer records, quoting, delivery |
| **Suppliers** | Convex `suppliers` | `email`, `phone`, `address`, `notes` | Vendor / sub-hire directory |
| **Crew members** | Convex `crewMembers` | `firstName`, `lastName`, `email`, `phone`, `image`, `address` (+ lat/long), `emergencyContactName`, `emergencyContactPhone`, `dateOfBirth`, `abnOrGst`, pay rates | Crew scheduling, payroll inputs, emergency contact, tax/invoicing |
| **iCal feed token** | Convex `crewMembers.icalToken`, `orgSettings.icalToken` | opaque token | Authenticates a personal calendar feed (set only while the feed is enabled) |
| **Audit trail** | Postgres `ActivityLog` · Convex `activityLogs` | `entityName` (human-readable label at action time), actor id | Append-only audit log (R-8.11.4) |
| **Free-text notes** | Convex (many tables' `notes`) | arbitrary user content, may contain PII | Operational notes |

### Sensitive fields (extra care)

- `crewMembers.dateOfBirth`, `emergencyContact*`, `abnOrGst`, pay rates — most sensitive;
  redacted from non-service reads.
- `icalToken` — capability secret; a `by_icalToken` hit means "valid + live". Redacted.
- `Session.ipAddress` / `userAgent`.

## Not logged / not leaked (R-8.12.4)

URLs use opaque cuids, not names/emails — enforced by `sanitize_properties` (below) and by
convention at every emit site.

**PostHog (analytics processor).** The browser SDK (`src/components/providers/posthog-provider.tsx`)
is configured to send **no PII**: `autocapture: false` and `capture_pageview: false` (no
blanket click/input/pageview capture), `disable_session_recording: true` (no replay),
`mask_all_text` + `mask_all_element_attributes`, and a `sanitize_properties` hook that strips
query strings from URLs before send. Only events explicitly emitted via
`src/lib/analytics.ts` reach PostHog, and by convention their properties are cuid-only (no
names/emails/notes). Person profiles are `identified_only`.

**PostHog Error Tracking** (migrated off Sentry, #650) captures exceptions client-side
(`capture_exceptions`) and server-side (`src/lib/posthog-server.ts`, `posthog-node`). Server
exceptions are captured against a fixed `"server"` distinctId — never a real user identity —
so no name/email/ip is attached. Error *messages* and stacks are sent as-is (they may
occasionally contain user input), but no locals, cookies, or auth headers.

## Retention periods (T-P2)

Registered per PII class. Owner-confirmed 2026-07-22 (`docs/budgets.md` R-0.4 registry).

| PII class | Store | Retention | Erasure path |
|---|---|---|---|
| User identity (name, email, auth creds) | Postgres (Better Auth) | active relationship + 12 months (T-P2) | `adminDeleteUser` → **`verifyUserErased`** (R-8.12.2) |
| Session / token | Postgres | session TTL / on sign-out | cascades on user delete |
| Crew PII (DOB, rates, contact, ical token) | Convex `crewMembers` | active relationship + 12 months (T-P2) | crew delete + user-erasure sweep; `crewMember.userId` link scrubbed via `crewMembers.scrubUserRefs` |
| Activity / audit logs (actor name) | Convex `activityLogs` / Postgres | 2 years (T-P1) | retained for audit; actor refs scrubbed on erasure |
| Uploaded files | Convex `_storage` / `storedFiles` | until owner deletes | `/api/files` delete |
| Backups | Convex export | 90 days (T-P3, `convex-backup.yml`) | point-in-time — see bound below |

## User-erasure workflow (R-8.12.2)

`adminDeleteUser` (site-admin) runs a cross-org GDPR sweep — deletes the Postgres identity
(sessions/accounts cascade), removes the Convex `users` mirror (which also clears search
indexes), deletes the user's authored kit/scan/test records, and scrubs their FK references
on line-items / projects / maintenance / **crew members** (`crewMembers.scrubUserRefs`, #614).
It then calls **`verifyUserErased`**, which confirms the identity PII is gone from Postgres,
the Convex mirror, and any linked `crewMembers` row, and logs a warning if anything remains —
making the erasure **verifiable**, not fire-and-forget.

**Backup exposure bound:** `convex-backup.yml` takes a full daily export retained as a
GitHub Actions artifact for exactly 90 days (`retention-days: 90`), then GitHub deletes it
automatically — no manual purge step exists or is needed. A user erased today may still
appear in a backup snapshot taken *before* the erasure, for up to 90 days after that
snapshot was taken, after which it is gone by construction. We do not retroactively edit
already-created snapshot archives (this is pre-launch, non-customer data — disproportionate
for the current risk level); if/when that changes, revisit as a scoped R-15 exception or a
restore-then-re-erase drill.

_Review this inventory at each quarterly sweep (§12) and whenever a PII field is added._
