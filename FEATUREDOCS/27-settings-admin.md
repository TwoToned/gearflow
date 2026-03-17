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
- **Dashboard** (`/dashboard`): Stats cards (Total Assets, Checked Out, Active Projects, Maintenance Due), recent activity feed, upcoming projects
- **Reports** (`/reports`): Project stats by status, revenue calculations, asset utilization
- Notification-driven alerts surface the same data as the notification system
