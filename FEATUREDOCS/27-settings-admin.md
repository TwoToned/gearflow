# Settings, Branding & Site Admin

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-04 (review quarterly — POLICY.md R-5.5)_

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
(see #1088). Each row also carries a `locale` (BCP-47, e.g. `"en-GB"`) — the
country's OWN locale, driving `Intl`-backed formatting for free. Consumers:
`formatters.ts` (I2, wired below), the document composer (I4/I5, doc labels
+ paper size) and calendar/unit settings (I6) — still unwired.

### Locale-aware formatting (I2, #1081)

`formatCurrency`/`formatDate` (`src/lib/formatters.ts`) take an **optional**
`FormatConfig` (`{ locale, currency }`) — omit it and you get the exact
pre-#1081 AU rendering, so every one of the 241 pre-existing call sites keeps
working unchanged until it migrates. `formatConfigFromOrgSettings()` derives
one from `OrgSettings.country` (via the I1 table above) with
`OrgSettings.currency` as an explicit override of just the currency (the
locale, i.e. date order, still comes from the country). Two consumers:

- **Client** — `FormatProvider` (`src/components/providers/format-provider.tsx`)
  is mounted in the app layout next to `BrandingProvider` (same `useOrganization`
  store, no extra fetch) and exposes `useFormatters()` → locale-bound
  `formatCurrency`/`formatDate`. A component must explicitly call the hook to
  render in the org's own country/currency — mounting the provider alone
  changes nothing for the plain imported functions.
- **Server/PDF** — call `formatConfigFromOrgSettings(orgSettings)` directly
  wherever `orgSettings` is already in hand (e.g. `build-document-data.ts`)
  and pass the result as `formatCurrency`'s/`formatDate`'s second arg.

**Not done in #1081**: migrating the 241 call sites (only
`src/lib/billing-derivation.ts`'s inline `$${n.toFixed(2)}` — the one
offender the issue named explicitly — was routed through `formatCurrency`),
or threading a `FormatConfig` through the PDF pipeline (`gearflow-table.ts`,
`document-composer.ts`, the 11 other pdfme files that call these two
functions) — that pipeline still renders every org's documents in AU
formatting regardless of the org's real country, and needs its own pass with
the per-doc-type integration tests CLAUDE.md's PDF rule requires for a
pagination-adjacent change.

### Named date-format roles + the inline-format ratchet (I3, #1082)

Beyond `formatDate`'s hardcoded locale (fixed by I2), `date-fns` `format(date,
"…")` calls were scattered across ~20 files and **contradicted each other at
the same AU locale** — some screens used day-first ("d MMM"), others
month-first ("MMM d, yyyy") for the same kind of field. `src/lib/formatters.ts`
adds five named roles alongside `formatDate` (the "short" role), all built on
one shared `formatDateWithOptions` (`Intl`-backed, so date order/separator
comes free per locale — no per-country date logic needed):

- `formatDateDayMonth` — no year (compact range/relative labels)
- `formatDateLong` — weekday + full month + year (always includes the year;
  some pre-#1082 call sites dropped it inconsistently)
- `formatDateWeekdayShort` — weekday (short) + day + short month, no year
  (a date-range endpoint label, e.g. the project wizard's schedule step)
- `formatDateWithTime` — the short role + a 24-hour clock, **pinned** with
  `hour12: false` (date-fns's `"HH:mm"` was always 24-hour regardless of
  locale; `Intl`'s default isn't, so it's forced explicitly)
- `formatMonthYear` — month + year only (calendar headers)

All five are exposed on `useFormatters()` too. Migrated in #1082: the
concrete month-first-vs-day-first contradiction (`activity/page.tsx`,
`maintenance/page.tsx` ×2, `maintenance/due/page.tsx` ×2, `dashboard/page.tsx`
×2) — the Maintenance section + Activity log were the month-first outliers
against day-first everywhere else. Migrated in the follow-up sweep (#1063
Phase I continuation): the remaining call sites with a real day/month-order
bug — `booking-calendar.tsx` (month header, day-detail heading, table rows,
both booking-list panels), `availability/page.tsx` (month header, day-detail
heading, agenda rows, day cards), `range-calendar.tsx` (month header, now
takes an optional `locale` prop), `project-wizard.tsx`'s schedule-step range
summary (via the new `formatDateWeekdayShort` role), `my-work-section.tsx`'s
project date line and tasks-due label (the latter also fixed a second bug —
it read the *viewer's* browser locale via a bare `toLocaleDateString(undefined,
…)` instead of the org's), `warehouse/page.tsx`'s `formatDateRange` helper
(was hardcoded `"en-AU"`) and "today" header, and `crew/page.tsx`'s
dashboard date helper. A handful of call sites with **no real order bug**
(bare `format(x, "MMMM yyyy")`/`format(day, "EEE")` — no day+month
combination, so nothing to reorder) were migrated anyway for consistency —
`formatMonthYear` where a role fit, or `date.toLocaleDateString(config.locale,
…)` inline for the one bare-weekday badge with no reusable role.
`"yyyy-MM-dd"`/`"yyyy-MM"` MACHINE formats (keys, query params, filenames,
`<input type="date">` values, ical) are correctly locale-independent and stay
out of scope — don't route those through a role.

**The ratchet** (`scripts/date-format-ratchet.sh`, `pnpm run
date-format-ratchet`, wired into CI's `hygiene` job): counts inline `format(x,
"…")` calls whose format string contains a word-based month/weekday token
(`MMM`/`MMMM`/`EEE`/`EEEE` — the exact axis that reorders per locale). The
count is a ratchet baseline (`.date-format-ratchet-baseline`, now **0** —
zeroed by the sweep above) like `any-ratchet`/`knip-ratchet`/
`complexity-ratchet` — it can only go down; a new inline display-date format
string fails CI, forcing new dates through a named role instead. The script
itself had a latent bug at exactly this boundary: `grep | wc -l` under
`set -o pipefail` aborts the whole script (not just reports 0) when the grep
finds zero matches, because `wc -l` never receives grep's own "no match" exit
code — fixed by counting with `grep -c ... || true` instead, so a fully-zeroed
ratchet reports success rather than failing CI.

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

### Week start + address bias (I6, #1086)

`useOrgWeekStartsOn()` (`src/lib/use-org-country.ts`, sibling to
`useOrgCountry()`) returns `date-fns`'s `weekStartsOn` value (`0` Sunday /
`1` Monday) from the country table, defaulting to Monday (`1`) when no
country is set — the same value every hardcoded `weekStartsOn: 1` it
replaces already assumed. Wired into:

- `crew/planner/page.tsx` — its hand-rolled `startOfWeek()` (a DRY violation,
  ignoring `date-fns` entirely) is gone; it now calls `date-fns`'s
  `startOfWeek(date, { weekStartsOn })`.
- `availability/page.tsx` — `gridStart`/`gridEnd` use the hook instead of a
  hardcoded `{ weekStartsOn: 1 }`. Also fixes a companion bug the week-start
  change would otherwise have introduced: the month grid's `WEEKDAYS` header
  labels were a hardcoded Monday-first array — for a Sunday-starting org the
  header and the day cells would have visibly misaligned. Both now derive
  from the same `weekStartsOn` via `weekdayLabels()`.
- `booking-calendar.tsx` — same companion bug, same fix: `gridStart`/
  `gridEnd` and the day-header row (`DAY_HEADERS_MON_FIRST`/
  `DAY_HEADERS_SUN_FIRST`, picked by `useOrgWeekStartsOn()`) now agree.
  `BookingCalendar` already read the active org for its data queries, so the
  hook call is local rather than page-level-then-threaded.
- `range-calendar.tsx` (`src/components/ui/`, a generic primitive used by
  `project-wizard.tsx`'s schedule step) — takes `weekStartsOn`/`locale` as
  **optional props**, defaulting to the pre-#1086 Monday/`en-AU` behaviour
  for any caller that hasn't threaded the org's hook through yet, rather than
  reading org context itself. A low-level `ui/` component shouldn't fetch org
  data directly (that's the page/feature-component's job, same split as
  `crew/planner/page.tsx` calling the hook and passing the value down); the
  one current caller (`project-wizard.tsx`) calls `useOrgWeekStartsOn()` +
  `useFormatters().config.locale` and passes both down.

Address-bias (`AddressInput`'s `countryCode` prop via `useOrgCountry()`) was
already wired everywhere except `services-panel.tsx`'s delivery/pickup
address field — the one gap, now closed. See FEATUREDOCS/30 for the full
Places-autocomplete picture.

**Not done in #1086** — units (weights/dimensions/rigging loads, kg-only
today): the issue itself flags this as an open scope question ("decide the
boundary before implementing rather than during" — dimensions and rigging
loads are a larger surface than weights alone, and mixed units in a
warehouse are their own hazard) rather than a spec to implement blind.
Deferred pending that decision. Number grouping needed no work — it came
free once the locale was threaded (I2, #1081).

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
- `/admin/settings` — Platform name, icon, logo, registration policy, 2FA global policy,
  default currency/tax, org-creation gate (Phase B, B3/#1095: allow-org-creation toggle,
  require-signup-code toggle, signup code with copy/regenerate — see FEATUREDOCS/04)
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
