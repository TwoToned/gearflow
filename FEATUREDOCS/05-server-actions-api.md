# Server Actions & API Routes

## Server Action Pattern

Server actions are no longer where domain CRUD lives — that's Convex
browser-direct mutations now (see FEATUREDOCS/28 for the pattern,
FEATUREDOCS/54 for the security model and the definitive list of what stays
a server action and why). What remains in `src/server/` follows the old
pattern only where it's a **permanent carve-out** (secrets, crypto, Node
APIs, external I/O the browser must never touch):

```typescript
"use server";
import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";

export async function myCarveOutAction(input) {
  const { organizationId } = await getOrgContext();
  await requirePermission("resource", "action");
  const result = await someServerOnlyOperation(input); // crypto, external API, Node fs, etc.
  return serialize(result);
}
```

## Current Server Action Files (`src/server/`)

| File | Why it's server-side |
|------|--------------------|
| `sso.ts`, `org-members.ts`, `site-admin.ts`, `settings.ts`, `user-profile.ts`, `invitations.ts`, `api-keys.ts` | Better-Auth / crypto |
| `webhooks.ts`, `woocommerce.ts`, `test-tag-auditor.ts`, `warehouse-display.ts` | HMAC / crypto tokens / external API |
| `notification-email-sender.ts`, `crew-calendar.ts`, `org-calendar.ts`, `crew-communication.ts` | Email / iCal generation |
| `csv.ts`, `crew-time.ts`, `test-tag-reports.ts`, `activity-log.ts` | CSV / Node string-building (the latter is a CSV-export-only carve-out — see FEATUREDOCS/24) |
| `changelog.ts`, `public-org.ts` | Static/public info, no session |

**Larger than a pure carve-out — verify current status before relying on
either this list or FEATUREDOCS/54's carve-out list in isolation:**
`projects.ts`, `line-items.ts`, `warehouse.ts`, `sub-hires.ts`,
`project-services.ts`, `check-records.ts`, `document-templates.ts` all still
carry substantial exported functions (600+ LOC in some cases). Some of this
is documented elsewhere as legacy/fallback path (e.g. `TODOS.md` notes
`line-items.ts` as a "legacy path" for revenue allocation) rather than a
permanent carve-out — don't assume a function here is dead just because a
`*Writes.ts` equivalent exists, and don't assume it's load-bearing just
because it's still in the file. Check call sites.

Everything else that used to be here — `assets.ts`, `bulk-assets.ts`,
`models.ts`, `kits.ts`, `categories.ts`, `locations.ts`, `suppliers.ts`,
`supplier-orders.ts`, `clients.ts`, `maintenance.ts`, `crew.ts`,
`crew-assignments.ts`, `search.ts`, `scan-lookup.ts`, `dashboard.ts`,
`reports.ts` (feature removed), `tags.ts`, `test-tag-assets.ts`,
`test-tag-records.ts`, `custom-roles.ts` (feature removed) — is gone; that
logic is Convex queries/mutations now (`convex/<domain>.ts` /
`<domain>Writes.ts`).

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/[...all]` | GET/POST | Better Auth catch-all (login, signup, sessions, OAuth) |
| `/api/auth/sso/org-lookup` | GET | SSO org resolution by email domain |
| `/api/current-role` | GET | Get user's role in active org |
| `/api/files/[...path]` | GET | File proxy — validates org against `storedFiles` (Convex) |
| `/api/uploads` | POST | Multipart file upload |
| `/api/avatar` | POST/DELETE | Upload/remove profile picture |
| `/api/documents/[projectId]` | GET | Project PDF generation via pdfme (quote/invoice/pull-slip/return-sheet/delivery-docket) |
| `/api/documents/call-sheet/[projectId]` | GET | Call sheet PDF via pdfme |
| `/api/documents/timeline/[projectId]` | GET | Timeline/schedule PDF |
| `/api/documents/template-preview` | POST | Template preview PDF |
| `/api/test-tag-reports/[reportType]` | GET | T&T report PDF/CSV via pdfme |
| `/api/platform-name` | GET | Public site settings (name, icon, logo, policies) |
| `/api/registration-policy` | GET | Public registration policy only |
| `/api/admin-register/verify` | GET | Verify admin registration token |
| `/api/admin-register/promote` | POST | Promote user to site admin (token-gated) |
| `/api/integrations/woocommerce/webhook` | POST | WooCommerce order webhook (public, HMAC verified). A Convex `httpAction` (`convex/http.ts`) is a faithful port of this route, running in parallel for dual-accept during a URL migration — both are live today, check `convex/http.ts`'s header comment for current status before assuming this route is the only ingress |
| `/api/warehouse/display/[token]` | GET | Token-based public warehouse display |
| `/api/auditor/[token]` | GET | T&T auditor-token routes |
| `/api/calendar/[token]/[feed]` | GET | Org iCal feed |
| `/api/crew/avatar`, `/api/crew/calendar/*`, `/api/crew/respond/[token]`, `/api/crew/timesheet` | Various | Crew self-service token routes (offers, calendar, timesheets) |
| `/api/cron/notifications`, `/api/cron/test-tag-reminders`, `/api/cron/webhooks` | GET/POST | Cron-triggered background jobs (`CRON_SECRET` guarded) |

**Removed, don't reference:** `/api/reports/pdf` (reports feature removed),
`/api/admin/org-export/[orgId]` and `/api/admin/org-import` (org export/import
moved to `convex/orgExport.ts`, no HTTP route wraps it today).
