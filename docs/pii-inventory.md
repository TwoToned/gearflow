# PII Data Inventory

Satisfies POLICY.md **R-8.12.1** (classify personal data: what is stored, where, and why).
**New PII fields MUST update this file in the same PR** (R-5.2 / R-8.12.1).

**Owner:** Jayden Nawotka · **Last reviewed:** 2026-07-18

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

Sentry `beforeSend` (`sentry.server.config.ts`, `instrumentation-client.ts`) strips
`user.email`, `user.ip_address`, and `authorization`/`cookie` headers before send. URLs use
opaque cuids, not names/emails.

## Known gaps (tracked in the baseline audit)

- **R-8.12.2 (retention + deletion):** no registered per-class retention (T-P2) and no
  end-to-end user-erasure workflow (delete request → verifiable removal incl. search indexes
  and backups). **Open.**
- **T-P3 backups:** daily Convex export, 90-day retention (`convex-backup.yml`).

_Review this inventory at each quarterly sweep (§12) and whenever a PII field is added._
