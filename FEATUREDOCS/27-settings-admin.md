# Settings, Branding & Site Admin

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

## Document Templates (`/settings/documents`)
- Template cards grouped by document type (Quote, Invoice, Packing List, etc.)
- System defaults shown as virtual cards — "Customise" duplicates into org-owned `DocumentTemplate`
- Each template has version history, draft/published state, and default flag
- **Template Editor** (`/template-designer/[id]`): Full-screen Zoho Books-style editor
  - Left icon nav: General, Header, Details, Table, Totals, Other
  - Middle: form controls for each section (toggles, inputs, dropdowns)
  - Right: live PDF preview with real org branding + sample data (pdf.js canvas)
  - Debounced preview regeneration (600ms) via POST `/api/documents/template-preview`
- **Permissions**: `document.manage_templates` — owner, admin, manager roles
- **DB model**: `DocumentTemplate` — `basePdf`, `schemas`, `settings` (all JSON), `isDefault`, `isDraft`, `version`
- **Template selection priority** (at PDF generation time): specific `templateId` → org's published default → system default

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
