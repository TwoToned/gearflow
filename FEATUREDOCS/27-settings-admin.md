# Settings, Branding & Site Admin

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Org Settings (`Organization.metadata` JSON)
```json
{
  "country": "AU",
  "assetTagPrefix": "TTP",
  "assetTagDigits": 5,
  "assetTagCounter": 42,
  "testTag": {
    "prefix": "TT",
    "digits": 5,
    "counter": 1,
    "defaultIntervalMonths": 6,
    "defaultEquipmentClass": "CLASS_I",
    "dueSoonThresholdDays": 30,
    "companyName": "...",
    "defaultTesterName": "...",
    "defaultTestMethod": "BOTH",
    "checkoutPolicy": "..."
  }
}
```

Abbreviated — the real, current shape is `OrgSettings` in
`src/lib/org-settings-types.ts` (business identity: `email`/`phone`/`website`/
`address`/`abn`; the `documents` sub-object: footer text, terms & conditions
+ its `showTermsAndConditionsOnInvoice` invoice toggle, `paymentDetails`,
`quoteValidityDays`, `paymentTermsDays`; plus branding/invoice-numbering/SSO —
see FEATUREDOCS/13 for what each `documents` field renders on which PDF doc
type). `abn` is edited on the General settings page (`/settings`, next to
address/email/phone); the `documents` fields are edited on the "Documents"
card at `/settings/branding` (`document-settings.tsx`).

### The country table (I1, #1079)

`src/lib/countries.ts` is the single source of truth (POLICY.md R-3.1) for
every country-derived property — currency, date order/separator, decimal
separator, week start, paper size, unit system, tax label, default tax rate,
and the business-number label — for the launch markets (M1: AU/NZ/UK/US/IE)
plus NL/DE, which ship in the table but are excluded from
`listEnabledCountries()` until decimal-comma input parsing (#1087, M7) lands.
Adding a country is a data row there, not code. The US row's
`defaultTaxRate` is genuinely `null` (no national rate) — never invent one
(see #1088). Consumers: `formatters.ts` (I2, locale-aware formatting), the
document composer (I4/I5, doc labels + paper size), and calendar/unit
settings (I6) — none wired yet; this issue only lands the table.

`OrgSettings.country` (the field above) is **immutable after creation
(M6)** — `src/server/settings.ts`'s `updateOrganization` enforces it
server-side via `withImmutableCountry()`, which forces the persisted value
back onto any patch once one is set, the same "strip on the server" posture
as `PROJECT_UPDATE_IMMUTABLE` (`convex/projectWrites.ts:420`). This is
independent of the pre-existing, broader `COUNTRIES` picker on the General
settings page (`settings/page.tsx`) — that one biases Places-autocomplete
address lookups across ~19 countries and is a different concern from the
7-row operational table above; Phase C's wizard country step is what wires
the two together.

## Platform Branding (`SiteSettings`)
- `platformName` — Displayed in sidebar, page titles, emails
- `platformIcon` — Lucide icon name, rendered via `DynamicIcon`
- `platformLogo` — Uploaded image URL
- Dynamic favicon via `DynamicFavicon` component

## Client-Side Hooks
- `usePlatformName()` — Returns platform name string
- `usePlatformBranding()` — Returns `{ name, icon, logo }`
- `BrandingProvider` context wraps the app layout

## Site Admin Panel
- **Access**: `User.role === "admin"` checked server-side in admin layout. First user auto-promoted.
- `/admin` — Dashboard with org count, user count, storage stats
- `/admin/organizations` — Single-org view with stats, export/import, manage link
- `/admin/organizations/[id]` — Org detail with member list, export button
- `/admin/users` — User list, promote to admin, ban/unban, force-disable 2FA
- `/admin/settings` — Platform name, icon, logo, registration policy, 2FA global policy, default currency/tax
- **Mobile**: `AdminShell` component with hamburger menu replacing desktop sidebar

## Document Templates — removed (#790)

There is no document template settings page and no template designer of any
kind — `/settings/documents` and the underlying customization engine
(stored per-org templates, `document.manage_templates` permission) were
deleted outright in the PDF system redesign. PDF generation for the 5
project document types now uses one fixed pipeline (`document-layouts.ts` →
`document-composer.ts`) with no per-org overrides; org-level branding
(colour, logo mode, company details) still lives at `/settings/branding` —
see FEATUREDOCS/13.

## Dashboard & Reporting
- **Dashboard** (`/dashboard`): the user's home screen. Leads with a personalised greeting
  (time-of-day + first name) and a **"Your projects"** section — projects the signed-in user
  manages, found via BOTH `Project.projectManagerId` AND the `ProjectManager` join
  (`home` query in `convex/dashboardLists.ts`, active projects only). Each card shows status,
  client, equipment count, and a status-aware date line ("Returns in 2d", "Overdue 3d",
  "Starts today"), colour-coded by status intent. A "Needs attention" row chips overdue
  returns / maintenance due / pending crew offers from the org stats (or "You're all caught
  up"). Component: `components/dashboard/my-work-section.tsx`. Below that: the org metrics
  strip (Total Assets, Deployed, Active Projects, Crew), upcoming projects, and the recent
  activity feed. (Future: a "My tasks" section surfacing cross-project task assignments —
  Project Tasks (see [50-project-tasks](./50-project-tasks.md)) has shipped per-project, but
  no cross-project "my open tasks" query exists yet.)
- **Reports**: The general-purpose custom report builder (`/reports` — quick stats, ~30-report library, saved reports with pin/share) was removed entirely (`chore: remove Reports tab`). What remains: Test & Tag compliance reports at `/test-and-tag/reports` (see [14-test-and-tag](./14-test-and-tag.md)), and the `reports` permission resource, which also gates the Activity Log nav item.
- Notification-driven alerts surface the same data as the notification system
